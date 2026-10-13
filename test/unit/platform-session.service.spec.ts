import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PlatformStaffStatus, PrismaService, UserStatus } from '@nexcoderw/gym-db';

import type { EnvironmentVariables } from '../../src/config/environment.types.js';
import { validateEnvironment } from '../../src/config/environment.validation.js';
import { PlatformSessionService } from '../../src/modules/platform-auth/platform-session.service.js';
import { PlatformTokenService } from '../../src/modules/platform-auth/platform-token.service.js';

describe('PlatformSessionService', () => {
	const sessionFindUnique = jest.fn<() => Promise<unknown>>();
	const sessionUpdateMany = jest.fn<() => Promise<{ count: number }>>();
	const transaction = {
		platformAdminSession: {
			findUnique: sessionFindUnique,
			updateMany: sessionUpdateMany,
		},
	};
	type TransactionOperation = (client: typeof transaction) => Promise<unknown>;
	const runTransaction = jest.fn((operation: TransactionOperation) => operation(transaction));
	let service: PlatformSessionService;

	beforeAll(async () => {
		const config = new ConfigService<EnvironmentVariables, true>(
			validateEnvironment({ NODE_ENV: 'test' }),
		);
		const module = await Test.createTestingModule({
			providers: [
				PlatformSessionService,
				{ provide: ConfigService, useValue: config },
				{
					provide: PrismaService,
					useValue: {
						platformAdminSession: { updateMany: sessionUpdateMany },
						$transaction: runTransaction,
					},
				},
				{
					provide: PlatformTokenService,
					useValue: { digest: jest.fn<(value: string) => string>().mockReturnValue('digest') },
				},
			],
		}).compile();
		service = module.get(PlatformSessionService);
	});

	beforeEach(() => {
		jest.clearAllMocks();
		sessionUpdateMany.mockResolvedValue({ count: 1 });
	});

	it('returns current database roles and permissions and advances idle expiry', async () => {
		sessionFindUnique.mockResolvedValue(createSession([
			{ platformPermission: { key: 'platform.dashboard.read' } },
		]));

		await expect(
			service.authenticate(
				'fictional-session-token-with-more-than-32-characters',
				new Date('2030-01-01T00:10:00.000Z'),
			),
		).resolves.toMatchObject({
			roles: ['platform.operator'],
			permissions: ['platform.dashboard.read'],
		});
		expect(sessionUpdateMany).toHaveBeenCalledTimes(1);
	});

	it('revokes a session after all explicit permissions are removed', async () => {
		sessionFindUnique.mockResolvedValue(createSession([]));

		await expect(
			service.authenticate(
				'fictional-session-token-with-more-than-32-characters',
				new Date('2030-01-01T00:10:00.000Z'),
			),
		).rejects.toMatchObject({ status: 401 });
		expect(sessionUpdateMany).toHaveBeenCalledWith({
			where: { id: 'session-id', revokedAt: null },
			data: { revokedAt: new Date('2030-01-01T00:10:00.000Z') },
		});
	});
});

function createSession(
	permissions: { readonly platformPermission: { readonly key: string } }[],
): object {
	return {
		id: 'session-id',
		createdAt: new Date('2030-01-01T00:00:00.000Z'),
		expiresAt: new Date('2030-01-01T08:00:00.000Z'),
		idleExpiresAt: new Date('2030-01-01T00:30:00.000Z'),
		revokedAt: null,
		mfaVerifiedAt: new Date('2030-01-01T00:00:00.000Z'),
		platformStaff: {
			id: 'staff-id',
			status: PlatformStaffStatus.ACTIVE,
			user: {
				id: 'user-id',
				email: 'admin@example.com',
				displayName: 'NEXCODE Administrator',
				status: UserStatus.ACTIVE,
				emailVerifiedAt: new Date('2029-01-01T00:00:00.000Z'),
				passwordCredential: { passwordChangedAt: new Date('2029-01-01T00:00:00.000Z') },
			},
			roles: [
				{
					platformRole: {
						key: 'platform.operator',
						permissions,
					},
				},
			],
		},
	};
}
