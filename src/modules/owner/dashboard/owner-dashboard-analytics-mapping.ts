import { OrganizationPaymentStatus } from '@nexcoderw/gym-db';

import {
	isSettledPaymentStatus,
	paymentReportTotals,
	type PaymentReportStatusTotal,
	type PaymentReportTotals,
} from '../reports/payment-report-policy.js';
import type { DashboardRevenuePointDto } from './dto/owner-dashboard-analytics.dto.js';
import type { ResolvedDashboardPeriod } from './owner-dashboard-analytics.policy.js';

const DAY_MS = 86_400_000;

export interface DashboardFinancialDayRow {
	readonly day: string;
	readonly status: OrganizationPaymentStatus;
	readonly count: bigint;
	readonly amountRwf: bigint;
	readonly refundedRwf: bigint;
}

interface MutableRevenueBucket {
	readonly fromDate: string;
	readonly toDate: string;
	grossRwf: bigint;
	refundedRwf: bigint;
}

export interface DashboardFinancialSummary {
	readonly selected: PaymentReportTotals;
	readonly comparison: PaymentReportTotals;
	readonly revenueSeries: DashboardRevenuePointDto[];
}

/** Fold bounded daily database aggregates, never individual payment rows. */
export function dashboardFinancialSummary(
	rows: readonly DashboardFinancialDayRow[],
	period: ResolvedDashboardPeriod['period'],
): DashboardFinancialSummary {
	const buckets = revenueBuckets(period.fromDate, period.toDate, period.revenueBucket);
	const selectedStatuses: PaymentReportStatusTotal[] = [];
	const comparisonStatuses: PaymentReportStatusTotal[] = [];
	let selectedRefunds = 0n;
	let comparisonRefunds = 0n;

	for (const row of rows) {
		const statusTotal = {
			status: row.status,
			count: safeCount(row.count),
			amountRwf: row.amountRwf,
		};
		if (row.day >= period.fromDate && row.day <= period.toDate) {
			selectedStatuses.push(statusTotal);
			selectedRefunds += row.refundedRwf;
			const bucket = buckets.find((item) => row.day >= item.fromDate && row.day <= item.toDate);
			if (bucket === undefined) throw new Error('Dashboard revenue day has no bucket.');
			if (isSettledPaymentStatus(row.status)) bucket.grossRwf += row.amountRwf;
			bucket.refundedRwf += row.refundedRwf;
		} else if (row.day >= period.comparisonFromDate && row.day <= period.comparisonToDate) {
			comparisonStatuses.push(statusTotal);
			comparisonRefunds += row.refundedRwf;
		} else {
			throw new Error('Dashboard revenue day is outside the requested periods.');
		}
	}

	const selected = paymentReportTotals(selectedStatuses, selectedRefunds);
	const comparison = paymentReportTotals(comparisonStatuses, comparisonRefunds);
	const revenueSeries = buckets.map((bucket) => {
		if (bucket.refundedRwf > bucket.grossRwf) {
			throw new Error('Dashboard revenue bucket has more refunds than gross value.');
		}
		return {
			fromDate: bucket.fromDate,
			toDate: bucket.toDate,
			grossRwf: bucket.grossRwf.toString(),
			refundedRwf: bucket.refundedRwf.toString(),
			netRwf: (bucket.grossRwf - bucket.refundedRwf).toString(),
		};
	});

	return { selected, comparison, revenueSeries };
}

export function safeCount(value: bigint): number {
	if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error('Dashboard count is outside the safe integer range.');
	}
	return Number(value);
}

function revenueBuckets(
	fromDate: string,
	toDate: string,
	granularity: ResolvedDashboardPeriod['period']['revenueBucket'],
): MutableRevenueBucket[] {
	const buckets: MutableRevenueBucket[] = [];
	let start = fromDate;
	while (start <= toDate) {
		const end =
			granularity === 'DAY'
				? start
				: granularity === 'SEVEN_DAY'
					? addDays(start, 6)
					: lastDayOfMonth(start);
		const boundedEnd = end < toDate ? end : toDate;
		buckets.push({ fromDate: start, toDate: boundedEnd, grossRwf: 0n, refundedRwf: 0n });
		start = addDays(boundedEnd, 1);
	}
	return buckets;
}

function addDays(value: string, days: number): string {
	return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function lastDayOfMonth(value: string): string {
	const nextMonth = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
	nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
	return new Date(nextMonth.getTime() - DAY_MS).toISOString().slice(0, 10);
}
