import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PlatformStaffStatus, PrismaService, UserStatus } from '@nexcoderw/gym-db';

import type { EnvironmentVariables } from '../../src/config/environment.types.js';
import { validateEnvironment } from '../../src/config/environment.validation.js';
import { PlatformPasswordService } from '../../src/modules/platform-auth/platform-password.service.js';
import { PlatformTokenService } from '../../src/modules/platform-auth/platform-token.service.js';
import { PlatformTotpService } from '../../src/modules/platform-auth/platform-totp.service.js';
import { PlatformOwnerBootstrapService } from '../../src/modules/platform-bootstrap/platform-owner-bootstrap.service.js';

describe('PlatformOwnerBootstrapService', () => {
	const executeRaw = jest.fn<() => Promise<number>>();
	const staffCount = jest.fn<() => Promise<number>>();
	const userFindUnique = jest.fn<() => Promise<unknown>>();
	const userCreate = jest.fn<() => Promise<unknown>>();
	const userUpdateMany = jest.fn<() => Promise<{ count: number }>>();
	const staffUpdateMany = jest.fn<() => Promise<{ count: number }>>();
	const roleFindUnique = jest.fn<() => Promise<unknown>>();
	const roleCreate = jest.fn<() => Promise<unknown>>();
	const permissionFindUnique = jest.fn<() => Promise<unknown>>();
	const permissionCreate = jest.fn<() => Promise<unknown>>();
	const rolePermissionUpsert = jest.fn<() => Promise<unknown>>();
	const staffRoleCreate = jest.fn<() => Promise<unknown>>();
	const totpCreate = jest.fn<() => Promise<unknown>>();
	const totpUpdateMany = jest.fn<() => Promise<{ count: number }>>();
	const recoveryCreateMany = jest.fn<() => Promise<{ count: number }>>();
	const transaction = {
		$executeRaw: executeRaw,
		platformStaff: { count: staffCount, updateMany: staffUpdateMany },
		user: { findUnique: userFindUnique, create: userCreate, updateMany: userUpdateMany },
		platformRole: { findUnique: roleFindUnique, create: roleCreate },
		platformPermission: { findUnique: permissionFindUnique, create: permissionCreate },
		platformRolePermission: { upsert: rolePermissionUpsert },
		platformStaffRole: { create: staffRoleCreate },
		platformTotpCredential: { create: totpCreate, updateMany: totpUpdateMany },
		platformRecoveryCode: { createMany: recoveryCreateMany },
	};
	type TransactionOperation = (client: typeof transaction) => Promise<unknown>;
	const runTransaction = jest.fn((operation: TransactionOperation) => operation(transaction));
	const hashPassword = jest.fn<() => Promise<string>>();
	const createEnrollment = jest.fn<() => ReturnType<PlatformTotpService['createEnrollment']>>();
	const verifyTotp = jest.fn<() => ReturnType<PlatformTotpService['verify']>>();
	const digest = jest.fn<(value: string) => string>();
	let service: PlatformOwnerBootstrapService;

	beforeAll(async () => {
		const config = new ConfigService<EnvironmentVariables, true>(
			validateEnvironment({
				NODE_ENV: 'test',
				DATABASE_URL: 'postgresql://gym_bootstrap:secret@approved.neon.tech/neondb',
				PLATFORM_OWNER_BOOTSTRAP_ENABLED: 'true',
				PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_HOST: 'approved.neon.tech',
				PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_NAME: 'neondb',
			}),
		);
		const module = await Test.createTestingModule({
			providers: [
				PlatformOwnerBootstrapService,
				{ provide: ConfigService, useValue: config },
				{ provide: PrismaService, useValue: { $transaction: runTransaction } },
				{ provide: PlatformPasswordService, useValue: { hash: hashPassword } },
				{ provide: PlatformTokenService, useValue: { digest } },
				{
					provide: PlatformTotpService,
					useValue: { createEnrollment, verify: verifyTotp },
				},
			],
		}).compile();
		service = module.get(PlatformOwnerBootstrapService);
	});

	beforeEach(() => {
		jest.clearAllMocks();
		executeRaw.mockResolvedValue(1);
		staffCount.mockResolvedValue(0);
		userFindUnique.mockResolvedValue(null);
		roleFindUnique.mockResolvedValue(null);
		roleCreate.mockResolvedValue({ id: 'owner-role-id' });
		permissionFindUnique.mockResolvedValue(null);
		permissionCreate.mockResolvedValue({ id: 'dashboard-permission-id' });
		rolePermissionUpsert.mockResolvedValue({});
		userCreate.mockResolvedValue({ platformStaff: { id: 'staff-id' } });
		staffRoleCreate.mockResolvedValue({});
		totpCreate.mockResolvedValue({ id: 'totp-id' });
		hashPassword.mockResolvedValue('approved-password-hash');
		createEnrollment.mockReturnValue({
			platformStaffId: 'staff-id',
			encryptedSecret: Buffer.from('encrypted'),
			initializationVector: Buffer.alloc(12, 1),
			authenticationTag: Buffer.alloc(16, 2),
			encryptionKeyId: 'local-v1',
			encryptionVersion: 1,
			secret: 'JBSWY3DPEHPK3PXP',
			enrollmentUri: 'otpauth://totp/NEXCODE%20Gym:owner%40example.com',
		});
		totpUpdateMany.mockResolvedValue({ count: 1 });
		userUpdateMany.mockResolvedValue({ count: 1 });
		staffUpdateMany.mockResolvedValue({ count: 1 });
		recoveryCreateMany.mockResolvedValue({ count: 10 });
		verifyTotp.mockReturnValue({ timeStep: 31_556_952n });
		digest.mockImplementation((value) => `${value}-digest`);
	});

	it('creates one pending owner with an explicit permission allowlist', async () => {
		const password = Buffer.from('fictional owner password', 'utf8');

		await expect(
			service.initialize({
				email: 'Owner@Example.com',
				displayName: 'Fictional Owner',
				password,
			}),
		).resolves.toMatchObject({ secret: 'JBSWY3DPEHPK3PXP' });
		expect(userCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					email: 'owner@example.com',
					status: UserStatus.PENDING,
					platformStaff: { create: { status: PlatformStaffStatus.PENDING } },
				}),
			}),
		);
		expect(permissionCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ key: 'platform.dashboard.read' }),
			}),
		);
		expect(password.every((value) => value === 0)).toBe(true);
	});

	it('refuses initialization when any platform staff identity already exists', async () => {
		staffCount.mockResolvedValue(1);

		await expect(
			service.initialize({
				email: 'owner@example.com',
				displayName: 'Fictional Owner',
				password: Buffer.from('fictional owner password', 'utf8'),
			}),
		).rejects.toMatchObject({ code: 'BOOTSTRAP_ALREADY_INITIALIZED' });
		expect(userCreate).not.toHaveBeenCalled();
	});

	it('rejects invalid identity input before opening a transaction', async () => {
		await expect(
			service.initialize({
				email: 'not-an-email',
				displayName: 'Fictional Owner',
				password: Buffer.from('short', 'utf8'),
			}),
		).rejects.toMatchObject({ code: 'BOOTSTRAP_INVALID_INPUT' });
		expect(runTransaction).not.toHaveBeenCalled();
	});

	it('rejects a weak password and clears its mutable buffer', async () => {
		const password = Buffer.from('short', 'utf8');

		await expect(
			service.initialize({
				email: 'owner@example.com',
				displayName: 'Fictional Owner',
				password,
			}),
		).rejects.toMatchObject({ code: 'BOOTSTRAP_INVALID_INPUT' });
		expect(password.every((value) => value === 0)).toBe(true);
		expect(runTransaction).not.toHaveBeenCalled();
	});

	it('refuses to overwrite an existing global identity', async () => {
		userFindUnique.mockResolvedValue({ id: 'existing-user-id' });

		await expect(
			service.initialize({
				email: 'owner@example.com',
				displayName: 'Fictional Owner',
				password: Buffer.from('fictional owner password', 'utf8'),
			}),
		).rejects.toMatchObject({ code: 'BOOTSTRAP_IDENTITY_CONFLICT' });
		expect(userCreate).not.toHaveBeenCalled();
	});

	it('activates only the exact pending owner role and stores recovery digests', async () => {
		staffCount.mockResolvedValue(1);
		userFindUnique.mockResolvedValue(createPendingOwner());

		const result = await service.activate({
			email: 'owner@example.com',
			totpCode: '123456',
			emailOwnershipVerified: true,
		});

		expect(result.recoveryCodes).toHaveLength(10);
		expect(new Set(result.recoveryCodes).size).toBe(10);
		expect(result.recoveryCodes).toEqual(
			expect.arrayContaining([expect.stringMatching(/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/u)]),
		);
		expect(totpUpdateMany).toHaveBeenCalledTimes(1);
		expect(userUpdateMany).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ status: UserStatus.ACTIVE }) }),
		);
		expect(staffUpdateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: { status: PlatformStaffStatus.ACTIVE },
			}),
		);
		expect(recoveryCreateMany).toHaveBeenCalledWith({
			data: result.recoveryCodes.map((code) => ({
				platformStaffId: 'staff-id',
				codeDigest: `${code}-digest`,
			})),
		});
	});

	it('leaves the pending owner inactive when TOTP verification fails', async () => {
		staffCount.mockResolvedValue(1);
		userFindUnique.mockResolvedValue(createPendingOwner());
		verifyTotp.mockReturnValue(null);

		await expect(
			service.activate({
				email: 'owner@example.com',
				totpCode: '000000',
				emailOwnershipVerified: true,
			}),
		).rejects.toMatchObject({ code: 'BOOTSTRAP_MFA_REJECTED' });
		expect(totpUpdateMany).not.toHaveBeenCalled();
		expect(userUpdateMany).not.toHaveBeenCalled();
		expect(recoveryCreateMany).not.toHaveBeenCalled();
	});

	it('rejects a role containing a permission outside the reviewed allowlist', async () => {
		staffCount.mockResolvedValue(1);
		const pendingOwner = createPendingOwner();
		pendingOwner.platformStaff.roles[0]?.platformRole.permissions.push({
			platformPermission: { key: '*' },
		});
		userFindUnique.mockResolvedValue(pendingOwner);

		await expect(
			service.activate({
				email: 'owner@example.com',
				totpCode: '123456',
				emailOwnershipVerified: true,
			}),
		).rejects.toMatchObject({ code: 'BOOTSTRAP_ROLE_CONFLICT' });
		expect(totpUpdateMany).not.toHaveBeenCalled();
	});

	it('fails closed when a concurrent activation wins the conditional update', async () => {
		staffCount.mockResolvedValue(1);
		userFindUnique.mockResolvedValue(createPendingOwner());
		totpUpdateMany.mockResolvedValue({ count: 0 });

		await expect(
			service.activate({
				email: 'owner@example.com',
				totpCode: '123456',
				emailOwnershipVerified: true,
			}),
		).rejects.toMatchObject({ code: 'BOOTSTRAP_CONCURRENT_OPERATION' });
	});
});

interface PendingOwnerFixture {
	readonly id: string;
	readonly status: UserStatus;
	readonly emailVerifiedAt: Date | null;
	readonly platformStaff: {
		readonly id: string;
		readonly status: PlatformStaffStatus;
		readonly roles: {
			readonly platformRole: {
				readonly key: string;
				readonly isSystem: boolean;
				readonly permissions: { readonly platformPermission: { readonly key: string } }[];
			};
		}[];
		readonly totpCredential: {
			readonly id: string;
			readonly platformStaffId: string;
			readonly encryptedSecret: Buffer;
			readonly encryptionKeyId: string;
			readonly encryptionVersion: number;
			readonly initializationVector: Buffer;
			readonly authenticationTag: Buffer;
			readonly createdAt: Date;
			readonly verifiedAt: Date | null;
			readonly lastUsedAt: Date | null;
			readonly lastAcceptedTimeStep: bigint | null;
			readonly disabledAt: Date | null;
		};
	};
}

function createPendingOwner(): PendingOwnerFixture {
	return {
		id: 'user-id',
		status: UserStatus.PENDING,
		emailVerifiedAt: null,
		platformStaff: {
			id: 'staff-id',
			status: PlatformStaffStatus.PENDING,
			roles: [
				{
					platformRole: {
						key: 'platform.owner',
						isSystem: true,
						permissions: [
							{ platformPermission: { key: 'platform.dashboard.read' } },
						],
					},
				},
			],
			totpCredential: {
				id: 'totp-id',
				platformStaffId: 'staff-id',
				encryptedSecret: Buffer.from('encrypted'),
				encryptionKeyId: 'local-v1',
				encryptionVersion: 1,
				initializationVector: Buffer.alloc(12, 1),
				authenticationTag: Buffer.alloc(16, 2),
				createdAt: new Date('2029-01-01T00:00:00.000Z'),
				verifiedAt: null,
				lastUsedAt: null,
				lastAcceptedTimeStep: null,
				disabledAt: null,
			},
		},
	};
}

