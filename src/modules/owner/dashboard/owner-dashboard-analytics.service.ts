import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { OrganizationPaymentStatus, TenantTransactionService } from '@nexcoderw/gym-db';

import type { OwnerPaymentContext } from '../payments/owner-payment-context.js';
import type {
	DashboardCountMetricDto,
	OwnerDashboardAnalyticsQueryDto,
	OwnerDashboardAnalyticsResponseDto,
} from './dto/owner-dashboard-analytics.dto.js';
import {
	dashboardFinancialSummary,
	safeCount,
	type DashboardFinancialDayRow,
} from './owner-dashboard-analytics-mapping.js';
import { dashboardChange, resolveDashboardPeriod } from './owner-dashboard-analytics.policy.js';

const SETTLED_STATUSES = [
	OrganizationPaymentStatus.CONFIRMED,
	OrganizationPaymentStatus.PARTIALLY_REFUNDED,
	OrganizationPaymentStatus.REFUNDED,
];

interface PlanTotalRow {
	readonly planId: string | null;
	readonly planName: string;
	readonly grossRwf: bigint;
}

interface ActiveSubscriberRow {
	readonly label: 'selected' | 'comparison';
	readonly memberCount: bigint;
}

@Injectable()
export class OwnerDashboardAnalyticsService {
	constructor(private readonly tenants: TenantTransactionService) {}

	async get(
		context: OwnerPaymentContext,
		query: OwnerDashboardAnalyticsQueryDto,
		now = new Date(),
	): Promise<OwnerDashboardAnalyticsResponseDto> {
		const range = resolveDashboardPeriod(query, now);
		const { period, selected, comparison } = range;

		try {
			return await this.tenants.run(context, async (transaction) => {
				// Group in PostgreSQL before crossing the API boundary. Refunds follow their original
				// payment's occurrence day, which keeps the chart and report net totals consistent.
				const financialRows = await transaction.$queryRaw<DashboardFinancialDayRow[]>`
					SELECT
						TO_CHAR(p.occurred_at AT TIME ZONE 'Africa/Kigali', 'YYYY-MM-DD') AS day,
						UPPER(p.status::text) AS status,
						COUNT(*)::bigint AS count,
						SUM(p.amount_rwf)::bigint AS "amountRwf",
						SUM(COALESCE(refunds.amount_rwf, 0))::bigint AS "refundedRwf"
					FROM public.organization_payments AS p
					LEFT JOIN LATERAL (
						SELECT SUM(r.amount_rwf)::bigint AS amount_rwf
						FROM public.organization_payment_refunds AS r
						WHERE r.organization_id = p.organization_id
							AND r.payment_id = p.id
							AND r.status = 'confirmed'
					) AS refunds ON TRUE
					WHERE p.organization_id = ${context.organizationId}::uuid
						AND p.occurred_at >= ${comparison.gte}
						AND p.occurred_at < ${selected.lt}
					GROUP BY day, p.status
					ORDER BY day, status
				`;
				const financial = dashboardFinancialSummary(financialRows, period);

				const newMembers = await transaction.organizationMember.count({
					where: { organizationId: context.organizationId, createdAt: selected },
				});
				const previousNewMembers = await transaction.organizationMember.count({
					where: { organizationId: context.organizationId, createdAt: comparison },
				});
				const activeRows = await transaction.$queryRaw<ActiveSubscriberRow[]>`
					WITH boundaries(label, day, cutoff) AS (
						VALUES
							('selected', ${period.toDate}::date, ${selected.lt}::timestamptz),
							('comparison', ${period.comparisonToDate}::date, ${comparison.lt}::timestamptz)
					)
					SELECT b.label, COUNT(DISTINCT s.member_id)::bigint AS "memberCount"
					FROM boundaries AS b
					LEFT JOIN public.organization_members AS m
						ON m.organization_id = ${context.organizationId}::uuid
						AND m.created_at < b.cutoff
						AND (m.archived_at IS NULL OR m.archived_at >= b.cutoff)
					LEFT JOIN public.organization_member_subscriptions AS s
						ON s.organization_id = m.organization_id AND s.member_id = m.id
						AND s.created_at < b.cutoff
						AND s.start_date <= b.day AND s.end_date >= b.day
						AND (s.cancelled_at IS NULL OR s.cancelled_at >= b.cutoff)
					GROUP BY b.label
				`;
				const selectedSubscribers = activeRows.find((row) => row.label === 'selected');
				const comparisonSubscribers = activeRows.find((row) => row.label === 'comparison');
				if (selectedSubscribers === undefined || comparisonSubscribers === undefined) {
					throw new Error('Incomplete dashboard subscriber aggregate.');
				}
				const activeSubscribers = safeCount(selectedSubscribers.memberCount);
				const previousActiveSubscribers = safeCount(comparisonSubscribers.memberCount);

				const planRows = await transaction.$queryRaw<PlanTotalRow[]>`
					WITH plan_totals AS (
						SELECT s.membership_plan_id AS plan_id, s.plan_name,
							SUM(a.amount_rwf)::bigint AS gross_rwf
						FROM public.organization_payment_allocations AS a
						JOIN public.organization_payments AS p
							ON p.organization_id = a.organization_id AND p.id = a.payment_id
						JOIN public.organization_member_subscriptions AS s
							ON s.organization_id = a.organization_id
							AND s.id = a.member_subscription_id
						WHERE a.organization_id = ${context.organizationId}::uuid
							AND p.occurred_at >= ${selected.gte} AND p.occurred_at < ${selected.lt}
							AND p.status IN ('confirmed', 'partially_refunded', 'refunded')
						GROUP BY s.membership_plan_id, s.plan_name
					), ranked AS (
						SELECT *, ROW_NUMBER() OVER (ORDER BY gross_rwf DESC, plan_name, plan_id) AS position
						FROM plan_totals
					)
					SELECT
						CASE WHEN position <= 5 THEN plan_id ELSE NULL END AS "planId",
						CASE WHEN position <= 5 THEN plan_name ELSE 'Other plans' END AS "planName",
						SUM(gross_rwf)::bigint AS "grossRwf"
					FROM ranked
					GROUP BY
						CASE WHEN position <= 5 THEN plan_id ELSE NULL END,
						CASE WHEN position <= 5 THEN plan_name ELSE 'Other plans' END
					ORDER BY "grossRwf" DESC, "planName"
				`;
				const methodRows = await transaction.organizationPayment.groupBy({
					by: ['method'],
					where: {
						organizationId: context.organizationId,
						occurredAt: selected,
						status: { in: SETTLED_STATUSES },
					},
					_count: { _all: true },
					_sum: { amountRwf: true },
				});

				return {
					period,
					currency: 'RWF' as const,
					metrics: {
						netCollected: {
							currentRwf: financial.selected.netRwf,
							previousRwf: financial.comparison.netRwf,
							change: dashboardChange(
								BigInt(financial.selected.netRwf),
								BigInt(financial.comparison.netRwf),
							),
						},
						settledPayments: countMetric(
							financial.selected.settledPaymentCount,
							financial.comparison.settledPaymentCount,
						),
						newMembers: countMetric(newMembers, previousNewMembers),
						activeSubscribers: countMetric(activeSubscribers, previousActiveSubscribers),
					},
					revenueSeries: financial.revenueSeries,
					planTotals: planRows.map((row) => ({
						planId: row.planId,
						planName: row.planName,
						grossRwf: row.grossRwf.toString(),
					})),
					methodTotals: methodRows
						.map((row) => ({
							method: row.method,
							settledPaymentCount: row._count._all,
							grossRwf: (row._sum.amountRwf ?? 0n).toString(),
						}))
						.sort((left, right) =>
							BigInt(left.grossRwf) === BigInt(right.grossRwf)
								? left.method.localeCompare(right.method)
								: BigInt(left.grossRwf) > BigInt(right.grossRwf)
									? -1
									: 1,
						),
					generatedAt: now.toISOString(),
				};
			});
		} catch (error: unknown) {
			throw new ServiceUnavailableException(
				{
					code: 'DASHBOARD_ANALYTICS_UNAVAILABLE',
					message: 'Dashboard analytics are temporarily unavailable.',
				},
				{ cause: error },
			);
		}
	}
}

function countMetric(current: number, previous: number): DashboardCountMetricDto {
	if (!Number.isSafeInteger(current) || !Number.isSafeInteger(previous)) {
		throw new Error('Dashboard count is outside the safe integer range.');
	}
	return {
		current,
		previous,
		change: dashboardChange(BigInt(current), BigInt(previous)),
	};
}
