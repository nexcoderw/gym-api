import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXPECTED_GENERATION_SEED, KD_GYM_ORGANIZATION_ID } from './kd-gym-members-preflight.mjs';
import {
	assertStagingDatabaseConfiguration,
	HISTORICAL_CUTOFF,
	HISTORICAL_TIMEZONE,
	STAGING_DATABASE_NAME,
} from './seed-kd-gym-subscriptions-staging.mjs';

export const EXPECTED = Object.freeze({
	members: { total: 824, synthetic: 823, original: 1 },
	subscriptions: 1919,
	payments: { organizationTotal: 1674, synthetic: 1673, confirmed: 1227, pending: 446 },
	allocations: 1673,
	auditEvents: 1673,
	reminders: 1765,
	confirmedRevenueRwf: '15516000',
	pendingAmountRwf: '5577000',
});

const REQUIRED_COLUMNS = Object.freeze({
	organizations: ['id', 'name'],
	organization_members: [
		'id',
		'organization_id',
		'is_synthetic',
		'synthetic_batch_id',
		'joined_on',
		'created_at',
		'archived_at',
	],
	organization_member_subscriptions: [
		'id',
		'organization_id',
		'member_id',
		'start_date',
		'end_date',
		'cancelled_at',
		'created_at',
	],
	organization_payments: [
		'id',
		'organization_id',
		'member_id',
		'status',
		'amount_rwf',
		'occurred_at',
		'created_at',
	],
	organization_payment_allocations: [
		'id',
		'organization_id',
		'payment_id',
		'member_id',
		'member_subscription_id',
		'amount_rwf',
	],
	organization_payment_audit_events: ['id', 'organization_id', 'payment_id', 'resulting_status'],
	organization_member_reminder_deliveries: [
		'id',
		'organization_id',
		'member_id',
		'member_subscription_id',
		'channel',
		'status',
		'provider_message_id',
		'accepted_at',
		'delivered_at',
		'due_date',
	],
});

/** Builds a public-safe aggregate report and deterministic consistency checks. */
export function buildAuditReport(snapshot) {
	const members = snapshot.members;
	const subscriptions = snapshot.subscriptions;
	const payments = snapshot.payments;
	const allocations = snapshot.allocations;
	const auditEvents = snapshot.auditEvents;
	const reminders = snapshot.reminders;
	const paymentStatuses = statusMap(payments.statusRows);
	const reminderStatuses = statusMap(reminders.statusRows);
	const confirmed = paymentStatuses.CONFIRMED ?? { count: 0, amountRwf: '0' };
	const pending = paymentStatuses.PENDING ?? { count: 0, amountRwf: '0' };
	const checks = {
		databaseIdentity: snapshot.databaseName === STAGING_DATABASE_NAME,
		organizationIdentity: snapshot.organizationName === 'KD GYM',
		memberCounts:
			members.total === EXPECTED.members.total &&
			members.synthetic === EXPECTED.members.synthetic &&
			members.original === EXPECTED.members.original &&
			members.syntheticWithoutJoiningDate === 0 &&
			members.syntheticWrongBatch === 0,
		subscriptionCount: subscriptions.syntheticCount === EXPECTED.subscriptions,
		zeroSubscriptionLinkageAnomalies: subscriptions.linkageAnomalies === 0,
		paymentCounts:
			payments.organizationTotal === EXPECTED.payments.organizationTotal &&
			payments.syntheticCount === EXPECTED.payments.synthetic &&
			confirmed.count === EXPECTED.payments.confirmed &&
			pending.count === EXPECTED.payments.pending,
		paymentAmounts:
			confirmed.amountRwf === EXPECTED.confirmedRevenueRwf &&
			pending.amountRwf === EXPECTED.pendingAmountRwf,
		allocationCount: allocations.syntheticCount === EXPECTED.allocations,
		auditEventCount: auditEvents.syntheticCount === EXPECTED.auditEvents,
		reminderCount: reminders.syntheticCount === EXPECTED.reminders,
		allSyntheticRemindersSkipped:
			(reminderStatuses.SKIPPED?.count ?? 0) === EXPECTED.reminders &&
			Object.entries(reminderStatuses).every(
				([status, item]) => status === 'SKIPPED' || item.count === 0,
			),
		allSyntheticRemindersUseSms:
			(reminderStatuses.SKIPPED?.channels.SMS ?? 0) === EXPECTED.reminders &&
			(reminderStatuses.SKIPPED?.channels.EMAIL ?? 0) === 0,
		noStoredProviderAcknowledgements: reminders.providerAcknowledgementCount === 0,
		zeroPaymentLinkageAnomalies: payments.syntheticLinkageAnomalies === 0,
		zeroAllocationLinkageAnomalies: allocations.linkageAnomalies === 0,
		zeroAllocationCoverageAnomalies: allocations.coverageAnomalies === 0,
		zeroAuditEventLinkageAnomalies: auditEvents.linkageAnomalies === 0,
		zeroAuditEventCoverageAnomalies: auditEvents.coverageAnomalies === 0,
		zeroReminderLinkageAnomalies: reminders.linkageAnomalies === 0,
	};
	const anomalies = Object.entries(checks)
		.filter(([, passed]) => !passed)
		.map(([name]) => name);
	const dashboardDiscrepancies = [];
	if (
		snapshot.subscriptions.historicalBusinessActiveMembers !==
		snapshot.subscriptions.dashboardTechnicalActiveMembers
	) {
		dashboardDiscrepancies.push({
			code: 'HISTORICAL_ACTIVE_SUBSCRIBERS_USE_INSERTION_TIMESTAMPS',
			businessDateActiveSyntheticMembers: subscriptions.historicalBusinessActiveMembers,
			currentDashboardActiveSyntheticMembers: subscriptions.dashboardTechnicalActiveMembers,
			description:
				'The dashboard requires member and subscription createdAt before the historical cutoff; that can omit records inserted later even when startDate/endDate show they were active.',
		});
	}
	return {
		audit: 'kd-gym-staging-historical-data',
		database: snapshot.databaseName,
		organization: snapshot.organizationName,
		organizationId: KD_GYM_ORGANIZATION_ID,
		historicalCutoff: HISTORICAL_CUTOFF,
		timezone: HISTORICAL_TIMEZONE,
		members: {
			total: members.total,
			synthetic: members.synthetic,
			original: members.original,
			syntheticWithoutJoiningDate: members.syntheticWithoutJoiningDate,
			monthlyByJoinedOn: rowsToMonthlyMap(members.monthlyByJoinedOn, 'count'),
			monthlyByCurrentDashboardRule: rowsToMonthlyMap(members.monthlyByDashboardDate, 'count'),
		},
		subscriptions: {
			synthetic: subscriptions.syntheticCount,
			monthlyByStartDate: rowsToMonthlyMap(subscriptions.monthlyByStartDate, 'count'),
			historicalBusinessActiveSyntheticMembers: subscriptions.historicalBusinessActiveMembers,
			currentDashboardActiveSyntheticMembers: subscriptions.dashboardTechnicalActiveMembers,
		},
		payments: {
			organizationTotal: payments.organizationTotal,
			synthetic: payments.syntheticCount,
			byStatus: paymentStatuses,
			confirmedRevenueRwf: confirmed.amountRwf,
			pendingAmountRwf: pending.amountRwf,
			monthlyByOccurredAtKigali: payments.monthlyByOccurredAtKigali,
			monthlyByInsertionTimeKigali: rowsToMonthlyMap(payments.monthlyByCreatedAtKigali, 'count'),
		},
		allocations: {
			synthetic: allocations.syntheticCount,
			linkageAnomalies: allocations.linkageAnomalies,
			paymentCoverageAnomalies: allocations.coverageAnomalies,
		},
		paymentAuditEvents: {
			synthetic: auditEvents.syntheticCount,
			linkageAnomalies: auditEvents.linkageAnomalies,
			paymentCoverageAnomalies: auditEvents.coverageAnomalies,
		},
		reminders: {
			synthetic: reminders.syntheticCount,
			byStatus: reminderStatuses,
			monthlyByDueDate: rowsToMonthlyMap(reminders.monthlyByDueDate, 'count'),
			storedProviderAcknowledgements: reminders.providerAcknowledgementCount,
			externalProvidersContactedByAudit: false,
		},
		checks,
		dataIntegrityAnomalies: anomalies,
		dashboardReportingDiscrepancies: dashboardDiscrepancies,
		reportingSemantics: {
			paymentRevenueDate: 'occurredAt grouped in Africa/Kigali',
			pendingPaymentsIncludedInConfirmedRevenue: false,
			newMemberDate: 'joinedOn; legacy null values use createdAt as documented',
			skippedRemindersCountedAsSuccessfulDelivery: false,
			skippedRemindersAreVisibleInDeliveryActivity: false,
		},
		overallResult:
			anomalies.length > 0
				? 'FAIL'
				: dashboardDiscrepancies.length > 0
					? 'REVIEW_REQUIRED'
					: 'PASS',
		transaction: 'READ_ONLY_REPEATABLE_READ',
	};
}

export async function auditStagingDatabase(prisma) {
	stage = 'opening_read_only_transaction';
	return prisma.$transaction(
		async (transaction) => {
			stage = 'read_only_transaction_setup';
			await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
			stage = 'schema_check';
			await assertRequiredSchema(transaction);
			stage = 'database_identity_query';
			const [{ databaseName }] =
				await transaction.$queryRaw`SELECT current_database() AS "databaseName"`;
			if (databaseName !== STAGING_DATABASE_NAME) {
				throw new StagingAuditError(
					'AUDIT_DATABASE_IDENTITY_INVALID',
					'The configured database is not neondb staging.',
				);
			}
			stage = 'organization_query';
			const organization = await transaction.organization.findUnique({
				where: { id: KD_GYM_ORGANIZATION_ID },
				select: { id: true, name: true },
			});
			if (organization === null) {
				throw new StagingAuditError(
					'AUDIT_ORGANIZATION_MISSING',
					'KD GYM was not found in neondb.',
				);
			}
			stage = 'member_aggregates';
			const members = await transaction.$queryRaw`
				SELECT COUNT(*)::int AS total,
					COUNT(*) FILTER (WHERE is_synthetic)::int AS synthetic,
					COUNT(*) FILTER (WHERE NOT is_synthetic)::int AS original,
					COUNT(*) FILTER (WHERE is_synthetic AND synthetic_batch_id IS DISTINCT FROM ${EXPECTED_GENERATION_SEED})::int AS "syntheticWrongBatch",
					COUNT(*) FILTER (WHERE is_synthetic AND joined_on IS NULL)::int AS "syntheticWithoutJoiningDate"
				FROM public.organization_members WHERE organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid
			`;
			stage = 'member_monthly_joining';
			const monthlyMembers = await transaction.$queryRaw`
				SELECT TO_CHAR(joined_on, 'YYYY-MM') AS month, COUNT(*)::int AS count
				FROM public.organization_members
				WHERE organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND is_synthetic
					AND synthetic_batch_id = ${EXPECTED_GENERATION_SEED} AND joined_on IS NOT NULL
				GROUP BY month ORDER BY month
			`;
			stage = 'member_monthly_dashboard';
			const monthlyDashboardMembers = await transaction.$queryRaw`
				SELECT TO_CHAR(COALESCE(joined_on, (created_at AT TIME ZONE 'Africa/Kigali')::date), 'YYYY-MM') AS month,
					COUNT(*)::int AS count
				FROM public.organization_members
				WHERE organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND is_synthetic
					AND synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
				GROUP BY month ORDER BY month
			`;
			stage = 'subscription_aggregates';
			const subscriptions = await transaction.$queryRaw`
				SELECT COUNT(*) FILTER (WHERE m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED})::int AS "syntheticCount",
					COUNT(*) FILTER (WHERE m.synthetic_batch_id IS DISTINCT FROM ${EXPECTED_GENERATION_SEED})::int AS "linkageAnomalies",
				COUNT(DISTINCT m.id) FILTER (
					WHERE m.joined_on <= ${HISTORICAL_CUTOFF}::date
						AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
						AND (m.archived_at IS NULL OR m.archived_at >= TIMESTAMPTZ '2026-11-12 22:00:00+00')
						AND s.start_date <= ${HISTORICAL_CUTOFF}::date AND s.end_date >= ${HISTORICAL_CUTOFF}::date
						AND (s.cancelled_at IS NULL OR s.cancelled_at >= TIMESTAMPTZ '2026-11-12 22:00:00+00')
				)::int AS "historicalBusinessActiveMembers",
				COUNT(DISTINCT m.id) FILTER (
					WHERE m.created_at < TIMESTAMPTZ '2026-11-12 22:00:00+00'
						AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
						AND (m.archived_at IS NULL OR m.archived_at >= TIMESTAMPTZ '2026-11-12 22:00:00+00')
						AND s.created_at < TIMESTAMPTZ '2026-11-12 22:00:00+00'
						AND s.start_date <= ${HISTORICAL_CUTOFF}::date AND s.end_date >= ${HISTORICAL_CUTOFF}::date
						AND (s.cancelled_at IS NULL OR s.cancelled_at >= TIMESTAMPTZ '2026-11-12 22:00:00+00')
				)::int AS "dashboardTechnicalActiveMembers"
				FROM public.organization_member_subscriptions s
				LEFT JOIN public.organization_members m ON m.organization_id = s.organization_id AND m.id = s.member_id
				WHERE s.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND m.is_synthetic
			`;
			stage = 'subscription_monthly_activity';
			const monthlySubscriptions = await transaction.$queryRaw`
				SELECT TO_CHAR(start_date, 'YYYY-MM') AS month, COUNT(*)::int AS count
				FROM public.organization_member_subscriptions s
				JOIN public.organization_members m ON m.organization_id = s.organization_id AND m.id = s.member_id
				WHERE s.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND m.is_synthetic
					AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
				GROUP BY month ORDER BY month
			`;
			stage = 'payment_aggregates';
			const payments = await transaction.$queryRaw`
				SELECT COUNT(*)::int AS "organizationTotal",
					COUNT(*) FILTER (WHERE m.is_synthetic AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED})::int AS "syntheticCount",
					COUNT(*) FILTER (WHERE m.is_synthetic AND m.synthetic_batch_id IS DISTINCT FROM ${EXPECTED_GENERATION_SEED})::int AS "syntheticLinkageAnomalies"
				FROM public.organization_payments p
				LEFT JOIN public.organization_members m ON m.organization_id = p.organization_id AND m.id = p.member_id
				WHERE p.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid
			`;
			stage = 'payment_status_totals';
			const paymentStatusRows = await transaction.$queryRaw`
				SELECT UPPER(p.status::text) AS status, COUNT(*)::int AS count,
					COALESCE(SUM(p.amount_rwf), 0)::text AS "amountRwf"
				FROM public.organization_payments p
				JOIN public.organization_members m ON m.organization_id = p.organization_id AND m.id = p.member_id
				WHERE p.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND m.is_synthetic
					AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
				GROUP BY p.status ORDER BY p.status
			`;
			stage = 'payment_monthly_occurrence';
			const monthlyPayments = await transaction.$queryRaw`
				SELECT TO_CHAR(p.occurred_at AT TIME ZONE 'Africa/Kigali', 'YYYY-MM') AS month,
					UPPER(p.status::text) AS status, COUNT(*)::int AS count,
					COALESCE(SUM(p.amount_rwf), 0)::text AS "amountRwf"
				FROM public.organization_payments p
				JOIN public.organization_members m ON m.organization_id = p.organization_id AND m.id = p.member_id
				WHERE p.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND m.is_synthetic
					AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
				GROUP BY month, p.status ORDER BY month, p.status
			`;
			stage = 'payment_monthly_insertion';
			const monthlyPaymentInsertions = await transaction.$queryRaw`
				SELECT TO_CHAR(p.created_at AT TIME ZONE 'Africa/Kigali', 'YYYY-MM') AS month, COUNT(*)::int AS count
				FROM public.organization_payments p
				JOIN public.organization_members m ON m.organization_id = p.organization_id AND m.id = p.member_id
				WHERE p.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND m.is_synthetic
					AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
				GROUP BY month ORDER BY month
			`;
			stage = 'allocation_integrity';
			const allocations = await transaction.$queryRaw`
				SELECT COUNT(*)::int AS "syntheticCount",
					COUNT(*) FILTER (WHERE s.id IS NULL OR a.member_id <> p.member_id OR a.member_id <> s.member_id OR NOT m.is_synthetic OR m.synthetic_batch_id IS DISTINCT FROM ${EXPECTED_GENERATION_SEED})::int AS "linkageAnomalies"
				FROM public.organization_payment_allocations a
				JOIN public.organization_payments p ON p.organization_id = a.organization_id AND p.id = a.payment_id
				JOIN public.organization_members m ON m.organization_id = p.organization_id AND m.id = p.member_id
				LEFT JOIN public.organization_member_subscriptions s ON s.organization_id = a.organization_id AND s.id = a.member_subscription_id
				WHERE a.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND m.is_synthetic AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
			`;
			stage = 'allocation_coverage';
			const allocationCoverage = await transaction.$queryRaw`
				SELECT COUNT(*)::int AS "coverageAnomalies"
				FROM (
					SELECT p.id FROM public.organization_payments p
					JOIN public.organization_members m ON m.organization_id = p.organization_id AND m.id = p.member_id
					LEFT JOIN public.organization_payment_allocations a ON a.organization_id = p.organization_id AND a.payment_id = p.id
					WHERE p.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND m.is_synthetic
						AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
					GROUP BY p.id HAVING COUNT(a.id) <> 1
				) AS allocation_coverage
			`;
			stage = 'payment_audit_integrity';
			const auditEvents = await transaction.$queryRaw`
				SELECT COUNT(*)::int AS "syntheticCount",
					COUNT(*) FILTER (WHERE e.organization_id <> p.organization_id)::int AS "linkageAnomalies"
				FROM public.organization_payment_audit_events e
				JOIN public.organization_payments p ON p.organization_id = e.organization_id AND p.id = e.payment_id
				JOIN public.organization_members m ON m.organization_id = p.organization_id AND m.id = p.member_id
				WHERE e.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND m.is_synthetic AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
			`;
			stage = 'payment_audit_coverage';
			const auditCoverage = await transaction.$queryRaw`
				SELECT COUNT(*)::int AS "coverageAnomalies"
				FROM (
					SELECT p.id FROM public.organization_payments p
					JOIN public.organization_members m ON m.organization_id = p.organization_id AND m.id = p.member_id
					LEFT JOIN public.organization_payment_audit_events e ON e.organization_id = p.organization_id AND e.payment_id = p.id
					WHERE p.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND m.is_synthetic
						AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
					GROUP BY p.id HAVING COUNT(e.id) <> 1
				) AS audit_coverage
			`;
			stage = 'reminder_integrity';
			const reminders = await transaction.$queryRaw`
				SELECT COUNT(*)::int AS "syntheticCount",
					COUNT(*) FILTER (WHERE r.provider_message_id IS NOT NULL OR r.accepted_at IS NOT NULL OR r.delivered_at IS NOT NULL)::int AS "providerAcknowledgementCount",
					COUNT(*) FILTER (WHERE s.id IS NULL OR r.member_id <> s.member_id OR r.organization_id <> s.organization_id OR NOT m.is_synthetic OR m.synthetic_batch_id IS DISTINCT FROM ${EXPECTED_GENERATION_SEED})::int AS "linkageAnomalies"
				FROM public.organization_member_reminder_deliveries r
				LEFT JOIN public.organization_member_subscriptions s ON s.organization_id = r.organization_id AND s.id = r.member_subscription_id
				LEFT JOIN public.organization_members m ON m.organization_id = r.organization_id AND m.id = r.member_id
				WHERE r.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND m.is_synthetic AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
			`;
			stage = 'reminder_status_totals';
			const reminderStatusRows = await transaction.$queryRaw`
				SELECT UPPER(r.status::text) AS status, UPPER(r.channel::text) AS channel, COUNT(*)::int AS count
				FROM public.organization_member_reminder_deliveries r
				JOIN public.organization_members m ON m.organization_id = r.organization_id AND m.id = r.member_id
				WHERE r.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND m.is_synthetic AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
				GROUP BY r.status, r.channel ORDER BY r.status, r.channel
			`;
			stage = 'reminder_monthly_activity';
			const monthlyReminders = await transaction.$queryRaw`
				SELECT TO_CHAR(r.due_date, 'YYYY-MM') AS month, COUNT(*)::int AS count
				FROM public.organization_member_reminder_deliveries r
				JOIN public.organization_members m ON m.organization_id = r.organization_id AND m.id = r.member_id
				WHERE r.organization_id = ${KD_GYM_ORGANIZATION_ID}::uuid AND m.is_synthetic AND m.synthetic_batch_id = ${EXPECTED_GENERATION_SEED}
				GROUP BY month ORDER BY month
			`;
			const rows = {
				databaseName,
				organizationName: organization.name,
				members: {
					...one(members),
					monthlyByJoinedOn: monthlyMembers,
					monthlyByDashboardDate: monthlyDashboardMembers,
				},
				subscriptions: { ...one(subscriptions), monthlyByStartDate: monthlySubscriptions },
				payments: {
					...one(payments),
					statusRows: paymentStatusRows,
					monthlyByOccurredAtKigali: monthlyPayments,
					monthlyByCreatedAtKigali: monthlyPaymentInsertions,
				},
				allocations: { ...one(allocations), ...one(allocationCoverage) },
				auditEvents: { ...one(auditEvents), ...one(auditCoverage) },
				reminders: {
					...one(reminders),
					statusRows: reminderStatusRows,
					monthlyByDueDate: monthlyReminders,
				},
			};
			stage = 'report_assembly';
			return buildAuditReport(rows);
		},
		{ isolationLevel: 'RepeatableRead', maxWait: 30_000, timeout: 120_000 },
	);
}

export class StagingAuditError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'StagingAuditError';
		this.code = code;
	}
}

function statusMap(rows) {
	const result = {};
	for (const row of rows) {
		const current = result[row.status] ?? { count: 0, amountRwf: '0', channels: {} };
		current.count += toCount(row.count);
		current.amountRwf = (BigInt(current.amountRwf) + BigInt(row.amountRwf ?? 0)).toString();
		if (row.channel !== undefined) current.channels[row.channel] = toCount(row.count);
		result[row.status] = current;
	}
	return result;
}

function rowsToMonthlyMap(rows, field) {
	return Object.fromEntries(
		rows.map((row) => [row.month, field === 'count' ? toCount(row.count) : row[field]]),
	);
}

function one(rows) {
	if (rows.length !== 1)
		throw new StagingAuditError(
			'AUDIT_AGGREGATE_INVALID',
			'A staging audit aggregate was unavailable.',
		);
	return rows[0];
}

function toCount(value) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new StagingAuditError(
			'AUDIT_AGGREGATE_INVALID',
			'A staging audit count is outside the supported range.',
		);
	}
	return number;
}

async function assertRequiredSchema(transaction) {
	const tables = Object.keys(REQUIRED_COLUMNS);
	const rows = await transaction.$queryRaw`
		SELECT table_name, column_name FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = ANY(${tables}::text[])
	`;
	const available = new Map();
	for (const row of rows) {
		if (!available.has(row.table_name)) available.set(row.table_name, new Set());
		available.get(row.table_name).add(row.column_name);
	}
	for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
		if (!columns.every((column) => available.get(table)?.has(column))) {
			throw new StagingAuditError(
				'AUDIT_SCHEMA_INCOMPLETE',
				'Required KD GYM staging audit columns are missing.',
			);
		}
	}
}

let stage = 'arguments';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).catch((error) => {
		const known = error instanceof StagingAuditError;
		const databaseErrorCode =
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			typeof error.code === 'string' &&
			/^[A-Z]\d{4}$/u.test(error.code)
				? error.code
				: undefined;
		const databaseSqlState =
			typeof error === 'object' &&
			error !== null &&
			'meta' in error &&
			typeof error.meta === 'object' &&
			error.meta !== null &&
			'code' in error.meta &&
			typeof error.meta.code === 'string' &&
			/^[A-Z0-9]{5}$/u.test(error.meta.code)
				? error.meta.code
				: undefined;
		process.stderr.write(
			`${JSON.stringify({ audit: 'kd-gym-staging-historical-data', failed: true, stage, code: known ? error.code : `AUDIT_${stage.toUpperCase()}_FAILED`, ...(databaseErrorCode === undefined ? {} : { databaseErrorCode }), ...(databaseSqlState === undefined ? {} : { databaseSqlState }), message: known ? error.message : 'KD GYM staging audit failed; internal details were withheld.' })}\n`,
		);
		process.exitCode = 2;
	});
}

async function main(arguments_) {
	if (arguments_.length !== 0)
		throw new StagingAuditError('AUDIT_ARGUMENTS_INVALID', 'The staging audit takes no arguments.');
	stage = 'database_configuration';
	assertStagingDatabaseConfiguration(process.env.DATABASE_URL);
	stage = 'database_client_load';
	const { NestFactory } = await import('@nestjs/core');
	const { DatabaseModule, PrismaService, loadDatabaseConfig } = await import('@nexcoderw/gym-db');
	const config = loadDatabaseConfig({
		DATABASE_URL: process.env.DATABASE_URL,
		DATABASE_POOL_MAX: '1',
	});
	stage = 'database_startup';
	const application = await NestFactory.createApplicationContext(DatabaseModule.forRoot(config), {
		logger: false,
	});
	try {
		stage = 'read_only_audit';
		const report = await auditStagingDatabase(application.get(PrismaService));
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} finally {
		await application.close();
	}
}
