import { jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
	INITIAL_ORGANIZATION_ENTITLEMENTS,
	OrganizationStatus,
	PrismaService,
	type OrganizationFeatureEntitlement,
} from '@nexcoderw/gym-db';

import { PlatformOrganizationEntitlementsService } from '../../src/modules/platform/organization-entitlements/platform-organization-entitlements.service.js';
import { UpdateOrganizationEntitlementDto } from '../../src/modules/platform/organization-entitlements/dto/update-organization-entitlement.dto.js';
import { organizationEntitlementPrecondition } from '../../src/modules/platform/organization-entitlements/platform-organization-entitlement-precondition.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-30T08:00:00.000Z');
const FEATURE_KEY = 'organization.members.read';
const CONTEXT = { actorPlatformStaffId: STAFF_ID, requestId: 'fictional-request-id' };

function entitlement(version = 1): OrganizationFeatureEntitlement {
	return {
		organizationId: ORGANIZATION_ID,
		featureKey: FEATURE_KEY,
		enabled: true,
		startsAt: null,
		expiresAt: null,
		version,
		updatedByPlatformStaffId: STAFF_ID,
		createdAt: NOW,
		updatedAt: NOW,
	};
}

describe('platform organization entitlement service', () => {
	let module: TestingModule;
	let service: PlatformOrganizationEntitlementsService;
	const organizationFindUnique =
		jest.fn<(args: unknown) => Promise<{ id: string; status: OrganizationStatus } | null>>();
	const entitlementFindMany =
		jest.fn<(args: unknown) => Promise<OrganizationFeatureEntitlement[]>>();
	const entitlementFindUnique =
		jest.fn<(args: unknown) => Promise<OrganizationFeatureEntitlement | null>>();
	const entitlementCreate = jest.fn<(args: unknown) => Promise<OrganizationFeatureEntitlement>>();
	const entitlementUpdateMany = jest.fn<(args: unknown) => Promise<{ count: number }>>();
	const auditCreate = jest.fn<(args: unknown) => Promise<{ id: string }>>();
	const transactionClient = {
		organization: { findUnique: organizationFindUnique },
		organizationFeatureEntitlement: {
			findMany: entitlementFindMany,
			findUnique: entitlementFindUnique,
			create: entitlementCreate,
			updateMany: entitlementUpdateMany,
		},
		organizationFeatureEntitlementAuditEvent: { create: auditCreate },
	};
	type TransactionOperation =
		Promise<unknown>[] | ((client: typeof transactionClient) => Promise<unknown>);
	const transaction = jest
		.fn<(operation: TransactionOperation, options?: unknown) => Promise<unknown>>()
		.mockImplementation((operation) => {
			if (typeof operation === 'function') return operation(transactionClient);
			return Promise.all(operation);
		});

	beforeEach(async () => {
		jest.clearAllMocks();
		organizationFindUnique.mockResolvedValue({
			id: ORGANIZATION_ID,
			status: OrganizationStatus.ACTIVE,
		});
		entitlementFindMany.mockResolvedValue([entitlement()]);
		entitlementFindUnique.mockResolvedValue(entitlement());
		entitlementCreate.mockResolvedValue(entitlement());
		entitlementUpdateMany.mockResolvedValue({ count: 1 });
		auditCreate.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' });
		module = await Test.createTestingModule({
			providers: [
				PlatformOrganizationEntitlementsService,
				{
					provide: PrismaService,
					useValue: { ...transactionClient, $transaction: transaction },
				},
			],
		}).compile();
		service = module.get(PlatformOrganizationEntitlementsService);
	});

	afterEach(async () => module.close());

	it('returns the complete reviewed catalog and denies missing rows by default', async () => {
		const response = await service.list(ORGANIZATION_ID);
		expect(response.items).toHaveLength(INITIAL_ORGANIZATION_ENTITLEMENTS.length);
		expect(response.items.find((item) => item.featureKey === FEATURE_KEY)).toMatchObject({
			enabled: true,
			version: 1,
		});
		expect(
			response.items.find((item) => item.featureKey === 'organization.members.create'),
		).toMatchObject({ enabled: false, effectiveStatus: 'DISABLED', version: 0 });
	});

	it('updates by version and appends platform-admin audit evidence atomically', async () => {
		entitlementFindUnique
			.mockResolvedValueOnce(entitlement())
			.mockResolvedValueOnce({ ...entitlement(2), enabled: false });
		const response = await service.update(CONTEXT, ORGANIZATION_ID, FEATURE_KEY, 1, {
			enabled: false,
			reason: 'Disable member visibility for the approved organization plan.',
		});
		expect(response).toMatchObject({ enabled: false, version: 2, effectiveStatus: 'DISABLED' });
		expect(entitlementUpdateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { organizationId: ORGANIZATION_ID, featureKey: FEATURE_KEY, version: 1 },
				data: expect.objectContaining({ enabled: false, version: { increment: 1 } }),
			}),
		);
		expect(auditCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					organizationId: ORGANIZATION_ID,
					featureKey: FEATURE_KEY,
					source: 'PLATFORM_ADMIN',
					actorPlatformStaffId: STAFF_ID,
					requestId: CONTEXT.requestId,
					resultingVersion: 2,
				}),
			}),
		);
	});

	it('provisions a missing reviewed key only from version zero', async () => {
		const created = {
			...entitlement(),
			featureKey: 'organization.members.create',
		};
		entitlementFindUnique.mockResolvedValueOnce(null);
		entitlementCreate.mockResolvedValueOnce(created);
		const response = await service.update(
			CONTEXT,
			ORGANIZATION_ID,
			'organization.members.create',
			0,
			{
				enabled: true,
				reason: 'Provision the reviewed member creation capability.',
			},
		);
		expect(response).toMatchObject({
			featureKey: 'organization.members.create',
			enabled: true,
			version: 1,
		});
		expect(entitlementCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					organizationId: ORGANIZATION_ID,
					featureKey: 'organization.members.create',
					version: 1,
				}),
			}),
		);
	});

	it('rejects unknown keys, stale versions, invalid windows and audit failures safely', async () => {
		await expect(
			service.update(CONTEXT, ORGANIZATION_ID, 'organization.unreviewed.read', 0, {
				enabled: true,
				reason: 'Attempt an unknown organization capability.',
			}),
		).rejects.toMatchObject({ status: 400 });
		await expect(
			service.update(CONTEXT, ORGANIZATION_ID, FEATURE_KEY, 0, {
				enabled: false,
				reason: 'Use an intentionally stale entitlement version.',
			}),
		).rejects.toMatchObject({ status: 412 });
		await expect(
			service.update(CONTEXT, ORGANIZATION_ID, FEATURE_KEY, 1, {
				startsAt: '2026-12-02T00:00:00.000Z',
				expiresAt: '2026-12-01T00:00:00.000Z',
				reason: 'Attempt an invalid entitlement activation window.',
			}),
		).rejects.toMatchObject({ status: 400 });
		entitlementFindUnique
			.mockResolvedValueOnce(entitlement())
			.mockResolvedValueOnce({ ...entitlement(2), enabled: false });
		auditCreate.mockRejectedValueOnce(new Error('private audit failure'));
		await expect(
			service.update(CONTEXT, ORGANIZATION_ID, FEATURE_KEY, 1, {
				enabled: false,
				reason: 'Exercise the durable entitlement audit failure boundary.',
			}),
		).rejects.toMatchObject({ status: 503 });
	});

	it('validates bounded mutation input and exact quoted versions', async () => {
		expect(
			await validate(
				plainToInstance(UpdateOrganizationEntitlementDto, {
					enabled: true,
					startsAt: '2026-12-01T08:00:00.000Z',
					reason: 'Schedule the reviewed capability for the organization.',
				}),
			),
		).toEqual([]);
		expect(
			await validate(
				plainToInstance(UpdateOrganizationEntitlementDto, {
					enabled: true,
					startsAt: '2026-12-01T08:00:00',
					reason: 'Schedule the reviewed capability for the organization.',
				}),
			),
		).not.toEqual([]);
		expect(organizationEntitlementPrecondition('"0"')).toBe(0);
		expect(organizationEntitlementPrecondition('"12"')).toBe(12);
		for (const value of [undefined, '*', '12', '"01"', ['"1"']]) {
			expect(() => organizationEntitlementPrecondition(value)).toThrow();
		}
	});
});
