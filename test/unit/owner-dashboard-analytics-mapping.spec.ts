import { OrganizationPaymentStatus } from '@nexcoderw/gym-db';

import {
	dashboardFinancialSummary,
	safeCount,
} from '../../src/modules/owner/dashboard/owner-dashboard-analytics-mapping.js';
import { resolveDashboardPeriod } from '../../src/modules/owner/dashboard/owner-dashboard-analytics.policy.js';

describe('owner dashboard financial mapping', () => {
	it('reconciles daily revenue with settled report totals and excludes pending value', () => {
		const { period } = resolveDashboardPeriod(
			{ fromDate: '2026-01-01', toDate: '2026-01-03' },
			new Date('2026-01-04T08:00:00.000Z'),
		);
		const result = dashboardFinancialSummary(
			[
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
				{
					day: '2026-01-02',
					status: OrganizationPaymentStatus.PENDING,
					count: 1n,
					amountRwf: 5_000n,
					refundedRwf: 0n,
				},
				{
					day: '2026-01-03',
					status: OrganizationPaymentStatus.REFUNDED,
					count: 1n,
					amountRwf: 10_000n,
					refundedRwf: 10_000n,
				},
			],
			period,
		);

		expect(result.selected).toMatchObject({
			paymentCount: 3,
			settledPaymentCount: 2,
			grossRwf: '25000',
			refundedRwf: '12000',
			netRwf: '13000',
		});
		expect(result.comparison.netRwf).toBe('10000');
		expect(result.revenueSeries).toEqual([
			{
				fromDate: '2026-01-01',
				toDate: '2026-01-01',
				grossRwf: '15000',
				refundedRwf: '2000',
				netRwf: '13000',
			},
			{
				fromDate: '2026-01-02',
				toDate: '2026-01-02',
				grossRwf: '0',
				refundedRwf: '0',
				netRwf: '0',
			},
			{
				fromDate: '2026-01-03',
				toDate: '2026-01-03',
				grossRwf: '10000',
				refundedRwf: '10000',
				netRwf: '0',
			},
		]);
	});

	it('returns zero-filled, bounded buckets for an empty period', () => {
		const weekly = resolveDashboardPeriod(
			{ fromDate: '2026-01-01', toDate: '2026-03-01' },
			new Date('2026-03-02T08:00:00.000Z'),
		).period;
		const result = dashboardFinancialSummary([], weekly);
		expect(result.selected.netRwf).toBe('0');
		expect(result.revenueSeries).toHaveLength(9);
		expect(result.revenueSeries[0]).toMatchObject({
			fromDate: '2026-01-01',
			toDate: '2026-01-07',
			netRwf: '0',
		});
		expect(result.revenueSeries.at(-1)).toMatchObject({
			fromDate: '2026-02-26',
			toDate: '2026-03-01',
		});
	});

	it('rejects unsafe aggregate counts', () => {
		expect(() => safeCount(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow();
		expect(() => safeCount(-1n)).toThrow();
	});
});
