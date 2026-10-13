import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformStaffStatus, Prisma, PrismaService, UserStatus } from '@nexcoderw/gym-db';

import type { EnvironmentVariables } from '../../config/environment.types.js';
import type { PlatformMfaVerifyDto } from './dto/platform-mfa-verify.dto.js';
import { PLATFORM_AUTH_ERROR } from './platform-auth.constants.js';
import { PlatformTokenService } from './platform-token.service.js';
import { PlatformTotpService } from './platform-totp.service.js';
import { isPlatformSuperadmin } from './platform-permission-policy.js';

export interface PlatformMfaSuccess {
	readonly status: 'authenticated';
	readonly expiresAt: string;
	readonly sessionToken: string;
	readonly expiresAtDate: Date;
}

type VerificationOutcome =
	{ readonly authenticated: false } | { readonly authenticated: true; readonly expiresAt: Date };

class ConcurrentMfaConsumptionError extends Error {
	override readonly name = 'ConcurrentMfaConsumptionError';
}

@Injectable()
export class PlatformMfaService {
	private readonly logger = new Logger(PlatformMfaService.name);
	private readonly sessionLifetimeMilliseconds: number;
	private readonly idleLifetimeMilliseconds: number;
	private readonly emailOtpEnabled: boolean;

	constructor(
		config: ConfigService<EnvironmentVariables, true>,
		private readonly prisma: PrismaService,
		private readonly tokens: PlatformTokenService,
		private readonly totp: PlatformTotpService,
	) {
		this.sessionLifetimeMilliseconds =
			config.get('PLATFORM_AUTH_SESSION_TTL_SECONDS', { infer: true }) * 1000;
		this.idleLifetimeMilliseconds =
			config.get('PLATFORM_AUTH_IDLE_TTL_SECONDS', { infer: true }) * 1000;
		this.emailOtpEnabled = config.get('PLATFORM_AUTH_EMAIL_OTP_ENABLED', { infer: true });
	}

	async verify(input: PlatformMfaVerifyDto, now = new Date()): Promise<PlatformMfaSuccess> {
		this.assertMethodInput(input);
		const challengeDigest = this.tokens.digest(input.challengeToken);
		const challenge = await this.prisma.platformMfaChallenge.findUnique({
			where: { tokenDigest: challengeDigest },
			select: {
				id: true,
				platformStaffId: true,
				expiresAt: true,
				consumedAt: true,
				failedAttempts: true,
				maxAttempts: true,
				platformStaff: {
					select: {
						totpCredential: true,
					},
				},
			},
		});
		if (
			challenge?.consumedAt !== null ||
			challenge.expiresAt <= now ||
			challenge.failedAttempts >= challenge.maxAttempts
		) {
			throw new UnauthorizedException(PLATFORM_AUTH_ERROR.invalidChallenge);
		}

		const acceptedTotp =
			input.method === 'totp' &&
			input.totpCode !== undefined &&
			challenge.platformStaff.totpCredential !== null
				? this.totp.verify(
						{
							platformStaffId: challenge.platformStaffId,
							encryptedSecret: challenge.platformStaff.totpCredential.encryptedSecret,
							initializationVector: challenge.platformStaff.totpCredential.initializationVector,
							authenticationTag: challenge.platformStaff.totpCredential.authenticationTag,
							encryptionKeyId: challenge.platformStaff.totpCredential.encryptionKeyId,
							encryptionVersion: challenge.platformStaff.totpCredential.encryptionVersion,
						},
						input.totpCode,
						now,
					)
				: null;
		const sessionToken = this.tokens.createToken();
		let outcome: VerificationOutcome;
		try {
			outcome = await this.prisma.$transaction(
				async (transaction): Promise<VerificationOutcome> => {
					const current = await transaction.platformMfaChallenge.findUnique({
						where: { tokenDigest: challengeDigest },
						select: {
							id: true,
							platformStaffId: true,
							expiresAt: true,
							consumedAt: true,
							failedAttempts: true,
							maxAttempts: true,
							createdAt: true,
							emailOtpDigest: true,
							emailOtpExpiresAt: true,
							platformStaff: {
								select: {
									status: true,
									user: {
										select: {
											status: true,
											emailVerifiedAt: true,
											email: true,
											passwordCredential: { select: { passwordChangedAt: true } },
										},
									},
									roles: {
										select: {
											platformRole: {
												select: {
													key: true,
													isSystem: true,
													permissions: { select: { platformPermissionId: true }, take: 1 },
												},
											},
										},
									},
									totpCredential: {
										select: { id: true, verifiedAt: true, disabledAt: true },
									},
								},
							},
						},
					});
					if (
						current?.consumedAt !== null ||
						current.expiresAt <= now ||
						current.failedAttempts >= current.maxAttempts ||
						current.platformStaff.status !== PlatformStaffStatus.ACTIVE ||
						current.platformStaff.user.status !== UserStatus.ACTIVE ||
						current.platformStaff.user.emailVerifiedAt === null ||
						current.platformStaff.user.passwordCredential === null ||
						current.platformStaff.user.passwordCredential.passwordChangedAt > current.createdAt ||
						(!isPlatformSuperadmin(current.platformStaff.roles) &&
							!current.platformStaff.roles.some(
								({ platformRole }) => platformRole.permissions.length > 0,
							))
					) {
						return { authenticated: false };
					}

					const factorAccepted =
						input.method === 'email_otp'
							? await this.consumeEmailOtp(transaction, current, input.emailOtpCode, now)
							: await this.consumeFactor(
									transaction,
									input,
									current.platformStaffId,
									current.platformStaff.totpCredential,
									acceptedTotp?.timeStep,
									now,
								);
					if (!factorAccepted) {
						await transaction.platformMfaChallenge.updateMany({
							where: {
								id: current.id,
								consumedAt: null,
								failedAttempts: { lt: current.maxAttempts },
							},
							data: { failedAttempts: { increment: 1 } },
						});
						return { authenticated: false };
					}

					const consumed = await transaction.platformMfaChallenge.updateMany({
						where: {
							id: current.id,
							consumedAt: null,
							expiresAt: { gt: now },
							failedAttempts: { lt: current.maxAttempts },
						},
						data: { consumedAt: now },
					});
					if (consumed.count !== 1) {
						throw new ConcurrentMfaConsumptionError();
					}

					const expiresAt = new Date(now.getTime() + this.sessionLifetimeMilliseconds);
					await transaction.platformAdminSession.create({
						data: {
							platformStaffId: current.platformStaffId,
							tokenDigest: this.tokens.digest(sessionToken),
							expiresAt,
							idleExpiresAt: new Date(now.getTime() + this.idleLifetimeMilliseconds),
							lastSeenAt: now,
							mfaVerifiedAt: now,
						},
					});
					return { authenticated: true, expiresAt };
				},
				{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
			);
		} catch (error: unknown) {
			if (error instanceof ConcurrentMfaConsumptionError || isTransactionConflict(error)) {
				throw new UnauthorizedException(PLATFORM_AUTH_ERROR.invalidChallenge);
			}
			throw error;
		}

		if (!outcome.authenticated) {
			this.logger.warn(`platform_mfa_rejected challengeId=${challenge.id}`);
			throw new UnauthorizedException(PLATFORM_AUTH_ERROR.invalidChallenge);
		}
		this.logger.log(`platform_session_created staffId=${challenge.platformStaffId}`);
		return {
			status: 'authenticated',
			expiresAt: outcome.expiresAt.toISOString(),
			expiresAtDate: outcome.expiresAt,
			sessionToken,
		};
	}

	private async consumeFactor(
		transaction: Prisma.TransactionClient,
		input: PlatformMfaVerifyDto,
		platformStaffId: string,
		totpCredential: {
			readonly id: string;
			readonly verifiedAt: Date | null;
			readonly disabledAt: Date | null;
		} | null,
		acceptedTimeStep: bigint | undefined,
		now: Date,
	): Promise<boolean> {
		if (input.method === 'totp') {
			if (
				totpCredential?.verifiedAt === null ||
				totpCredential?.disabledAt !== null ||
				acceptedTimeStep === undefined
			) {
				return false;
			}
			const accepted = await transaction.platformTotpCredential.updateMany({
				where: {
					id: totpCredential.id,
					platformStaffId,
					verifiedAt: { not: null },
					disabledAt: null,
					OR: [{ lastAcceptedTimeStep: null }, { lastAcceptedTimeStep: { lt: acceptedTimeStep } }],
				},
				data: { lastAcceptedTimeStep: acceptedTimeStep, lastUsedAt: now },
			});
			return accepted.count === 1;
		}

		if (input.recoveryCode === undefined) {
			return false;
		}
		const consumed = await transaction.platformRecoveryCode.updateMany({
			where: {
				platformStaffId,
				codeDigest: this.tokens.digest(input.recoveryCode.trim().toUpperCase()),
				usedAt: null,
			},
			data: { usedAt: now },
		});
		return consumed.count === 1;
	}

	private async consumeEmailOtp(
		transaction: Prisma.TransactionClient,
		challenge: {
			readonly id: string;
			readonly emailOtpDigest: string | null;
			readonly emailOtpExpiresAt: Date | null;
			readonly platformStaff: { readonly user: { readonly email: string } };
		},
		code: string | undefined,
		now: Date,
	): Promise<boolean> {
		if (
			!this.emailOtpEnabled ||
			code === undefined ||
			challenge.emailOtpDigest === null ||
			challenge.emailOtpExpiresAt === null ||
			challenge.emailOtpExpiresAt <= now
		)
			return false;
		const digest = this.tokens.emailOtpDigest(
			challenge.id,
			challenge.platformStaff.user.email,
			code,
		);
		if (!this.tokens.equal(digest, challenge.emailOtpDigest)) return false;
		const consumed = await transaction.platformMfaChallenge.updateMany({
			where: {
				id: challenge.id,
				consumedAt: null,
				emailOtpDigest: digest,
				emailOtpExpiresAt: { gt: now },
			},
			data: { emailOtpDigest: null, emailOtpExpiresAt: null },
		});
		return consumed.count === 1;
	}

	private assertMethodInput(input: PlatformMfaVerifyDto): void {
		const valid =
			(input.method === 'email_otp' &&
				this.emailOtpEnabled &&
				input.emailOtpCode !== undefined &&
				/^\d{6}$/u.test(input.emailOtpCode) &&
				input.totpCode === undefined &&
				input.recoveryCode === undefined) ||
			(input.method === 'totp' &&
				input.emailOtpCode === undefined &&
				input.totpCode !== undefined &&
				input.recoveryCode === undefined) ||
			(input.method === 'recovery_code' &&
				input.emailOtpCode === undefined &&
				input.recoveryCode !== undefined &&
				input.totpCode === undefined);
		if (!valid) {
			throw new UnauthorizedException(PLATFORM_AUTH_ERROR.invalidChallenge);
		}
	}
}

function isTransactionConflict(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034';
}
