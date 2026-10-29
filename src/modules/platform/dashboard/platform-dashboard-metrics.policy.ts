import { BadRequestException } from '@nestjs/common';

import type {
	PlatformDashboardMetricChangeDto,
	PlatformDashboardMetricsPeriodDto,
	PlatformDashboardMetricsQueryDto,
} from './dto/platform-dashboard-metrics.dto.js';

const DAY_MS = 86_400_000;
const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1_000;
const MAX_DAYS = 366;

export interface PlatformDashboardDateRange {
	readonly gte: Date;
	readonly lt: Date;
}

export interface ResolvedPlatformDashboardPeriod {
	readonly period: PlatformDashboardMetricsPeriodDto;
	readonly selected: PlatformDashboardDateRange | null;
	readonly comparison: PlatformDashboardDateRange | null;
}

export function resolvePlatformDashboardPeriod(
	query: Readonly<PlatformDashboardMetricsQueryDto>,
	now: Date,
): ResolvedPlatformDashboardPeriod {
	if (Number.isNaN(now.getTime())) throw new Error('A valid current time is required.');
	if (query.scope === 'all-time') {
		if (query.fromDate !== undefined || query.toDate !== undefined) {
			throw new BadRequestException('All-time metrics cannot include date filters.');
		}
		return {
			period: {
				mode: 'ALL_TIME',
				fromDate: null,
				toDate: null,
				comparisonFromDate: null,
				comparisonToDate: null,
				timeZone: 'Africa/Kigali',
			},
			selected: null,
			comparison: null,
		};
	}
	if ((query.fromDate === undefined) !== (query.toDate === undefined)) {
		throw new BadRequestException('Supply both dashboard dates or neither.');
	}

	const today = kigaliDate(now);
	const fromDate = query.fromDate ?? `${today.slice(0, 7)}-01`;
	const toDate = query.toDate ?? today;
	const selected = dateRange(fromDate, toDate);
	if (toDate > today) throw new BadRequestException('Dashboard dates cannot be in the future.');
	const days = (selected.lt.getTime() - selected.gte.getTime()) / DAY_MS;
	if (days > MAX_DAYS) {
		throw new BadRequestException('Choose a dashboard range of no more than 366 days.');
	}

	const isDefault = query.fromDate === undefined;
	const comparisonDates = isDefault
		? previousMonthToDate(toDate)
		: previousEqualRange(fromDate, days);
	return {
		period: {
			mode: isDefault ? 'CURRENT_MONTH' : 'CUSTOM',
			fromDate,
			toDate,
			comparisonFromDate: comparisonDates.fromDate,
			comparisonToDate: comparisonDates.toDate,
			timeZone: 'Africa/Kigali',
		},
		selected,
		comparison: dateRange(comparisonDates.fromDate, comparisonDates.toDate),
	};
}

export function platformDashboardChange(
	current: number,
	previous: number | null,
): PlatformDashboardMetricChangeDto {
	if (
		!Number.isSafeInteger(current) ||
		current < 0 ||
		(previous !== null && (!Number.isSafeInteger(previous) || previous < 0))
	) {
		throw new Error('Dashboard metric values must be nonnegative safe integers.');
	}
	if (previous === null) return { direction: 'NOT_APPLICABLE', percent: null };
	if (previous === 0) {
		return current === 0
			? { direction: 'UNCHANGED', percent: 0 }
			: { direction: 'NEW', percent: null };
	}
	const percent = Math.round(((current - previous) / previous) * 1_000) / 10;
	return {
		direction: current > previous ? 'UP' : current < previous ? 'DOWN' : 'UNCHANGED',
		percent,
	};
}

function dateRange(fromDate: string, toDate: string): PlatformDashboardDateRange {
	if (fromDate > toDate) throw new BadRequestException('From date must not be after to date.');
	return { gte: kigaliMidnight(fromDate), lt: kigaliMidnight(toDate, 1) };
}

function kigaliMidnight(value: string, addDays = 0): Date {
	const date = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
		throw new BadRequestException('Use a valid calendar date in YYYY-MM-DD format.');
	}
	date.setUTCDate(date.getUTCDate() + addDays);
	date.setUTCHours(date.getUTCHours() - 2);
	return date;
}

function kigaliDate(now: Date): string {
	return new Date(now.getTime() + KIGALI_OFFSET_MS).toISOString().slice(0, 10);
}

function previousMonthToDate(toDate: string): { fromDate: string; toDate: string } {
	const [year, month, day] = toDate.split('-').map(Number);
	const previousMonth = new Date(Date.UTC(year ?? 0, (month ?? 1) - 2, 1));
	const daysInMonth = new Date(
		Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, 0),
	).getUTCDate();
	const endDay = Math.min(day ?? 1, daysInMonth);
	return {
		fromDate: previousMonth.toISOString().slice(0, 8) + '01',
		toDate: new Date(Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth(), endDay))
			.toISOString()
			.slice(0, 10),
	};
}

function previousEqualRange(fromDate: string, days: number): { fromDate: string; toDate: string } {
	const comparisonTo = Date.parse(`${fromDate}T00:00:00.000Z`) - DAY_MS;
	return {
		fromDate: new Date(comparisonTo - (days - 1) * DAY_MS).toISOString().slice(0, 10),
		toDate: new Date(comparisonTo).toISOString().slice(0, 10),
	};
}
