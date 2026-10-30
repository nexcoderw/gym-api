import { jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ORGANIZATION_ENTITLEMENT, TenantTransactionService } from '@nexcoderw/gym-db';

import { OwnerEntitlementService } from '../../src/modules/owner/entitlements/owner-entitlement.service.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-30T08:00:00.000Z');
const CONTEXT = {
	organizationId: ORGANIZATION_ID,
};

describe('owner entitlement service', () => {
	let module: TestingModule | undefined;
	let service: OwnerEntitlementService;
	const count = jest.fn<() => Promise<number>>();
	const findMany = jest.fn<() => Promise<{ featureKey: string }[]>>();
	const transaction = { organizationFeatureEntitlement: { count, findMany } };
	const run =
		jest.fn<
			(
				context: unknown,
				operation: (value: typeof transaction) => Promise<unknown>,
			) => Promise<unknown>
		>();

	beforeEach(async () => {
		jest.resetAllMocks();
		run.mockImplementation(async (_context, operation) => operation(transaction));
		module = await Test.createTestingModule({
			providers: [
				OwnerEntitlementService,
				{ provide: TenantTransactionService, useValue: { run } },
			],
		}).compile();
		service = module.get(OwnerEntitlementService);
	});

	afterEach(async () => module?.close());

	it('requires every unique entitlement to be live in one organization-scoped query', async () => {
		count.mockResolvedValue(2);

		await expect(
			service.hasAllEnabled(
				CONTEXT,
				[
					ORGANIZATION_ENTITLEMENT.membersRead,
					ORGANIZATION_ENTITLEMENT.membersCreate,
					ORGANIZATION_ENTITLEMENT.membersRead,
				],
				NOW,
			),
		).resolves.toBe(true);
		expect(run).toHaveBeenCalledWith(CONTEXT, expect.any(Function));
		expect(count).toHaveBeenCalledWith({
			where: {
				organizationId: ORGANIZATION_ID,
				featureKey: {
					in: [ORGANIZATION_ENTITLEMENT.membersRead, ORGANIZATION_ENTITLEMENT.membersCreate],
				},
				enabled: true,
				AND: [
					{ OR: [{ startsAt: null }, { startsAt: { lte: NOW } }] },
					{ OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
				],
			},
		});
	});

	it('lists only live capabilities in stable key order for portal presentation', async () => {
		findMany.mockResolvedValue([
			{ featureKey: ORGANIZATION_ENTITLEMENT.membersRead },
			{ featureKey: ORGANIZATION_ENTITLEMENT.paymentsRead },
		]);

		await expect(service.listEnabled(CONTEXT, NOW)).resolves.toEqual([
			ORGANIZATION_ENTITLEMENT.membersRead,
			ORGANIZATION_ENTITLEMENT.paymentsRead,
		]);
		expect(run).toHaveBeenCalledWith(CONTEXT, expect.any(Function));
		expect(findMany).toHaveBeenCalledWith({
			where: {
				organizationId: ORGANIZATION_ID,
				enabled: true,
				AND: [
					{ OR: [{ startsAt: null }, { startsAt: { lte: NOW } }] },
					{ OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
				],
			},
			select: { featureKey: true },
			orderBy: { featureKey: 'asc' },
		});
	});

	it('denies when one required entitlement is absent, disabled or outside its window', async () => {
		count.mockResolvedValue(1);

		await expect(
			service.hasAllEnabled(
				CONTEXT,
				[ORGANIZATION_ENTITLEMENT.membersRead, ORGANIZATION_ENTITLEMENT.membersCreate],
				NOW,
			),
		).resolves.toBe(false);
	});

	it('denies an empty declaration without querying tenant state', async () => {
		await expect(service.hasAllEnabled(CONTEXT, [], NOW)).resolves.toBe(false);
		expect(run).not.toHaveBeenCalled();
		expect(count).not.toHaveBeenCalled();
	});

	it('returns a safe unavailable error when live entitlement evaluation fails', async () => {
		run.mockRejectedValueOnce(new Error('private database detail'));
		const result = service.hasAllEnabled(CONTEXT, [ORGANIZATION_ENTITLEMENT.membersRead], NOW);

		await expect(result).rejects.toMatchObject({
			response: { code: 'ORGANIZATION_ENTITLEMENT_UNAVAILABLE' },
		});
		await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
	});

	it('returns the same safe unavailable error when capability listing fails', async () => {
		run.mockRejectedValueOnce(new Error('private database detail'));
		const result = service.listEnabled(CONTEXT, NOW);

		await expect(result).rejects.toMatchObject({
			response: { code: 'ORGANIZATION_ENTITLEMENT_UNAVAILABLE' },
		});
		await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
	});

	it('fails closed when persistence returns an unreviewed capability key', async () => {
		findMany.mockResolvedValue([{ featureKey: 'organization.unreviewed.read' }]);
		const result = service.listEnabled(CONTEXT, NOW);

		await expect(result).rejects.toMatchObject({
			response: { code: 'ORGANIZATION_ENTITLEMENT_UNAVAILABLE' },
		});
		await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
	});
});
