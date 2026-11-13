import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXPECTED_GENERATION_SEED, KD_GYM_ORGANIZATION_ID } from './kd-gym-members-preflight.mjs';
import { StagingSeedError } from './kd-gym-members-staging.mjs';
import { runSerializableImportTransaction } from './kd-gym-members-import.mjs';
import {
	assertStagingDatabaseConfiguration,
	HISTORICAL_CUTOFF,
	HISTORICAL_TIMEZONE,
	STAGING_DATABASE_NAME,
} from './seed-kd-gym-subscriptions-staging.mjs';

export { StagingSeedError };

export const PAYMENT_GENERATION_SEED = 'kd-gym-payments-2026-11-12-v1';
export const HISTORICAL_START = '2025-10-18';
export const PAYMENT_METHODS = Object.freeze([
	'CASH',
	'MOBILE_MONEY',
	'BANK_TRANSFER',
	'CARD',
	'OTHER',
]);

const PAYMENT_METHOD_WEIGHTS = Object.freeze([
	{ method: 'CASH', ceiling: 0.72 },
	{ method: 'MOBILE_MONEY', ceiling: 0.82 },
	{ method: 'BANK_TRANSFER', ceiling: 0.9 },
	{ method: 'CARD', ceiling: 0.96 },
	{ method: 'OTHER', ceiling: 1 },
]);
const SKIP_PAYMENT_PROBABILITY = 0.14;
const PAYMENT_NOTE_CASH = 'Synthetic staging data; historical cash payment.';
const PAYMENT_NOTE_EXTERNAL = 'Synthetic staging data; no external provider transaction occurred.';
const SYNTHETIC_PROVIDER_REFERENCE = 'SYNTHETIC-STAGING-NO-PROVIDER-';
const UUID_NAMESPACE = Buffer.from('a1e78182e4794fc9b57d3018bc828c8b', 'hex');
const INSERT_CHUNK_SIZE = 200;
const KIGALI_OFFSET = '+02:00';

const EXPECTED_COLUMNS = Object.freeze({
	organizations: ['id', 'name'],
	organization_members: [
		'id',
		'organization_id',
		'is_synthetic',
		'synthetic_batch_id',
		'joined_on',
	],
	organization_member_subscriptions: [
		'id',
		'organization_id',
		'member_id',
		'price_rwf',
		'start_date',
		'end_date',
		'created_by_user_id',
	],
	organization_memberships: ['organization_id', 'user_id', 'status'],
	users: ['id', 'status'],
	organization_payments: [
		'id',
		'organization_id',
		'member_id',
		'receipt_number',
		'amount_rwf',
		'method',
		'status',
		'provider_reference',
		'note',
		'occurred_at',
		'confirmed_at',
		'failed_at',
		'voided_at',
		'void_reason',
		'idempotency_key',
		'request_fingerprint',
		'recorded_by_user_id',
		'created_at',
		'updated_at',
	],
	organization_payment_allocations: [
		'id',
		'organization_id',
		'payment_id',
		'member_id',
		'member_subscription_id',
		'amount_rwf',
		'created_at',
	],
	organization_payment_audit_events: [
		'id',
		'organization_id',
		'payment_id',
		'actor_user_id',
		'action',
		'request_id',
		'idempotency_key',
		'request_fingerprint',
		'resulting_status',
		'refund_id',
		'previous_status',
		'occurred_at',
		'recorded_at',
	],
});

const PAYMENT_SELECT = Object.freeze({
	id: true,
	organizationId: true,
	memberId: true,
	receiptNumber: true,
	amountRwf: true,
	method: true,
	status: true,
	providerReference: true,
	note: true,
	occurredAt: true,
	confirmedAt: true,
	failedAt: true,
	voidedAt: true,
	voidReason: true,
	idempotencyKey: true,
	requestFingerprint: true,
	recordedByUserId: true,
	createdAt: true,
	updatedAt: true,
	allocations: {
		select: {
			id: true,
			organizationId: true,
			paymentId: true,
			memberId: true,
			memberSubscriptionId: true,
			amountRwf: true,
			createdAt: true,
		},
	},
	auditEvents: {
		select: {
			id: true,
			organizationId: true,
			paymentId: true,
			refundId: true,
			actorUserId: true,
			action: true,
			requestId: true,
			idempotencyKey: true,
			requestFingerprint: true,
			previousStatus: true,
			resultingStatus: true,
			occurredAt: true,
			recordedAt: true,
		},
	},
});

const PAYMENT_FIELDS = Object.freeze([
	'id',
	'organizationId',
	'memberId',
	'receiptNumber',
	'amountRwf',
	'method',
	'status',
	'providerReference',
	'note',
	'occurredAt',
	'failedAt',
	'voidedAt',
	'voidReason',
	'idempotencyKey',
	'requestFingerprint',
	'recordedByUserId',
]);
const ALLOCATION_FIELDS = Object.freeze([
	'id',
	'organizationId',
	'paymentId',
	'memberId',
	'memberSubscriptionId',
	'amountRwf',
]);
const AUDIT_FIELDS = Object.freeze([
	'id',
	'organizationId',
	'paymentId',
	'refundId',
	'actorUserId',
	'action',
	'requestId',
	'idempotencyKey',
	'requestFingerprint',
	'previousStatus',
	'resultingStatus',
	'occurredAt',
]);

export function generateHistoricalPayments(subscriptions, recordedByUserId, insertedAt) {
	const generated = [];
	for (const subscription of subscriptions) {
		assertSyntheticSubscription(subscription);
		const amountRwf = subscription.priceRwf;
		if (
			amountRwf < 1n ||
			randomFraction(subscription.id, 'payment-exists') < SKIP_PAYMENT_PROBABILITY
		)
			continue;
		if (amountRwf > 1_000_000_000n) {
			throw new StagingSeedError(
				'PAYMENT_AMOUNT_OUT_OF_RANGE',
				'A subscription snapshot exceeds the supported payment amount.',
			);
		}

		const method = chooseMethod(randomFraction(subscription.id, 'payment-method'));
		const status = method === 'CASH' ? 'CONFIRMED' : 'PENDING';
		const occurredAt = historicalPaymentTime(subscription);
		const paymentId = deterministicUuid(`${PAYMENT_GENERATION_SEED}:payment:${subscription.id}`);
		const idempotencyKey = deterministicUuid(`${PAYMENT_GENERATION_SEED}:key:${subscription.id}`);
		const providerReference =
			method === 'CASH' ? null : `${SYNTHETIC_PROVIDER_REFERENCE}${paymentId.toUpperCase()}`;
		const note = method === 'CASH' ? PAYMENT_NOTE_CASH : PAYMENT_NOTE_EXTERNAL;
		const amount = Number(amountRwf);
		if (!Number.isSafeInteger(amount)) {
			throw new StagingSeedError(
				'PAYMENT_AMOUNT_OUT_OF_RANGE',
				'A subscription snapshot cannot be represented as a whole-RWF payment amount.',
			);
		}
		const fingerprint = createHash('sha256')
			.update(
				JSON.stringify([
					'record',
					subscription.memberId,
					subscription.id,
					amount,
					method,
					occurredAt.toISOString(),
					providerReference,
					note,
				]),
			)
			.digest('hex');
		const receiptNumber = makeReceiptNumber(paymentId, occurredAt);
		const requestId = `stg-kd-gym-payment:${paymentId}`;
		const payment = {
			id: paymentId,
			organizationId: KD_GYM_ORGANIZATION_ID,
			memberId: subscription.memberId,
			receiptNumber,
			amountRwf,
			method,
			status,
			providerReference,
			note,
			occurredAt,
			// The applied ledger CHECK requires confirmed_at >= created_at.
			confirmedAt: status === 'CONFIRMED' ? insertedAt : null,
			failedAt: null,
			voidedAt: null,
			voidReason: null,
			idempotencyKey,
			requestFingerprint: fingerprint,
			recordedByUserId,
			createdAt: insertedAt,
			updatedAt: insertedAt,
		};
		const allocation = {
			id: deterministicUuid(`${PAYMENT_GENERATION_SEED}:allocation:${subscription.id}`),
			organizationId: KD_GYM_ORGANIZATION_ID,
			paymentId,
			memberId: subscription.memberId,
			memberSubscriptionId: subscription.id,
			amountRwf,
			createdAt: insertedAt,
		};
		const auditEvent = {
			id: deterministicUuid(`${PAYMENT_GENERATION_SEED}:audit:${subscription.id}`),
			organizationId: KD_GYM_ORGANIZATION_ID,
			paymentId,
			refundId: null,
			actorUserId: recordedByUserId,
			action: 'PAYMENT_RECORDED',
			requestId,
			idempotencyKey,
			requestFingerprint: fingerprint,
			previousStatus: null,
			resultingStatus: status,
			occurredAt,
			recordedAt: insertedAt,
		};
		generated.push({ subscriptionId: subscription.id, payment, allocation, auditEvent });
	}
	return generated;
}

export function assertPaymentBatchMatches(actualPayments, planned) {
	const plannedById = new Map(planned.map((item) => [item.payment.id, item]));
	if (actualPayments.length !== planned.length) {
		throw new StagingSeedError(
			'PARTIAL_PAYMENT_BATCH',
			'Payment records already exist for only part of the synthetic subscription batch.',
		);
	}
	for (const actual of actualPayments) {
		const expected = plannedById.get(actual.id);
		if (expected === undefined || !fieldsMatch(actual, expected.payment, PAYMENT_FIELDS)) {
			throw new StagingSeedError(
				'PAYMENT_BATCH_CONFLICT',
				'Existing synthetic payment records differ from the deterministic staging batch.',
			);
		}
		if (
			!(actual.createdAt instanceof Date) ||
			!(actual.updatedAt instanceof Date) ||
			actual.updatedAt < actual.createdAt ||
			(actual.status === 'CONFIRMED' &&
				(!(actual.confirmedAt instanceof Date) || actual.confirmedAt < actual.createdAt)) ||
			(actual.status === 'PENDING' && actual.confirmedAt !== null)
		) {
			throw new StagingSeedError(
				'PAYMENT_LIFECYCLE_CONFLICT',
				'An existing synthetic payment has invalid confirmation timestamps.',
			);
		}
		const actualAllocations = actual.allocations ?? [];
		const actualAudits = actual.auditEvents ?? [];
		if (
			actualAllocations.length !== 1 ||
			!fieldsMatch(actualAllocations[0], expected.allocation, ALLOCATION_FIELDS) ||
			actualAudits.length !== 1 ||
			!fieldsMatch(actualAudits[0], expected.auditEvent, AUDIT_FIELDS) ||
			!(actualAudits[0].recordedAt instanceof Date) ||
			actualAudits[0].recordedAt < actualAudits[0].occurredAt
		) {
			throw new StagingSeedError(
				'PAYMENT_LEDGER_CONFLICT',
				'Existing synthetic payment allocation or audit history is incomplete or mismatched.',
			);
		}
	}
}

export function makePaymentSummary(result, subscriptions, storedPayments) {
	const paymentsByMethod = Object.fromEntries(PAYMENT_METHODS.map((method) => [method, 0]));
	const monthlyConfirmedRevenue = makeHistoricalMonthRange();
	let confirmedCount = 0;
	let pendingCount = 0;
	let confirmedRevenue = 0n;
	let pendingAmount = 0n;
	let allocationCount = 0;
	let auditEventCount = 0;
	const confirmedSubscriptionIds = new Set();
	for (const payment of storedPayments) {
		paymentsByMethod[payment.method] += 1;
		allocationCount += payment.allocations.length;
		auditEventCount += payment.auditEvents.length;
		if (payment.status === 'CONFIRMED') {
			for (const allocation of payment.allocations) {
				confirmedSubscriptionIds.add(allocation.memberSubscriptionId);
			}
			confirmedCount += 1;
			confirmedRevenue += payment.amountRwf;
			const month = dateInKigali(payment.occurredAt).slice(0, 7);
			monthlyConfirmedRevenue[month] = (monthlyConfirmedRevenue[month] ?? 0n) + payment.amountRwf;
		} else if (payment.status === 'PENDING') {
			pendingCount += 1;
			pendingAmount += payment.amountRwf;
		}
	}
	return {
		database: STAGING_DATABASE_NAME,
		organization: 'KD GYM',
		syntheticSubscriptionsExamined: subscriptions.length,
		paymentsInserted: result.paymentCount,
		confirmedPayments: confirmedCount,
		pendingPayments: pendingCount,
		unpaidSubscriptions: subscriptions.length - confirmedSubscriptionIds.size,
		paymentAllocationsCreated: result.allocationCount,
		auditEventsCreated: result.auditEventCount,
		totalConfirmedRevenueRwf: safeNumber(confirmedRevenue),
		totalPendingAmountRwf: safeNumber(pendingAmount),
		paymentsByMethod,
		monthlyConfirmedRevenueRwf: Object.fromEntries(
			Object.entries(monthlyConfirmedRevenue).map(([month, amount]) => [month, safeNumber(amount)]),
		),
		transactionStatus: result.status,
		totalOrganizationPayments: result.totalOrganizationPayments,
		timezone: HISTORICAL_TIMEZONE,
	};
}

export async function seedStagingPayments(prisma, onWriteStart = () => {}) {
	return runSerializableImportTransaction(
		prisma,
		async (transaction) => {
			await assertRequiredSchema(transaction);
			const [{ databaseName }] = await transaction.$queryRaw`
				SELECT current_database() AS "databaseName"
			`;
			if (databaseName !== STAGING_DATABASE_NAME) {
				throw new StagingSeedError(
					'PAYMENT_DATABASE_IDENTITY_INVALID',
					'The connected database is not the configured neondb staging database.',
				);
			}
			const organization = await transaction.organization.findUnique({
				where: { id: KD_GYM_ORGANIZATION_ID },
				select: { id: true, name: true },
			});
			if (organization?.name !== 'KD GYM') {
				throw new StagingSeedError('ORGANIZATION_NOT_FOUND', 'KD GYM was not found in neondb.');
			}

			const syntheticMemberCount = await transaction.organizationMember.count({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					isSynthetic: true,
					syntheticBatchId: EXPECTED_GENERATION_SEED,
				},
			});
			if (syntheticMemberCount !== 823) {
				throw new StagingSeedError(
					'SYNTHETIC_MEMBER_BATCH_INVALID',
					'The exact KD GYM synthetic member batch is required before seeding payments.',
				);
			}
			const subscriptions = await transaction.organizationMemberSubscription.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					member: {
						is: {
							isSynthetic: true,
							syntheticBatchId: EXPECTED_GENERATION_SEED,
						},
					},
				},
				select: {
					id: true,
					organizationId: true,
					memberId: true,
					membershipPlanId: true,
					planName: true,
					priceRwf: true,
					startDate: true,
					endDate: true,
					createdByUserId: true,
					member: {
						select: {
							id: true,
							organizationId: true,
							isSynthetic: true,
							syntheticBatchId: true,
							joinedOn: true,
						},
					},
				},
				orderBy: [{ memberId: 'asc' }, { startDate: 'asc' }, { id: 'asc' }],
			});
			if (subscriptions.length === 0) {
				throw new StagingSeedError(
					'SYNTHETIC_SUBSCRIPTIONS_MISSING',
					'KD GYM has no subscriptions for its synthetic member batch.',
				);
			}
			for (const subscription of subscriptions) assertSyntheticSubscription(subscription);

			const subscriptionCreators = [
				...new Set(subscriptions.map(({ createdByUserId }) => createdByUserId)),
			];
			const actorMembership = await resolveRecorder(transaction, subscriptionCreators);
			if (actorMembership === null && subscriptions.length > 0) {
				throw new StagingSeedError(
					'ACTIVE_ORGANIZATION_USER_REQUIRED',
					'An existing active KD GYM organization user is required to record payments.',
				);
			}
			const recordedByUserId = actorMembership?.userId ?? '';
			const timestampRows = await transaction.$queryRaw`
				SELECT clock_timestamp() AS "insertedAt"
			`;
			const actualInsertedAt = timestampRows[0]?.insertedAt;
			if (!(actualInsertedAt instanceof Date) || !Number.isFinite(actualInsertedAt.getTime())) {
				throw new StagingSeedError(
					'DATABASE_TIMESTAMP_INVALID',
					'The database did not provide a valid insertion timestamp.',
				);
			}
			const planned = generateHistoricalPayments(subscriptions, recordedByUserId, actualInsertedAt);
			const memberIds = [...new Set(subscriptions.map(({ memberId }) => memberId))];
			const paymentCountBefore = await transaction.organizationPayment.count({
				where: { organizationId: KD_GYM_ORGANIZATION_ID },
			});
			const existing = await transaction.organizationPayment.findMany({
				where: { organizationId: KD_GYM_ORGANIZATION_ID, memberId: { in: memberIds } },
				select: PAYMENT_SELECT,
				orderBy: [{ memberId: 'asc' }, { occurredAt: 'asc' }, { id: 'asc' }],
			});

			if (existing.length > 0 || planned.length === 0) {
				assertPaymentBatchMatches(existing, planned);
				return {
					status: 'ALREADY_SEEDED',
					paymentCount: 0,
					allocationCount: 0,
					auditEventCount: 0,
					totalOrganizationPayments: paymentCountBefore,
					subscriptions,
					storedPayments: existing,
				};
			}

			const collisions = await transaction.organizationPayment.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					OR: [
						{ id: { in: planned.map(({ payment }) => payment.id) } },
						{ receiptNumber: { in: planned.map(({ payment }) => payment.receiptNumber) } },
						{ idempotencyKey: { in: planned.map(({ payment }) => payment.idempotencyKey) } },
					],
				},
				select: { id: true },
			});
			if (collisions.length > 0) {
				throw new StagingSeedError(
					'PAYMENT_IDENTITY_COLLISION',
					'A deterministic payment ID, receipt number, or idempotency key already exists.',
				);
			}

			const paymentRows = planned.map(({ payment }) => payment);
			const allocationRows = planned.map(({ allocation }) => allocation);
			const auditRows = planned.map(({ auditEvent }) => auditEvent);
			if (planned.length > 0) onWriteStart();
			const paymentCount = await createInChunks(transaction.organizationPayment, paymentRows);
			const allocationCount = await createInChunks(
				transaction.organizationPaymentAllocation,
				allocationRows,
			);
			const auditEventCount = await createInChunks(
				transaction.organizationPaymentAuditEvent,
				auditRows,
			);
			if (
				paymentCount !== planned.length ||
				allocationCount !== planned.length ||
				auditEventCount !== planned.length
			) {
				throw new StagingSeedError(
					'PAYMENT_LEDGER_INSERT_COUNT_MISMATCH',
					'The full payment, allocation, and audit batches were not inserted; transaction rolled back.',
				);
			}
			const storedPayments = await transaction.organizationPayment.findMany({
				where: { organizationId: KD_GYM_ORGANIZATION_ID, memberId: { in: memberIds } },
				select: PAYMENT_SELECT,
				orderBy: [{ memberId: 'asc' }, { occurredAt: 'asc' }, { id: 'asc' }],
			});
			assertPaymentBatchMatches(storedPayments, planned);
			const totalOrganizationPayments = await transaction.organizationPayment.count({
				where: { organizationId: KD_GYM_ORGANIZATION_ID },
			});
			if (totalOrganizationPayments !== paymentCountBefore + paymentCount) {
				throw new StagingSeedError(
					'PAYMENT_TOTAL_MISMATCH',
					'The organization payment total changed unexpectedly; transaction rolled back.',
				);
			}
			return {
				status: 'INSERTED',
				paymentCount,
				allocationCount,
				auditEventCount,
				totalOrganizationPayments,
				subscriptions,
				storedPayments,
			};
		},
		{ maxWait: 30_000 },
	);
}

function assertSyntheticSubscription(subscription) {
	const { member } = subscription;
	if (
		subscription.organizationId !== KD_GYM_ORGANIZATION_ID ||
		member?.organizationId !== KD_GYM_ORGANIZATION_ID ||
		member?.id !== subscription.memberId ||
		member?.isSynthetic !== true ||
		member?.syntheticBatchId !== EXPECTED_GENERATION_SEED ||
		typeof subscription.id !== 'string' ||
		typeof subscription.memberId !== 'string' ||
		typeof subscription.createdByUserId !== 'string' ||
		typeof subscription.priceRwf !== 'bigint' ||
		subscription.priceRwf < 0n
	) {
		throw new StagingSeedError(
			'SYNTHETIC_SUBSCRIPTION_INVALID',
			'Only KD GYM subscriptions for the exact synthetic member batch can receive payments.',
		);
	}
	const joinedOn = normalizeDate(member.joinedOn);
	const startDate = normalizeDate(subscription.startDate);
	const endDate = normalizeDate(subscription.endDate);
	if (
		joinedOn < HISTORICAL_START ||
		joinedOn > HISTORICAL_CUTOFF ||
		startDate < joinedOn ||
		startDate < HISTORICAL_START ||
		startDate > HISTORICAL_CUTOFF ||
		endDate < startDate
	) {
		throw new StagingSeedError(
			'SUBSCRIPTION_DATE_INVALID',
			'A synthetic subscription date is outside the approved historical period.',
		);
	}
}

function historicalPaymentTime(subscription) {
	const startDate = normalizeDate(subscription.startDate);
	const endDate = normalizeDate(subscription.endDate);
	const joinedOn = normalizeDate(subscription.member.joinedOn);
	const start = dateFromIso(startDate);
	const maxDays = Math.max(
		0,
		Math.min(
			dateFromIso(endDate).getTime() - start.getTime(),
			dateFromIso(HISTORICAL_CUTOFF).getTime() - start.getTime(),
		) / 86_400_000,
	);
	const delay = Math.floor(randomFraction(subscription.id, 'payment-delay') * 4);
	const paymentDay = addDays(startDate, Math.min(delay, Math.floor(maxDays)));
	if (paymentDay < joinedOn || paymentDay < HISTORICAL_START || paymentDay > HISTORICAL_CUTOFF) {
		throw new StagingSeedError(
			'PAYMENT_DATE_INVALID',
			'A synthetic payment date is outside its member or subscription history.',
		);
	}
	const hour = 8 + Math.floor(randomFraction(subscription.id, 'payment-hour') * 10);
	const minute = Math.floor(randomFraction(subscription.id, 'payment-minute') * 60);
	return new Date(
		`${paymentDay}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${KIGALI_OFFSET}`,
	);
}

function chooseMethod(value) {
	return PAYMENT_METHOD_WEIGHTS.find(({ ceiling }) => value < ceiling)?.method ?? 'OTHER';
}

function makeReceiptNumber(paymentId, occurredAt) {
	const localDate = dateInKigali(occurredAt).replaceAll('-', '');
	return `PAY-${localDate}-${paymentId.slice(0, 8).toUpperCase()}`;
}

function dateInKigali(value) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: HISTORICAL_TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(value);
	const dateParts = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
	return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function makeHistoricalMonthRange() {
	const result = {};
	let cursor = dateFromIso(HISTORICAL_START);
	const cutoff = dateFromIso(HISTORICAL_CUTOFF);
	while (cursor <= cutoff) {
		const month = dateToIso(cursor).slice(0, 7);
		result[month] = 0n;
		cursor.setUTCMonth(cursor.getUTCMonth() + 1);
		cursor.setUTCDate(1);
	}
	return result;
}

function safeNumber(value) {
	const number = Number(value);
	if (!Number.isSafeInteger(number)) {
		throw new StagingSeedError(
			'PAYMENT_SUMMARY_OUT_OF_RANGE',
			'A payment aggregate exceeds the safe whole-RWF reporting range.',
		);
	}
	return number;
}

function normalizeDate(value) {
	if (value instanceof Date) return dateToIso(value);
	if (typeof value !== 'string') {
		throw new StagingSeedError('PAYMENT_DATE_INVALID', 'A historical date is missing or invalid.');
	}
	const date = dateFromIso(value);
	if (!Number.isFinite(date.getTime())) {
		throw new StagingSeedError('PAYMENT_DATE_INVALID', 'A historical date is missing or invalid.');
	}
	return value;
}

function dateFromIso(value) {
	const date = new Date(`${value}T00:00:00.000Z`);
	if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
		throw new StagingSeedError('PAYMENT_DATE_INVALID', 'A historical date is missing or invalid.');
	}
	return date;
}

function dateToIso(value) {
	return value.toISOString().slice(0, 10);
}

function addDays(value, count) {
	const date = dateFromIso(value);
	date.setUTCDate(date.getUTCDate() + count);
	return dateToIso(date);
}

function randomFraction(subscriptionId, purpose) {
	const digest = createHash('sha256')
		.update(`${PAYMENT_GENERATION_SEED}\u001f${subscriptionId}\u001f${purpose}`)
		.digest();
	return digest.readUInt32BE(0) / 0x1_0000_0000;
}

function deterministicUuid(value) {
	const digest = createHash('sha1').update(UUID_NAMESPACE).update(value).digest();
	digest[6] = (digest[6] & 0x0f) | 0x50;
	digest[8] = (digest[8] & 0x3f) | 0x80;
	const hex = digest.subarray(0, 16).toString('hex');
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20),
	].join('-');
}

function fieldsMatch(actual, expected, fields) {
	return fields.every((field) => {
		const actualValue = actual[field];
		const expectedValue = expected[field];
		if (actualValue instanceof Date && expectedValue instanceof Date) {
			return actualValue.getTime() === expectedValue.getTime();
		}
		return actualValue === expectedValue;
	});
}

async function resolveRecorder(transaction, subscriptionCreatorIds) {
	if (subscriptionCreatorIds.length > 0) {
		const subscriptionCreator = await transaction.organizationMembership.findFirst({
			where: {
				organizationId: KD_GYM_ORGANIZATION_ID,
				userId: { in: subscriptionCreatorIds },
				status: 'ACTIVE',
				user: { is: { status: 'ACTIVE' } },
			},
			select: { userId: true },
			orderBy: { userId: 'asc' },
		});
		if (subscriptionCreator !== null) return subscriptionCreator;
	}
	return transaction.organizationMembership.findFirst({
		where: {
			organizationId: KD_GYM_ORGANIZATION_ID,
			status: 'ACTIVE',
			user: { is: { status: 'ACTIVE' } },
		},
		select: { userId: true },
		orderBy: { userId: 'asc' },
	});
}

async function createInChunks(model, rows) {
	let inserted = 0;
	for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
		const result = await model.createMany({
			data: rows.slice(offset, offset + INSERT_CHUNK_SIZE),
			skipDuplicates: false,
		});
		inserted += result.count;
	}
	return inserted;
}

async function assertRequiredSchema(transaction) {
	const tableNames = Object.keys(EXPECTED_COLUMNS);
	const rows = await transaction.$queryRaw`
		SELECT table_name, column_name
		FROM information_schema.columns
		WHERE table_schema = current_schema()
			AND table_name = ANY(${tableNames}::text[])
	`;
	const available = new Map();
	for (const { table_name: tableName, column_name: columnName } of rows) {
		if (!available.has(tableName)) available.set(tableName, new Set());
		available.get(tableName).add(columnName);
	}
	for (const [tableName, columns] of Object.entries(EXPECTED_COLUMNS)) {
		if (!columns.every((column) => available.get(tableName)?.has(column))) {
			throw new StagingSeedError(
				'PAYMENT_SCHEMA_MISSING',
				'Required KD GYM payment tables or columns are missing.',
			);
		}
	}
	const constraints = await transaction.$queryRaw`
		SELECT conname FROM pg_constraint
		WHERE convalidated = true
			AND connamespace = current_schema()::regnamespace
			AND conname = ANY(${[
				'payments_receipt_format_check',
				'payments_amount_range_check',
				'payments_provider_reference_check',
				'payments_lifecycle_check',
				'payment_allocations_amount_range_check',
				'payment_audit_timestamp_order_check',
				'payment_audit_action_check',
				'payments_fingerprint_check',
				'payments_note_nonblank_check',
				'payments_occurred_at_check',
				'payments_timestamp_order_check',
				'payment_audit_request_id_nonblank_check',
				'payment_audit_fingerprint_check',
			]}::text[])
	`;
	const availableConstraints = new Set(constraints.map(({ conname }) => conname));
	if (availableConstraints.size !== 13) {
		throw new StagingSeedError(
			'PAYMENT_CONSTRAINTS_MISSING',
			'Required payment ledger safety constraints are missing or unvalidated.',
		);
	}
}

let writesMayHaveStarted = false;
let stage = 'arguments';
let databaseCloseFailed = false;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).catch((error) => {
		const knownError = error instanceof StagingSeedError;
		process.stderr.write(
			`${JSON.stringify({
				seeder: 'kd-gym-staging-payment-seed',
				failed: true,
				stage,
				code: knownError ? error.code : `STAGING_${stage.toUpperCase()}_FAILED`,
				writesMayHaveCommitted: writesMayHaveStarted,
				databaseCloseFailed,
				message: knownError
					? error.message
					: 'KD GYM staging payment seed failed; inspect staging state before retrying.',
			})}\n`,
		);
		process.exitCode = 2;
	});
}

async function main(arguments_) {
	if (arguments_.length !== 1 || arguments_[0] !== '--apply') {
		throw new StagingSeedError(
			'PAYMENT_APPLY_FLAG_REQUIRED',
			'Supply the explicit --apply option for the staging payment seed.',
		);
	}
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
		stage = 'payment_transaction';
		const result = await seedStagingPayments(application.get(PrismaService), () => {
			writesMayHaveStarted = true;
		});
		stage = 'summary';
		process.stdout.write(
			`${JSON.stringify(
				makePaymentSummary(result, result.subscriptions, result.storedPayments),
				null,
				2,
			)}\n`,
		);
	} catch (error) {
		try {
			await application.close();
		} catch {
			databaseCloseFailed = true;
		}
		throw error;
	}
	try {
		stage = 'database_shutdown';
		await application.close();
	} catch {
		databaseCloseFailed = true;
		throw new StagingSeedError(
			'DATABASE_SHUTDOWN_FAILED',
			'The staging payment operation may have completed; inspect totals before retrying.',
		);
	}
}
