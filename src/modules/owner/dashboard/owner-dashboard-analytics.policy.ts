import { BadRequestException } from '@nestjs/common';

import { listDateRange } from '../list-date-range.js';
import type {
	DashboardChangeDto,
	DashboardPeriodDto,
	OwnerDashboardAnalyticsQueryDto,
} from './dto/owner-dashboard-analytics.dto.js';

const DAY_MS = 86_400_000;
const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1_000;
const MAX_DAYS = 366;

export interface DashboardDateRange {
	readonly gte: Date;
	readonly lt: Date;
}

export interface ResolvedDashboardPeriod {
	readonly period: DashboardPeriodDto;
	readonly selected: DashboardDateRange;
	readonly comparison: DashboardDateRange;
}

/** Default to month-to-date; compare with the immediately preceding, equally long period. */
export function resolveDashboardPeriod(
	query: Readonly<OwnerDashboardAnalyticsQueryDto>,
	now: Date,
): ResolvedDashboardPeriod {
	if (Number.isNaN(now.getTime())) {
		throw new Error('A valid current time is required.');
	}
	if ((query.fromDate === undefined) !== (query.toDate === undefined)) {
		throw new BadRequestException('Supply both dashboard dates or neither.');
	}

	const today = new Date(now.getTime() + KIGALI_OFFSET_MS).toISOString().slice(0, 10);
	const fromDate = query.fromDate ?? `${today.slice(0, 7)}-01`;
	const toDate = query.toDate ?? today;
	const selected = requiredDateRange(fromDate, toDate);
	if (toDate > today) {
		throw new BadRequestException('Dashboard dates cannot be in the future.');
	}

	const days = (selected.lt.getTime() - selected.gte.getTime()) / DAY_MS;
	if (days > MAX_DAYS) {
		throw new BadRequestException('Choose a dashboard range of no more than 366 days.');
	}
	const comparisonToDate = dayBefore(fromDate);
	const comparisonFromDate = new Date(
		Date.parse(`${comparisonToDate}T00:00:00.000Z`) - (days - 1) * DAY_MS,
	)
		.toISOString()
		.slice(0, 10);

	return {
		period: {
			fromDate,
			toDate,
			comparisonFromDate,
			comparisonToDate,
			timeZone: 'Africa/Kigali',
			revenueBucket: days <= 45 ? 'DAY' : days <= 180 ? 'SEVEN_DAY' : 'MONTH',
		},
		selected,
		comparison: requiredDateRange(comparisonFromDate, comparisonToDate),
	};
}

/** Money stays integer throughout; only the display percentage is converted to a number. */
export function dashboardChange(current: bigint, previous: bigint): DashboardChangeDto {
	if (current < 0n || previous < 0n) {
		throw new Error('Dashboard metric values cannot be negative.');
	}
	if (previous === 0n) {
		return current === 0n
			? { direction: 'UNCHANGED', percent: 0 }
			: { direction: 'NEW', percent: null };
	}
	const difference = current - previous;
	const absoluteDifference = difference < 0n ? -difference : difference;
	const roundedTenths = (absoluteDifference * 1_000n + previous / 2n) / previous;
	const percent = Number(difference < 0n ? -roundedTenths : roundedTenths) / 10;
	return {
		direction: difference > 0n ? 'UP' : difference < 0n ? 'DOWN' : 'UNCHANGED',
		percent: Number.isFinite(percent) ? percent : null,
	};
}

function requiredDateRange(fromDate: string, toDate: string): DashboardDateRange {
	const range = listDateRange(fromDate, toDate);
	if (range.gte === undefined || range.lt === undefined) {
		throw new BadRequestException('Both dashboard dates are required.');
	}
	return { gte: range.gte, lt: range.lt };
}

function dayBefore(value: string): string {
	return new Date(Date.parse(`${value}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10);
}
