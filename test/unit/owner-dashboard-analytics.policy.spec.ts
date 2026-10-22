import {
	dashboardChange,
	resolveDashboardPeriod,
} from '../../src/modules/owner/dashboard/owner-dashboard-analytics.policy.js';

describe('owner dashboard analytics policy', () => {
	it('defaults to the current Kigali month through today and compares equal-length periods', () => {
		const result = resolveDashboardPeriod({}, new Date('2026-10-21T22:30:00.000Z'));

		expect(result.period).toEqual({
			fromDate: '2026-10-01',
			toDate: '2026-10-22',
			comparisonFromDate: '2026-09-09',
			comparisonToDate: '2026-09-30',
			timeZone: 'Africa/Kigali',
			revenueBucket: 'DAY',
		});
		expect(result.selected).toEqual({
			gte: new Date('2026-09-30T22:00:00.000Z'),
			lt: new Date('2026-10-22T22:00:00.000Z'),
		});
		expect(result.comparison).toEqual({
			gte: new Date('2026-09-08T22:00:00.000Z'),
			lt: new Date('2026-09-30T22:00:00.000Z'),
		});
	});

	it('does not advance the Kigali day before local midnight', () => {
		const result = resolveDashboardPeriod({}, new Date('2026-10-21T21:59:59.999Z'));
		expect(result.period.toDate).toBe('2026-10-21');
	});

	it('supports a selected leap-day range and seven-day chart buckets', () => {
		const result = resolveDashboardPeriod(
			{ fromDate: '2024-02-01', toDate: '2024-03-31' },
			new Date('2026-10-22T08:00:00.000Z'),
		);
		expect(result.period).toMatchObject({
			comparisonFromDate: '2023-12-03',
			comparisonToDate: '2024-01-31',
			revenueBucket: 'SEVEN_DAY',
		});
	});

	it('bounds long periods and uses monthly buckets for a full year', () => {
		const now = new Date('2026-10-22T08:00:00.000Z');
		expect(
			resolveDashboardPeriod({ fromDate: '2025-10-22', toDate: '2026-10-22' }, now).period
				.revenueBucket,
		).toBe('MONTH');
		expect(() =>
			resolveDashboardPeriod({ fromDate: '2025-10-21', toDate: '2026-10-22' }, now),
		).toThrow('no more than 366 days');
	});

	it.each([
		{ fromDate: '2026-10-01' },
		{ toDate: '2026-10-22' },
		{ fromDate: '2026-10-23', toDate: '2026-10-23' },
		{ fromDate: '2026-10-22', toDate: '2026-10-01' },
		{ fromDate: '2026-02-30', toDate: '2026-10-01' },
	])('rejects an invalid date selection: %p', (query) => {
		expect(() => resolveDashboardPeriod(query, new Date('2026-10-22T08:00:00.000Z'))).toThrow();
	});

	it('reports increases, decreases and zero baselines without dividing by zero', () => {
		expect(dashboardChange(15_000n, 10_000n)).toEqual({ direction: 'UP', percent: 50 });
		expect(dashboardChange(9n, 20n)).toEqual({ direction: 'DOWN', percent: -55 });
		expect(dashboardChange(1n, 3n)).toEqual({ direction: 'DOWN', percent: -66.7 });
		expect(dashboardChange(0n, 0n)).toEqual({ direction: 'UNCHANGED', percent: 0 });
		expect(dashboardChange(1n, 0n)).toEqual({ direction: 'NEW', percent: null });
		expect(() => dashboardChange(-1n, 0n)).toThrow('cannot be negative');
	});
});
