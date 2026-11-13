import { jest } from '@jest/globals';

import {
	assertPaymentBatchMatches,
	generateHistoricalPayments,
	HISTORICAL_START,
	makePaymentSummary,
	PAYMENT_METHODS,
	seedStagingPayments,
} from '../../scripts/synthetic-data/seed-kd-gym-payments-staging.mjs';
import {
	EXPECTED_GENERATION_SEED,
	KD_GYM_ORGANIZATION_ID,
} from '../../scripts/synthetic-data/kd-gym-members-preflight.mjs';

const INSERTED_AT = new Date('2026-11-13T10:00:00.000Z');
const USER_ID = '4b7bdfbf-1e84-4d12-9fe1-9bf2049fa2e1';
const SUBSCRIPTIONS = makeSubscriptions();

describe('KD GYM staging payment seed', () => {
	it('generates repeatable payments from the exact subscription price snapshots', () => {
		const first = generateHistoricalPayments(SUBSCRIPTIONS, USER_ID, INSERTED_AT);
		const rerun = generateHistoricalPayments(SUBSCRIPTIONS, USER_ID, INSERTED_AT);
		expect(first).toEqual(rerun);
		expect(first.length).toBeLessThan(SUBSCRIPTIONS.length);
		expect(new Set(first.map(({ payment }) => payment.id)).size).toBe(first.length);
		expect(new Set(first.map(({ payment }) => payment.idempotencyKey)).size).toBe(first.length);
		expect(new Set(first.map(({ payment }) => payment.receiptNumber)).size).toBe(first.length);
		expect(
			first.every(({ payment, allocation, auditEvent, subscriptionId }) => {
				const subscription = SUBSCRIPTIONS.find(({ id }) => id === subscriptionId);
				return (
					subscription !== undefined &&
					payment.organizationId === KD_GYM_ORGANIZATION_ID &&
					payment.memberId === subscription.memberId &&
					payment.amountRwf === subscription.priceRwf &&
					payment.amountRwf % 1n === 0n &&
					payment.createdAt === INSERTED_AT &&
					payment.updatedAt === INSERTED_AT &&
					payment.requestFingerprint.length === 64 &&
					/^PAY-\d{8}-[0-9A-F]{8}$/u.test(payment.receiptNumber) &&
					payment.occurredAt >= subscription.startDate &&
					payment.occurredAt <= subscription.endDate &&
					payment.occurredAt.toISOString().slice(0, 10) >= HISTORICAL_START &&
					payment.occurredAt.toISOString().slice(0, 10) <= '2026-11-12' &&
					allocation.memberSubscriptionId === subscription.id &&
					allocation.amountRwf === payment.amountRwf &&
					allocation.organizationId === payment.organizationId &&
					auditEvent.paymentId === payment.id &&
					auditEvent.actorUserId === USER_ID &&
					auditEvent.idempotencyKey === payment.idempotencyKey &&
					auditEvent.requestFingerprint === payment.requestFingerprint &&
					auditEvent.occurredAt === payment.occurredAt &&
					auditEvent.recordedAt === INSERTED_AT
				);
			}),
		).toBe(true);
	});

	it('confirms cash only and leaves external methods pending without real provider references', () => {
		const payments = generateHistoricalPayments(SUBSCRIPTIONS, USER_ID, INSERTED_AT);
		const methods = new Set(payments.map(({ payment }) => payment.method));
		expect(methods).toEqual(new Set(PAYMENT_METHODS));
		for (const { payment } of payments) {
			if (payment.method === 'CASH') {
				expect(payment.status).toBe('CONFIRMED');
				expect(payment.providerReference).toBeNull();
				expect(payment.confirmedAt).toBe(INSERTED_AT);
			} else {
				expect(payment.status).toBe('PENDING');
				expect(payment.confirmedAt).toBeNull();
				expect(payment.providerReference).toMatch(/^SYNTHETIC-STAGING-NO-PROVIDER-/u);
			}
		}
	});

	it('records the matching payment allocation and PAYMENT_RECORDED audit event', () => {
		const generated = generateHistoricalPayments(SUBSCRIPTIONS, USER_ID, INSERTED_AT);
		for (const { payment, allocation, auditEvent } of generated) {
			expect(allocation).toMatchObject({
				organizationId: KD_GYM_ORGANIZATION_ID,
				paymentId: payment.id,
				memberId: payment.memberId,
				amountRwf: payment.amountRwf,
			});
			expect(auditEvent).toMatchObject({
				organizationId: KD_GYM_ORGANIZATION_ID,
				paymentId: payment.id,
				actorUserId: USER_ID,
				action: 'PAYMENT_RECORDED',
				resultingStatus: payment.status,
				idempotencyKey: payment.idempotencyKey,
				requestFingerprint: payment.requestFingerprint,
			});
			expect(auditEvent.requestId).toBe(`stg-kd-gym-payment:${payment.id}`);
		}
	});

	it('reports confirmed revenue separately from pending amounts and leaves unpaid subscriptions unpaid', () => {
		const generated = generateHistoricalPayments(SUBSCRIPTIONS, USER_ID, INSERTED_AT);
		const storedPayments = generated.map(({ payment, allocation, auditEvent }) => ({
			...payment,
			allocations: [allocation],
			auditEvents: [auditEvent],
		}));
		const summary = makePaymentSummary(
			{
				paymentCount: generated.length,
				allocationCount: generated.length,
				auditEventCount: generated.length,
				status: 'INSERTED',
				totalOrganizationPayments: generated.length + 1,
			},
			SUBSCRIPTIONS,
			storedPayments,
		);
		const expectedConfirmed = storedPayments
			.filter(({ status }) => status === 'CONFIRMED')
			.reduce((sum, { amountRwf }) => sum + amountRwf, 0n);
		const expectedPending = storedPayments
			.filter(({ status }) => status === 'PENDING')
			.reduce((sum, { amountRwf }) => sum + amountRwf, 0n);
		expect(summary.totalConfirmedRevenueRwf).toBe(Number(expectedConfirmed));
		expect(summary.totalPendingAmountRwf).toBe(Number(expectedPending));
		const confirmedSubscriptionIds = new Set(
			storedPayments
				.filter(({ status }) => status === 'CONFIRMED')
				.flatMap(({ allocations }) =>
					allocations.map(({ memberSubscriptionId }) => memberSubscriptionId),
				),
		);
		expect(summary.unpaidSubscriptions).toBe(SUBSCRIPTIONS.length - confirmedSubscriptionIds.size);
		expect(Object.keys(summary.monthlyConfirmedRevenueRwf as object)).toHaveLength(14);
	});

	it('accepts only an exact complete payment, allocation, and audit batch', () => {
		const generated = generateHistoricalPayments(SUBSCRIPTIONS, USER_ID, INSERTED_AT);
		const rows = generated.map(({ payment, allocation, auditEvent }) => ({
			...payment,
			allocations: [allocation],
			auditEvents: [auditEvent],
		}));
		expect(() => {
			assertPaymentBatchMatches(rows, generated);
		}).not.toThrow();
		expect(() => {
			assertPaymentBatchMatches(rows.slice(1), generated);
		}).toThrow(/part of the synthetic/u);
	});

	it('inserts payment, allocation, and audit rows atomically and preserves existing payments', async () => {
		const prisma = makePrisma();
		const onWriteStart = jest.fn();
		const result = await seedStagingPayments(prisma.client, onWriteStart);
		const insertedCount = prisma.insertedPayments.length;
		const rerun = await seedStagingPayments(prisma.client);
		expect(result.status).toBe('INSERTED');
		expect(rerun.status).toBe('ALREADY_SEEDED');
		expect(insertedCount).toBeGreaterThan(0);
		expect(prisma.insertedPayments).toHaveLength(insertedCount);
		expect(
			prisma.insertedPayments.every(
				({ organizationId, memberId }) =>
					organizationId === KD_GYM_ORGANIZATION_ID && memberId !== 'real-member',
			),
		).toBe(true);
		expect(prisma.insertedAllocations).toHaveLength(prisma.insertedPayments.length);
		expect(prisma.insertedAudits).toHaveLength(prisma.insertedPayments.length);
		expect(prisma.existingOrganizationPaymentCount).toBe(1);
		expect(prisma.subscriptionQuery).toMatchObject({
			where: {
				organizationId: KD_GYM_ORGANIZATION_ID,
				member: {
					is: {
						isSynthetic: true,
						syntheticBatchId: EXPECTED_GENERATION_SEED,
					},
				},
			},
		});
		expect(onWriteStart).toHaveBeenCalledTimes(1);
		expect(prisma.transactionOptions).toMatchObject({ isolationLevel: 'Serializable' });
	});

	it('rolls back all ledger rows when an allocation insert fails', async () => {
		const prisma = makePrisma({ failAllocations: true });
		await expect(seedStagingPayments(prisma.client)).rejects.toThrow('allocation insert failed');
		expect(prisma.rollbackObserved).toBe(true);
		expect(prisma.insertedPayments).toHaveLength(0);
		expect(prisma.insertedAllocations).toHaveLength(0);
		expect(prisma.insertedAudits).toHaveLength(0);
	});

	it('refuses the wrong database before payment writes', async () => {
		const prisma = makePrisma({ wrongDatabase: true });
		const onWriteStart = jest.fn();
		await expect(seedStagingPayments(prisma.client, onWriteStart)).rejects.toThrow(
			'not the configured neondb staging database',
		);
		expect(onWriteStart).not.toHaveBeenCalled();
		expect(prisma.insertedPayments).toHaveLength(0);
	});
});

function makeSubscriptions() {
	const planNames = ['Daily Plan', 'Basic Plan', 'Student Plan', 'Plus Plan', 'Premium Plan'];
	return Array.from({ length: 823 }, (_, index) => {
		const joinedOn = new Date(Date.UTC(2025, 9, 18 + (index % 390)));
		const startDate = new Date(joinedOn);
		startDate.setUTCDate(startDate.getUTCDate() + Math.min(index % 11, 7));
		if (startDate > new Date('2026-11-12T00:00:00.000Z')) {
			startDate.setTime(Date.parse('2026-11-12T00:00:00.000Z'));
		}
		const endDate = new Date(startDate);
		endDate.setUTCDate(endDate.getUTCDate() + 29);
		const idSuffix = String(index).padStart(12, '0');
		return {
			id: `00000000-0000-4000-8000-${idSuffix}`,
			organizationId: KD_GYM_ORGANIZATION_ID,
			memberId: `10000000-0000-4000-8000-${idSuffix}`,
			membershipPlanId: `20000000-0000-4000-8000-${String(index % 5).padStart(12, '0')}`,
			planName: planNames[index % 5],
			priceRwf: BigInt(1000 + (index % 5) * 1000),
			startDate,
			endDate,
			createdByUserId: USER_ID,
			member: {
				id: `10000000-0000-4000-8000-${idSuffix}`,
				organizationId: KD_GYM_ORGANIZATION_ID,
				isSynthetic: true,
				syntheticBatchId: EXPECTED_GENERATION_SEED,
				joinedOn,
			},
		};
	});
}

function makePrisma(options: { failAllocations?: boolean; wrongDatabase?: boolean } = {}) {
	const tableByColumns: Record<string, string[]> = {
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
	};
	const constraintNames = [
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
	];
	let paymentRows: Record<string, unknown>[] = [];
	let allocationRows: Record<string, unknown>[] = [];
	let auditRows: Record<string, unknown>[] = [];
	let transactionOptions: unknown;
	const rollbackObserved = { value: false };
	let subscriptionQuery: unknown;
	const subscriptions = SUBSCRIPTIONS.map((subscription) => ({
		...subscription,
		member: { ...subscription.member, joinedOn: subscription.member.joinedOn },
	}));
	const transaction = {
		$queryRaw: (query: TemplateStringsArray) => {
			const sql = query.join('');
			if (sql.includes('information_schema.columns')) {
				return Promise.resolve(
					Object.entries(tableByColumns).flatMap(([table_name, columns]) =>
						columns.map((column_name) => ({ table_name, column_name })),
					),
				);
			}
			if (sql.includes('pg_constraint')) {
				return Promise.resolve(constraintNames.map((conname) => ({ conname })));
			}
			if (sql.includes('current_database')) {
				return Promise.resolve([
					{ databaseName: options.wrongDatabase === true ? 'other' : 'neondb' },
				]);
			}
			return Promise.resolve([{ insertedAt: INSERTED_AT }]);
		},
		organization: {
			findUnique: () => Promise.resolve({ id: KD_GYM_ORGANIZATION_ID, name: 'KD GYM' }),
		},
		organizationMember: {
			count: () => Promise.resolve(823),
		},
		organizationMemberSubscription: {
			findMany: (args: unknown) => {
				subscriptionQuery = args;
				return Promise.resolve(subscriptions);
			},
		},
		organizationMembership: {
			findFirst: () => Promise.resolve({ userId: USER_ID }),
		},
		organizationPayment: {
			count: () => Promise.resolve(1 + paymentRows.length),
			findMany: (args: { where: { OR?: unknown } }) => {
				if (args.where.OR !== undefined) return Promise.resolve([]);
				return Promise.resolve(
					paymentRows.map((payment) => ({
						...payment,
						allocations: allocationRows.filter((row) => row.paymentId === payment.id),
						auditEvents: auditRows.filter((row) => row.paymentId === payment.id),
					})),
				);
			},
			createMany: (args: { data: Record<string, unknown>[] }) => {
				paymentRows = [...paymentRows, ...args.data];
				return Promise.resolve({ count: args.data.length });
			},
		},
		organizationPaymentAllocation: {
			createMany: (args: { data: Record<string, unknown>[] }) => {
				if (options.failAllocations === true) {
					return Promise.reject(new Error('allocation insert failed'));
				}
				allocationRows = [...allocationRows, ...args.data];
				return Promise.resolve({ count: args.data.length });
			},
		},
		organizationPaymentAuditEvent: {
			createMany: (args: { data: Record<string, unknown>[] }) => {
				auditRows = [...auditRows, ...args.data];
				return Promise.resolve({ count: args.data.length });
			},
		},
	};
	const client = {
		$transaction: async (
			operation: (value: typeof transaction) => Promise<unknown>,
			settings: unknown,
		) => {
			transactionOptions = settings;
			const paymentSnapshot = [...paymentRows];
			const allocationSnapshot = [...allocationRows];
			const auditSnapshot = [...auditRows];
			try {
				const result = await operation(transaction);
				return result;
			} catch (error) {
				paymentRows = paymentSnapshot;
				allocationRows = allocationSnapshot;
				auditRows = auditSnapshot;
				rollbackObserved.value = true;
				throw error;
			}
		},
	};
	return {
		client,
		get insertedPayments() {
			return paymentRows;
		},
		get insertedAllocations() {
			return allocationRows;
		},
		get insertedAudits() {
			return auditRows;
		},
		get existingOrganizationPaymentCount() {
			return 1;
		},
		get subscriptionQuery() {
			return subscriptionQuery;
		},
		get transactionOptions() {
			return transactionOptions;
		},
		get rollbackObserved() {
			return rollbackObserved.value;
		},
	};
}
