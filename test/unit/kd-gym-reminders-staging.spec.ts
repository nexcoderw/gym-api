import { jest } from '@jest/globals';

import {
	assertReminderBatchMatches,
	generateHistoricalReminders,
	makeReminderSummary,
	seedStagingReminders,
} from '../../scripts/synthetic-data/seed-kd-gym-reminders-staging.mjs';
import {
	EXPECTED_GENERATION_SEED,
	KD_GYM_ORGANIZATION_ID,
} from '../../scripts/synthetic-data/kd-gym-members-preflight.mjs';

const INSERTED_AT = new Date('2026-11-13T10:00:00.000Z');
const SUBSCRIPTIONS = makeSubscriptions(50);
const FIRST_SUBSCRIPTION =
	SUBSCRIPTIONS[0] ??
	makeSubscription('subscription-fallback', '2026-08-01', '2026-10-01', '2026-11-01');

describe('KD GYM staging reminder seed', () => {
	it('generates deterministic historical expiry and three-day occasions inside subscription dates', () => {
		const first = generateHistoricalReminders(SUBSCRIPTIONS, INSERTED_AT);
		const second = generateHistoricalReminders(SUBSCRIPTIONS, INSERTED_AT);
		expect(first.length).toBeGreaterThan(0);
		expect(first).toEqual(second);
		for (const reminder of first) {
			const subscription = SUBSCRIPTIONS.find(({ id }) => id === reminder.memberSubscriptionId);
			if (subscription === undefined) throw new Error('Generated reminder has no subscription.');
			const expected =
				reminder.kind === 'EXPIRY_DAY'
					? subscription.endDate
					: new Date(subscription.endDate.getTime() - 3 * 86_400_000);
			expect(reminder.dueDate).toEqual(expected);
			expect(reminder.dueDate.getTime()).toBeGreaterThanOrEqual(subscription.startDate.getTime());
			expect(
				reminder.dueDate.toISOString().slice(0, 10).localeCompare('2026-11-12'),
			).toBeLessThanOrEqual(0);
		}
	});

	it('uses stable references, supported kinds, SMS-only SKIPPED rows, and no sendable state', () => {
		const rows = generateHistoricalReminders(SUBSCRIPTIONS, INSERTED_AT);
		const identities = new Set();
		for (const row of rows) {
			identities.add(row.providerIdempotencyKey);
			expect(row).toMatchObject({
				organizationId: KD_GYM_ORGANIZATION_ID,
				channel: 'SMS',
				status: 'SKIPPED',
				recipientEmail: null,
				messageSubject: null,
				messageBody: null,
				attemptCount: 0,
				nextAttemptAt: null,
				leaseExpiresAt: null,
				providerMessageId: null,
				acceptedAt: null,
				deliveredAt: null,
				lastErrorCode: 'SYNTHETIC_MEMBER_SUPPRESSED',
				createdAt: INSERTED_AT,
				updatedAt: INSERTED_AT,
			});
			expect(['THREE_DAYS_BEFORE', 'EXPIRY_DAY']).toContain(row.kind);
			expect(row.providerIdempotencyKey).toMatch(/^[a-f0-9]{64}$/u);
			expect(row.id).toMatch(/^[0-9a-f-]{36}$/u);
		}
		expect(identities.size).toBe(rows.length);
	});

	it('never emits occasions before joining or subscription start or beyond the historical cutoff', () => {
		const invalid = [
			makeSubscription('short-period', '2026-10-20', '2026-10-21', '2026-10-21'),
			makeSubscription('short-after-join', '2026-10-20', '2026-10-22', '2026-10-23'),
			makeSubscription('future-expiry', '2026-10-15', '2026-11-10', '2026-11-15'),
		];
		for (const row of generateHistoricalReminders(invalid, INSERTED_AT)) {
			const subscription = invalid.find(({ id }) => id === row.memberSubscriptionId);
			if (subscription === undefined)
				throw new Error('Generated reminder has no source subscription.');
			expect(row.dueDate.getTime()).toBeGreaterThanOrEqual(subscription.startDate.getTime());
			expect(row.dueDate.getTime()).toBeGreaterThanOrEqual(subscription.member.joinedOn.getTime());
			expect(
				row.dueDate.toISOString().slice(0, 10).localeCompare('2026-11-12'),
			).toBeLessThanOrEqual(0);
		}
	});

	it('rejects a member from a different tenant or synthetic batch', () => {
		expect(() =>
			generateHistoricalReminders(
				[{ ...FIRST_SUBSCRIPTION, organizationId: '00000000-0000-4000-8000-000000000001' }],
				INSERTED_AT,
			),
		).toThrow();
		expect(() =>
			generateHistoricalReminders(
				[
					{
						...FIRST_SUBSCRIPTION,
						member: { ...FIRST_SUBSCRIPTION.member, syntheticBatchId: 'other-batch' },
					},
				],
				INSERTED_AT,
			),
		).toThrow();
	});

	it('requires email absence and durable email and SMS suppression', () => {
		const base = FIRST_SUBSCRIPTION;
		for (const member of [
			{ ...base.member, email: 'member@example.com' },
			{ ...base.member, reminderEmailSuppressedAt: null },
			{ ...base.member, reminderEmailSuppressionReason: null },
			{ ...base.member, reminderSmsSuppressedAt: null },
			{ ...base.member, reminderSmsSuppressionReason: null },
		]) {
			expect(() => generateHistoricalReminders([{ ...base, member }], INSERTED_AT)).toThrow();
		}
	});

	it('requires confirmed payment only if the application eligibility contract adds that rule', () => {
		// Current reminder policy is subscription/date and consent based; it does not require payment.
		const pendingPaymentSubscription = {
			...FIRST_SUBSCRIPTION,
			paymentAllocations: [{ payment: { status: 'PENDING' } }],
		};
		expect(generateHistoricalReminders([pendingPaymentSubscription], INSERTED_AT)).toEqual(
			generateHistoricalReminders([FIRST_SUBSCRIPTION], INSERTED_AT),
		);
	});

	it('accepts only an exact batch during reruns', () => {
		const expected = generateHistoricalReminders(SUBSCRIPTIONS, INSERTED_AT);
		expect(() => {
			assertReminderBatchMatches(expected, expected);
		}).not.toThrow();
		expect(() => {
			assertReminderBatchMatches(expected.slice(1), expected);
		}).toThrow(/complete deterministic/u);
		const mismatched = expected.map((row, index) =>
			index === 0 ? { ...row, lastErrorCode: 'CHANGED' } : row,
		);
		expect(() => {
			assertReminderBatchMatches(mismatched, expected);
		}).toThrow(/complete deterministic/u);
	});

	it('inserts only exact synthetic batch subscriptions in one tenant-scoped transaction', async () => {
		const prisma = makePrisma();
		const result = await seedStagingReminders(prisma, INSERTED_AT);
		expect(result.status).toBe('INSERTED');
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: 'Serializable',
			timeout: 120_000,
			maxWait: 30_000,
		});
		expect(prisma.organizationMember.findMany).toHaveBeenCalledWith({
			where: {
				organizationId: KD_GYM_ORGANIZATION_ID,
				isSynthetic: true,
				syntheticBatchId: EXPECTED_GENERATION_SEED,
			},
			select: { id: true },
		});
		expect(prisma.organizationMemberReminderDelivery.createMany).toHaveBeenCalledTimes(1);
		expect(prisma.providerCallCount()).toBe(0);
	});

	it('returns an exact rerun without inserting duplicate rows', async () => {
		const expected = generateHistoricalReminders(SUBSCRIPTIONS, INSERTED_AT);
		const prisma = makePrisma({ existing: expected });
		const result = await seedStagingReminders(prisma, INSERTED_AT);
		expect(result.status).toBe('ALREADY_SEEDED');
		expect(prisma.organizationMemberReminderDelivery.createMany).not.toHaveBeenCalled();
	});

	it('rejects partial and colliding data instead of silently skipping', async () => {
		const expected = generateHistoricalReminders(SUBSCRIPTIONS, INSERTED_AT);
		await expect(
			seedStagingReminders(makePrisma({ existing: expected.slice(1) }), INSERTED_AT),
		).rejects.toThrow(/complete deterministic/u);
		await expect(
			seedStagingReminders(makePrisma({ collision: true }), INSERTED_AT),
		).rejects.toThrow(/deterministic reminder identity/u);
	});

	it('rolls back the complete batch when an insert fails', async () => {
		const prisma = makePrisma({ failInsert: true });
		await expect(seedStagingReminders(prisma, INSERTED_AT)).rejects.toThrow();
		expect(prisma.rollbackObserved()).toBe(true);
	});

	it('refuses a wrong database, organization, synthetic count, or unsafe synthetic member', async () => {
		await expect(
			seedStagingReminders(makePrisma({ databaseName: 'other' }), INSERTED_AT),
		).rejects.toThrow(/neondb/u);
		await expect(
			seedStagingReminders(makePrisma({ organizationName: 'Other gym' }), INSERTED_AT),
		).rejects.toThrow(/KD GYM/u);
		await expect(
			seedStagingReminders(makePrisma({ memberCount: 822 }), INSERTED_AT),
		).rejects.toThrow(/exact 823-member/u);
		await expect(
			seedStagingReminders(makePrisma({ unsafeMember: true }), INSERTED_AT),
		).rejects.toThrow(/email-less, suppressed/u);
	});

	it('reports actual stored rows, zero sends, preserved original reminders, and month distribution', () => {
		const reminders = generateHistoricalReminders(SUBSCRIPTIONS, INSERTED_AT);
		const summary = makeReminderSummary(
			{
				status: 'INSERTED',
				insertedCount: reminders.length,
				originalReminderCount: 7,
				totalOrganizationReminders: reminders.length + 7,
				eligibleSubscriptionIds: [
					...new Set(reminders.map(({ memberSubscriptionId }) => memberSubscriptionId)),
				],
			},
			SUBSCRIPTIONS,
			reminders,
		);
		expect(summary).toMatchObject({
			database: 'neondb',
			organization: 'KD GYM',
			remindersInserted: reminders.length,
			providerSendsPerformed: 0,
			emailChannelReminders: 0,
			smsChannelReminders: reminders.length,
			originalReminderRecordsPreserved: 7,
			transactionStatus: 'INSERTED',
		});
		expect(
			Object.values(summary.monthlyReminderDistribution as Record<string, number>).reduce(
				(sum, count) => sum + count,
				0,
			),
		).toBe(reminders.length);
	});
});

function makeSubscription(id: string, joinedOn: string, start: string, end: string) {
	return {
		id,
		organizationId: KD_GYM_ORGANIZATION_ID,
		memberId: `member-${id}`,
		startDate: new Date(`${start}T00:00:00.000Z`),
		endDate: new Date(`${end}T00:00:00.000Z`),
		cancelledAt: null,
		member: {
			id: `member-${id}`,
			organizationId: KD_GYM_ORGANIZATION_ID,
			isSynthetic: true,
			syntheticBatchId: EXPECTED_GENERATION_SEED,
			joinedOn: new Date(`${joinedOn}T00:00:00.000Z`),
			email: null,
			reminderEmailSuppressedAt: INSERTED_AT,
			reminderEmailSuppressionReason: 'MANUAL',
			reminderSmsSuppressedAt: INSERTED_AT,
			reminderSmsSuppressionReason: 'MANUAL',
		},
	};
}

function makeSubscriptions(count: number) {
	return Array.from({ length: count }, (_, index) => {
		const monthDay = String((index % 26) + 1).padStart(2, '0');
		return makeSubscription(
			`subscription-${String(index)}`,
			'2026-08-01',
			`2026-10-${monthDay}`,
			`2026-11-${monthDay}`,
		);
	});
}

function makePrisma({
	existing = [],
	collision = false,
	failInsert = false,
	databaseName = 'neondb',
	organizationName = 'KD GYM',
	memberCount = 823,
	unsafeMember = false,
}: {
	existing?: readonly object[];
	collision?: boolean;
	failInsert?: boolean;
	databaseName?: string;
	organizationName?: string;
	memberCount?: number;
	unsafeMember?: boolean;
} = {}) {
	let rollback = false;
	let inserted: Record<string, unknown>[] = [];
	const queryRaw = jest
		.fn<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>()
		.mockImplementation((strings) => {
			const query = strings.join(' ');
			if (query.includes('current_database')) return Promise.resolve([{ databaseName }]);
			return Promise.resolve(
				Object.entries({
					organizations: ['id', 'name'],
					organization_members: [
						'id',
						'organization_id',
						'is_synthetic',
						'synthetic_batch_id',
						'joined_on',
						'email',
						'reminder_email_suppressed_at',
						'reminder_email_suppression_reason',
						'reminder_sms_suppressed_at',
						'reminder_sms_suppression_reason',
					],
					organization_member_subscriptions: [
						'id',
						'organization_id',
						'member_id',
						'start_date',
						'end_date',
						'cancelled_at',
					],
					organization_member_reminder_deliveries: [
						'id',
						'organization_id',
						'member_id',
						'member_subscription_id',
						'kind',
						'channel',
						'status',
						'due_date',
						'recipient_email',
						'message_subject',
						'message_body',
						'attempt_count',
						'next_attempt_at',
						'lease_expires_at',
						'provider_idempotency_key',
						'provider_message_id',
						'last_error_code',
						'accepted_at',
						'delivered_at',
						'created_at',
						'updated_at',
					],
					organization_payment_allocations: [
						'organization_id',
						'member_id',
						'member_subscription_id',
					],
					organization_payments: ['organization_id', 'id', 'status'],
				}).flatMap(([table_name, columns]) =>
					columns.map((column_name) => ({ table_name, column_name })),
				),
			);
		});
	let countCalls = 0;
	const organizationMemberReminderDelivery = {
		count: jest.fn<(args: unknown) => Promise<number>>().mockImplementation(() => {
			countCalls += 1;
			if (countCalls === 1) return Promise.resolve(existing.length + 7);
			if (countCalls === 2) return Promise.resolve(7);
			return Promise.resolve(inserted.length + 7);
		}),
		findMany: jest
			.fn<(args: unknown) => Promise<unknown[]>>()
			.mockResolvedValueOnce([...existing])
			.mockResolvedValueOnce(collision ? [{ id: 'collision' }] : [])
			.mockImplementation(() => Promise.resolve(inserted)),
		createMany: jest
			.fn<
				(args: {
					data: Record<string, unknown>[];
					skipDuplicates: boolean;
				}) => Promise<{ count: number }>
			>()
			.mockImplementation(({ data }) => {
				if (failInsert) return Promise.reject(new Error('simulated insert failure'));
				inserted = [...data];
				return Promise.resolve({ count: data.length });
			}),
	};
	const transaction = {
		$queryRaw: queryRaw,
		organization: {
			findUnique: jest
				.fn<(args: unknown) => Promise<{ id: string; name: string }>>()
				.mockResolvedValue({ id: KD_GYM_ORGANIZATION_ID, name: organizationName }),
		},
		organizationMember: {
			findMany: jest
				.fn<(args: unknown) => Promise<{ id: string }[]>>()
				.mockResolvedValue(
					Array.from({ length: memberCount }, (_, index) => ({ id: `member-${String(index)}` })),
				),
		},
		organizationMemberSubscription: {
			findMany: jest.fn<(args: unknown) => Promise<Record<string, unknown>[]>>().mockResolvedValue(
				unsafeMember
					? [
							{
								...FIRST_SUBSCRIPTION,
								member: { ...FIRST_SUBSCRIPTION.member, email: 'real@example.invalid' },
							},
						]
					: SUBSCRIPTIONS,
			),
		},
		organizationMemberReminderDelivery,
	};
	const $transaction = jest
		.fn<
			(
				operation: (value: typeof transaction) => Promise<unknown>,
				options: Record<string, unknown>,
			) => Promise<unknown>
		>()
		.mockImplementation(async (operation) => {
			try {
				return await operation(transaction);
			} catch (error) {
				rollback = true;
				throw error;
			}
		});
	return {
		$transaction,
		organizationMember: transaction.organizationMember,
		organizationMemberReminderDelivery,
		providerCallCount: () => 0,
		rollbackObserved: () => rollback,
	};
}
