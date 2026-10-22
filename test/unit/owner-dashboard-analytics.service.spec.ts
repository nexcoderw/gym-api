import { jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
	OrganizationPaymentMethod,
	OrganizationPaymentStatus,
	TenantTransactionService,
} from '@nexcoderw/gym-db';

import { OwnerDashboardAnalyticsService } from '../../src/modules/owner/dashboard/owner-dashboard-analytics.service.js';

const CONTEXT = {
	organizationId: '11111111-1111-4111-8111-111111111111',
	actorUserId: '22222222-2222-4222-8222-222222222222',
	requestId: '33333333-3333-4333-8333-333333333333',
};
const QUERY = { fromDate: '2026-01-01', toDate: '2026-01-02' };
const NOW = new Date('2026-01-03T08:00:00.000Z');

describe('owner dashboard analytics service', () => {
	let module: TestingModule | undefined;
	let service: OwnerDashboardAnalyticsService;
	const queryRaw = jest.fn<(..._arguments: unknown[]) => Promise<unknown[]>>();
	const count = jest.fn<() => Promise<number>>();
	const groupBy = jest.fn<() => Promise<unknown[]>>();
	const transaction = {
		$queryRaw: queryRaw,
		organizationMember: { count },
		organizationPayment: { groupBy },
	};
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
		queryRaw
			.mockResolvedValueOnce([
				{
					day: '2025-12-31',
					status: OrganizationPaymentStatus.CONFIRMED,
					count: 1n,
					amountRwf: 10_000n,
					refundedRwf: 0n,
				},
				{
					day: '2026-01-01',
					status: OrganizationPaymentStatus.CONFIRMED,
					count: 1n,
					amountRwf: 15_000n,
					refundedRwf: 2_000n,
				},
			])
			.mockResolvedValueOnce([
				{ label: 'selected', memberCount: 3n },
				{ label: 'comparison', memberCount: 2n },
			])
			.mockResolvedValueOnce([
				{
					planId: '44444444-4444-4444-8444-444444444444',
					planName: 'Gold Plan',
					grossRwf: 15_000n,
				},
			]);
		count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
		groupBy.mockResolvedValue([
			{
				method: OrganizationPaymentMethod.CASH,
				_count: { _all: 1 },
				_sum: { amountRwf: 15_000n },
			},
		]);
		module = await Test.createTestingModule({
			providers: [
				OwnerDashboardAnalyticsService,
				{ provide: TenantTransactionService, useValue: { run } },
			],
		}).compile();
		service = module.get(OwnerDashboardAnalyticsService);
	});

	afterEach(async () => module?.close());

	it('returns only aggregated metrics scoped to the authenticated gym', async () => {
		const result = await service.get(CONTEXT, QUERY, NOW);
		expect(run).toHaveBeenCalledWith(CONTEXT, expect.any(Function));
		for (const call of queryRaw.mock.calls) {
			expect(call).toContain(CONTEXT.organizationId);
		}
		expect(count).toHaveBeenNthCalledWith(1, {
			where: {
				organizationId: CONTEXT.organizationId,
				createdAt: {
					gte: new Date('2025-12-31T22:00:00.000Z'),
					lt: new Date('2026-01-02T22:00:00.000Z'),
				},
			},
		});
		expect(groupBy).toHaveBeenCalledWith({
			by: ['method'],
			where: {
				organizationId: CONTEXT.organizationId,
				occurredAt: {
					gte: new Date('2025-12-31T22:00:00.000Z'),
					lt: new Date('2026-01-02T22:00:00.000Z'),
				},
				status: {
					in: [
						OrganizationPaymentStatus.CONFIRMED,
						OrganizationPaymentStatus.PARTIALLY_REFUNDED,
						OrganizationPaymentStatus.REFUNDED,
					],
				},
			},
			_count: { _all: true },
			_sum: { amountRwf: true },
		});
		expect(result).toMatchObject({
			period: {
				fromDate: '2026-01-01',
				toDate: '2026-01-02',
				comparisonFromDate: '2025-12-30',
				comparisonToDate: '2025-12-31',
			},
			currency: 'RWF',
			metrics: {
				netCollected: {
					currentRwf: '13000',
					previousRwf: '10000',
					change: { direction: 'UP', percent: 30 },
				},
				settledPayments: { current: 1, previous: 1 },
				newMembers: { current: 2, previous: 1 },
				activeSubscribers: { current: 3, previous: 2 },
			},
			planTotals: [{ planName: 'Gold Plan', grossRwf: '15000' }],
			methodTotals: [{ method: OrganizationPaymentMethod.CASH, grossRwf: '15000' }],
			generatedAt: NOW.toISOString(),
		});
		expect(result.revenueSeries.map((point) => point.netRwf)).toEqual(['13000', '0']);
	});

	it('rejects invalid ranges before opening a tenant transaction', async () => {
		await expect(service.get(CONTEXT, { fromDate: '2026-01-01' }, NOW)).rejects.toMatchObject({
			status: 400,
		});
		expect(run).not.toHaveBeenCalled();
	});

	it('returns a safe unavailable error when aggregation fails', async () => {
		queryRaw.mockReset().mockRejectedValue(new Error('private database detail'));
		await expect(service.get(CONTEXT, QUERY, NOW)).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
	});
});
