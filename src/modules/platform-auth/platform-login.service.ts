import {
	PreconditionFailedException,
	UnauthorizedException,
	Injectable,
	Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformStaffStatus, PrismaService, UserStatus } from '@nexcoderw/gym-db';

import type { EnvironmentVariables } from '../../config/environment.types.js';
import type { PlatformMfaChallengeResponseDto } from './dto/platform-auth-response.dto.js';
import type { PlatformLoginDto } from './dto/platform-login.dto.js';
import { PLATFORM_AUTH_ERROR } from './platform-auth.constants.js';
import { PlatformLoginAttemptService } from './platform-login-attempt.service.js';
import { PlatformPasswordService } from './platform-password.service.js';
import { PlatformTokenService } from './platform-token.service.js';

@Injectable()
export class PlatformLoginService {
	private readonly logger = new Logger(PlatformLoginService.name);
	private readonly challengeLifetimeMilliseconds: number;
	private readonly maximumAttempts: number;

	constructor(
		config: ConfigService<EnvironmentVariables, true>,
		private readonly prisma: PrismaService,
		private readonly passwords: PlatformPasswordService,
		private readonly tokens: PlatformTokenService,
		private readonly attempts: PlatformLoginAttemptService,
	) {
		this.challengeLifetimeMilliseconds =
			config.get('PLATFORM_AUTH_MFA_CHALLENGE_TTL_SECONDS', { infer: true }) * 1000;
		this.maximumAttempts = config.get('PLATFORM_AUTH_MFA_MAX_ATTEMPTS', { infer: true });
	}

	async login(
		input: PlatformLoginDto,
		ipAddress: string,
		now = new Date(),
	): Promise<PlatformMfaChallengeResponseDto> {
		this.attempts.assertAllowed(ipAddress, input.email, now.getTime());
		const identity = await this.prisma.user.findUnique({
			where: { email: input.email },
			select: {
				id: true,
				status: true,
				emailVerifiedAt: true,
				passwordCredential: { select: { passwordHash: true } },
				platformStaff: {
					select: {
						id: true,
						status: true,
						totpCredential: {
							select: { verifiedAt: true, disabledAt: true },
						},
						recoveryCodes: {
							where: { usedAt: null },
							select: { id: true },
							take: 1,
						},
					},
				},
			},
		});

		const passwordHash = identity?.passwordCredential?.passwordHash ?? this.passwords.dummyHash;
		const passwordValid = await this.passwords.verify(passwordHash, input.password);
		if (
			!passwordValid ||
			identity?.status !== UserStatus.ACTIVE ||
			identity.emailVerifiedAt === null ||
			identity.platformStaff?.status !== PlatformStaffStatus.ACTIVE
		) {
			this.attempts.recordFailure(ipAddress, input.email, now.getTime());
			this.logger.warn('platform_login_rejected');
			throw new UnauthorizedException(PLATFORM_AUTH_ERROR.invalidCredentials);
		}
		const platformStaff = identity.platformStaff;

		const totpAvailable =
			platformStaff.totpCredential?.verifiedAt !== null &&
			platformStaff.totpCredential?.verifiedAt !== undefined &&
			platformStaff.totpCredential.disabledAt === null;
		const recoveryAvailable = platformStaff.recoveryCodes.length > 0;
		if (!totpAvailable && !recoveryAvailable) {
			throw new PreconditionFailedException({
				code: 'PLATFORM_MFA_SETUP_REQUIRED',
				message: 'A confirmed MFA factor is required before platform access',
			});
		}

		const challengeToken = this.tokens.createToken();
		const csrfToken = this.tokens.createToken();
		const expiresAt = new Date(now.getTime() + this.challengeLifetimeMilliseconds);
		await this.prisma.$transaction(async (transaction) => {
			await transaction.platformMfaChallenge.updateMany({
				where: {
					platformStaffId: platformStaff.id,
					consumedAt: null,
					expiresAt: { gt: now },
				},
				data: { consumedAt: now },
			});
			await transaction.platformMfaChallenge.create({
				data: {
					platformStaffId: platformStaff.id,
					tokenDigest: this.tokens.digest(challengeToken),
					expiresAt,
					maxAttempts: this.maximumAttempts,
				},
			});
		});
		this.attempts.clearAccount(input.email);
		this.logger.log(`platform_mfa_challenge_created staffId=${platformStaff.id}`);

		return {
			challengeToken,
			csrfToken,
			expiresAt: expiresAt.toISOString(),
			methods: [
				...(totpAvailable ? (['totp'] as const) : []),
				...(recoveryAvailable ? (['recovery_code'] as const) : []),
			],
		};
	}
}
