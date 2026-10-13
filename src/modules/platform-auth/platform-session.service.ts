import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformStaffStatus, Prisma, PrismaService, UserStatus } from '@nexcoderw/gym-db';

import type { EnvironmentVariables } from '../../config/environment.types.js';
import { PLATFORM_AUTH_ERROR } from './platform-auth.constants.js';
import type { PlatformPrincipal } from './platform-auth.types.js';
import { PlatformTokenService } from './platform-token.service.js';

@Injectable()
export class PlatformSessionService {
	private readonly logger = new Logger(PlatformSessionService.name);
	private readonly idleLifetimeMilliseconds: number;

	constructor(
		config: ConfigService<EnvironmentVariables, true>,
		private readonly prisma: PrismaService,
		private readonly tokens: PlatformTokenService,
	) {
		this.idleLifetimeMilliseconds =
			config.get('PLATFORM_AUTH_IDLE_TTL_SECONDS', { infer: true }) * 1000;
	}

	async authenticate(token: string, now = new Date()): Promise<PlatformPrincipal> {
		const tokenDigest = this.tokens.digest(token);
		const principal = await this.prisma.$transaction(
			async (transaction): Promise<PlatformPrincipal | null> => {
				const session = await transaction.platformAdminSession.findUnique({
					where: { tokenDigest },
					select: {
						id: true,
						createdAt: true,
						expiresAt: true,
						idleExpiresAt: true,
						revokedAt: true,
						mfaVerifiedAt: true,
						platformStaff: {
							select: {
								id: true,
								status: true,
								user: {
									select: {
										id: true,
										email: true,
										displayName: true,
										status: true,
										emailVerifiedAt: true,
										passwordCredential: {
											select: { passwordChangedAt: true },
										},
									},
								},
								roles: {
									select: {
										platformRole: {
											select: {
												key: true,
												permissions: {
													select: {
														platformPermission: { select: { key: true } },
													},
												},
											},
										},
									},
								},
							},
						},
					},
				});
				if (session === null) {
					return null;
				}

				const passwordChangedAt = session.platformStaff.user.passwordCredential?.passwordChangedAt;
				const roles = session.platformStaff.roles.map(({ platformRole }) => platformRole.key);
				const permissions = [
					...new Set(
						session.platformStaff.roles.flatMap(({ platformRole }) =>
							platformRole.permissions.map(({ platformPermission }) => platformPermission.key),
						),
					),
				];
				const invalid =
					session.revokedAt !== null ||
					session.expiresAt <= now ||
					session.idleExpiresAt <= now ||
					session.mfaVerifiedAt > now ||
					session.platformStaff.status !== PlatformStaffStatus.ACTIVE ||
					session.platformStaff.user.status !== UserStatus.ACTIVE ||
					session.platformStaff.user.emailVerifiedAt === null ||
					passwordChangedAt === undefined ||
					passwordChangedAt > session.createdAt ||
					permissions.length === 0;
				if (invalid) {
					if (session.revokedAt === null) {
						await transaction.platformAdminSession.updateMany({
							where: { id: session.id, revokedAt: null },
							data: { revokedAt: now },
						});
					}
					return null;
				}

				const idleExpiresAt = new Date(
					Math.min(session.expiresAt.getTime(), now.getTime() + this.idleLifetimeMilliseconds),
				);
				const refreshed = await transaction.platformAdminSession.updateMany({
					where: {
						id: session.id,
						revokedAt: null,
						expiresAt: { gt: now },
						idleExpiresAt: { gt: now },
					},
					data: { lastSeenAt: now, idleExpiresAt },
				});
				if (refreshed.count !== 1) {
					return null;
				}

				return {
					sessionId: session.id,
					userId: session.platformStaff.user.id,
					platformStaffId: session.platformStaff.id,
					displayName: session.platformStaff.user.displayName,
					email: session.platformStaff.user.email,
					expiresAt: session.expiresAt,
					roles,
					permissions,
				};
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
		);

		if (principal === null) {
			this.logger.warn('platform_session_rejected');
			throw new UnauthorizedException(PLATFORM_AUTH_ERROR.invalidSession);
		}
		return principal;
	}

	async revoke(token: string | undefined, now = new Date()): Promise<void> {
		if (token === undefined || token.length < 32 || token.length > 256) {
			return;
		}
		const revoked = await this.prisma.platformAdminSession.updateMany({
			where: { tokenDigest: this.tokens.digest(token), revokedAt: null },
			data: { revokedAt: now },
		});
		if (revoked.count === 1) {
			this.logger.log('platform_session_revoked');
		}
	}
}
