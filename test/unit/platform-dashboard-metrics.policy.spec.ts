import { BadRequestException } from '@nestjs/common';

import {
	platformDashboardChange,
	resolvePlatformDashboardPeriod,
} from '../../src/modules/platform/dashboard/platform-dashboard-metrics.policy.js';

describe('platform dashboard metrics policy', () => {
	it('uses a custom range and an equally long preceding comparison', () => {
		const result = resolvePlatformDashboardPeriod(
			{ fromDate: '2026-10-10', toDate: '2026-10-12' },
			new Date('2026-10-29T10:00:00.000Z'),
		);
		expect(result.period).toMatchObject({
			mode: 'CUSTOM',
			comparisonFromDate: '2026-10-07',
			comparisonToDate: '2026-10-09',
		});
	});

	it.each([
		{ fromDate: '2026-10-01' },
		{ toDate: '2026-10-01' },
		{ fromDate: '2026-10-01', toDate: '2026-10-02', scope: 'all-time' as const },
		{ fromDate: '2026-10-30', toDate: '2026-10-30' },
	])('rejects incompatible or future filters: %#', (query) => {
		expect(() =>
			resolvePlatformDashboardPeriod(query, new Date('2026-10-29T10:00:00.000Z')),
		).toThrow(BadRequestException);
	});

	it.each([
		{ current: 10, previous: 5, direction: 'UP', percent: 100 },
		{ current: 5, previous: 10, direction: 'DOWN', percent: -50 },
		{ current: 5, previous: 5, direction: 'UNCHANGED', percent: 0 },
		{ current: 5, previous: 0, direction: 'NEW', percent: null },
		{ current: 5, previous: null, direction: 'NOT_APPLICABLE', percent: null },
	])('calculates truthful change for %#', ({ current, previous, direction, percent }) => {
		expect(platformDashboardChange(current, previous)).toEqual({ direction, percent });
	});
});
