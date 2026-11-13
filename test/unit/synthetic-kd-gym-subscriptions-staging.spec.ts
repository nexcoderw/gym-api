import { jest } from '@jest/globals';

import {
	assertExistingBatchMatches,
	assertNoSubscriptionOverlap,
	calculateSubscriptionPeriod,
	generateHistoricalSubscriptions,
	makeSubscriptionSummary,
	seedStagingSubscriptions,
	StagingSeedError,
	HISTORICAL_CUTOFF,
	SUBSCRIPTION_GENERATION_SEED,
} from '../../scripts/synthetic-data/seed-kd-gym-subscriptions-staging.mjs';
import {
	EXPECTED_GENERATION_SEED,
	KD_GYM_ORGANIZATION_ID,
} from '../../scripts/synthetic-data/kd-gym-members-preflight.mjs';

const CREATED_AT = new Date('2026-11-13T10:00:00.000Z');
const USER_ID = '4b7bdfbf-1e84-4d12-9fe1-9bf2049fa2e1';
const PLANS = [
	{ id: 'plan-daily', name: 'Daily', priceRwf: 500n },
	{ id: 'plan-basic', name: 'Basic', priceRwf: 12000n },
	{ id: 'plan-student', name: 'Student', priceRwf: 9000n },
	{ id: 'plan-plus', name: 'Plus', priceRwf: 20000n },
	{ id: 'plan-premium', name: 'Premium', priceRwf: 30000n },
];

function makeMembers() {
	return Array.from({ length: 823 }, (_, index) => {
		const joined = new Date(Date.UTC(2025, 9, 18 + (index % 390)));
		return {
			id: `member-${String(index).padStart(4, '0')}`,
			organizationId: KD_GYM_ORGANIZATION_ID,
			name: `Synthetic Member ${index}`,
			normalizedName: `synthetic member ${index}`,
			phoneNumber: `+25078${String(index).padStart(7, '0')}`,
			email: null,
			gender: index % 2 === 0 ? 'MALE' : 'FEMALE',
			joinedOn: joined.toISOString().slice(0, 10),
			synthetic: true,
			generationBatch: EXPECTED_GENERATION_SEED,
		};
	});
}

describe('KD GYM staging subscription seed', () => {
	it('calculates inclusive period ends with the existing calendar rules', () => {
		expect(calculateSubscriptionPeriod('2026-01-31', 'MONTHS', 1)).toEqual({
			startDate: new Date('2026-01-31T00:00:00.000Z'),
			endDate: new Date('2026-02-27T00:00:00.000Z'),
		});
		expect(calculateSubscriptionPeriod('2026-02-01', 'DAYS', 1).endDate).toEqual(
			new Date('2026-02-01T00:00:00.000Z'),
		);
	});

	it('generates deterministic histories only after each synthetic member joins', () => {
		const members = makeMembers();
		const first = generateHistoricalSubscriptions(members, PLANS, USER_ID, CREATED_AT);
		const rerun = generateHistoricalSubscriptions(members, PLANS, USER_ID, CREATED_AT);
		expect(first).toEqual(rerun);
		expect(first.length).toBeGreaterThan(members.length);
		expect(new Set(first.map(({ data }) => data.id)).size).toBe(first.length);
		expect(new Set(first.map(({ data }) => data.idempotencyKey)).size).toBe(first.length);
		expect(first.every(({ memberId, data }) => {
			const member = members.find(({ id }) => id === memberId);
			return (
				member !== undefined &&
				data.organizationId === KD_GYM_ORGANIZATION_ID &&
				data.createdByUserId === USER_ID &&
				data.createdAt === CREATED_AT &&
				data.updatedAt === CREATED_AT &&
				data.startDate.toISOString().slice(0, 10) >= member.joinedOn &&
				data.startDate.toISOString().slice(0, 10) <= HISTORICAL_CUTOFF &&
				data.requestFingerprint.length === 64 &&
				data.idempotencyKey.length === 36
			);
		})).toBe(true);
		expect(() => assertNoSubscriptionOverlap(first)).not.toThrow();
		expect(new Set(first.map(({ planName }) => planName))).toEqual(
			new Set(PLANS.map(({ name }) => name)),
		);
		expect(new Set(first.map(({ episode }) => episode)).size).toBeGreaterThan(1);
		const hasRenewalGap = members.some((member) => {
			const episodes = first
				.filter(({ memberId }) => memberId === member.id)
				.sort((left, right) => left.episode - right.episode);
			return episodes.some((episode, index) => {
				const previous = episodes[index - 1];
				return (
					previous !== undefined &&
					previous.data.endDate.getTime() + 86_400_000 < episode.data.startDate.getTime()
				);
			});
		});
		expect(hasRenewalGap).toBe(true);
	});

	it('rejects synthetic members outside KD GYM or after the historical cutoff', () => {
		const members = makeMembers();
		const firstMember = members[0];
		if (firstMember === undefined) throw new Error('Test fixtures must include a member.');
		const invalidOrganization = { ...firstMember, organizationId: 'other-org' };
		expect(() => generateHistoricalSubscriptions([invalidOrganization], PLANS, USER_ID, CREATED_AT))
			.toThrow(StagingSeedError);
		const lateJoiner = { ...firstMember, joinedOn: '2026-11-13' };
		expect(() => generateHistoricalSubscriptions([lateJoiner], PLANS, USER_ID, CREATED_AT))
			.toThrow('after the historical subscription cutoff');
	});

	it('reports plan, monthly, renewal, active, expired, and no-history totals', () => {
		const members = makeMembers();
		const histories = generateHistoricalSubscriptions(members, PLANS, USER_ID, CREATED_AT);
		const summary = makeSubscriptionSummary(
			{
				status: 'INSERTED',
				insertedCount: histories.length,
				totalSubscriptionCount: histories.length,
			},
			members,
			histories,
		);
		const countByPlan = summary.subscriptionCountByPlan as Record<string, number>;
		const monthly = summary.monthlySubscriptionDistribution as Record<string, number>;
		expect(Object.values(countByPlan).reduce((sum, count) => sum + count, 0)).toBe(
			histories.length,
		);
		expect(Object.values(monthly).reduce((sum, count) => sum + count, 0)).toBe(
			histories.length,
		);
		expect(summary.renewalCount).toBeGreaterThan(0);
		expect(summary.activeSubscriptionsAsOfCutoff).toBeGreaterThan(0);
		expect(summary.expiredSubscriptionsAsOfCutoff).toBeGreaterThan(0);
		expect(summary.syntheticMembersWithoutSubscriptions).toBeGreaterThan(0);
		expect(summary.transactionResult).toBe('INSERTED');
		expect(SUBSCRIPTION_GENERATION_SEED).toBe('kd-gym-subscriptions-2026-11-12-v1');
	});

	it('accepts only an exact complete deterministic history on rerun', () => {
		const histories = generateHistoricalSubscriptions(makeMembers(), PLANS, USER_ID, CREATED_AT);
		const planned = histories.map(({ data }) => data);
		expect(() => assertExistingBatchMatches(planned, planned)).not.toThrow();
		expect(() => assertExistingBatchMatches(planned.slice(1), planned)).toThrow(/partial/u);
		expect(() =>
			assertExistingBatchMatches(
				planned.map((row, index) => (index === 0 ? { ...row, planName: 'changed' } : row)),
				planned,
			),
		).toThrow(/differs/u);
	});

	it('inserts the batch transactionally and treats exact reruns as idempotent', async () => {
		const members = makeMembers();
		const prisma = makePrisma(members);
		const first = await seedStagingSubscriptions(prisma.client, members, CREATED_AT);
		const second = await seedStagingSubscriptions(prisma.client, members, CREATED_AT);
		expect(first.status).toBe('INSERTED');
		expect(second.status).toBe('ALREADY_SEEDED');
		expect(prisma.insertedRows.length).toBeGreaterThan(members.length);
		expect(prisma.insertedRows.every(({ memberId, organizationId, skipDuplicates }) =>
			memberId !== 'real-member' &&
			organizationId === KD_GYM_ORGANIZATION_ID &&
			skipDuplicates === false,
		)).toBe(true);
		expect(prisma.createManyCalls).toBeGreaterThan(0);
		expect(prisma.transactionOptions).toMatchObject({
			isolationLevel: 'Serializable',
			maxWait: 30_000,
		});
	});

	it('does not mark writes started when staging identity validation fails', async () => {
		const members = makeMembers();
		const prisma = makePrisma(members, { wrongDatabase: true });
		const onWriteStart = jest.fn();
		await expect(
			seedStagingSubscriptions(prisma.client, members, CREATED_AT, onWriteStart),
		).rejects.toThrow('connected database is not');
		expect(onWriteStart).not.toHaveBeenCalled();
		expect(prisma.createManyCalls).toBe(0);
	});

	it('rejects period values outside the subscription constraints', () => {
		expect(() => calculateSubscriptionPeriod('2026-01-01', 'MONTHS', 121)).toThrow(
			/The subscription period is invalid/u,
		);
	});
});

function makePrisma(
	members: ReturnType<typeof makeMembers>,
	options: { wrongDatabase?: boolean } = {},
) {
	const schemaColumns: [string, string][] = [
		['organizations', 'id'],
		['organizations', 'name'],
		...[
			'id',
			'organization_id',
			'is_synthetic',
			'synthetic_batch_id',
			'joined_on',
		].map((column): [string, string] => ['organization_members', column]),
		...[
			'id',
			'organization_id',
			'name',
			'price_rwf',
			'archived_at',
		].map((column): [string, string] => ['organization_membership_plans', column]),
		...[
			'id',
			'organization_id',
			'member_id',
			'membership_plan_id',
			'plan_name',
			'price_rwf',
			'period_unit',
			'period_count',
			'start_date',
			'end_date',
			'idempotency_key',
			'request_fingerprint',
			'created_by_user_id',
			'cancelled_at',
			'cancelled_by_user_id',
			'created_at',
			'updated_at',
		].map((column): [string, string] => ['organization_member_subscriptions', column]),
		...['organization_id', 'user_id', 'status'].map((column): [string, string] => [
			'organization_memberships',
			column,
		]),
		...['id', 'status'].map((column): [string, string] => ['users', column]),
	];
	const storedRows: Record<string, unknown>[] = [];
	const insertedRows: Array<{
		memberId: string;
		organizationId: string;
		skipDuplicates: boolean;
	}> = [];
	let rawQueryCount = 0;
	let createManyCalls = 0;
	let transactionOptions: unknown;
	const transaction = {
		$queryRaw: async () => {
			rawQueryCount += 1;
			if (rawQueryCount === 1) {
				return schemaColumns.map(([table_name, column_name]) => ({ table_name, column_name }));
			}
			if (rawQueryCount === 2) return [{ conname: 'member_subscriptions_no_overlap' }];
			return [{ databaseName: options.wrongDatabase === true ? 'other' : 'neondb' }];
		},
		organization: {
			findUnique: async () => ({ id: KD_GYM_ORGANIZATION_ID, name: 'KD GYM' }),
		},
		organizationMember: {
			findMany: async () =>
				members.map((member) => ({
					id: member.id,
					joinedOn: new Date(`${member.joinedOn}T00:00:00.000Z`),
				})),
			count: async (args: { where: { isSynthetic?: boolean } }) =>
				args.where.isSynthetic === false ? 1 : 824,
		},
		organizationMembershipPlan: {
			findMany: async () => PLANS,
		},
		organizationMembership: {
			findFirst: async () => ({ userId: USER_ID }),
		},
		organizationMemberSubscription: {
			count: async () => 4 + storedRows.length,
			findMany: async (args: { where: { idempotencyKey?: unknown } }) =>
				args.where.idempotencyKey === undefined ? storedRows : [],
			createMany: async (args: {
				data: Record<string, unknown>[];
				skipDuplicates: boolean;
			}) => {
				createManyCalls += 1;
				for (const row of args.data) {
					storedRows.push(row);
					insertedRows.push({
						memberId: String(row.memberId),
						organizationId: String(row.organizationId),
						skipDuplicates: args.skipDuplicates,
					});
				}
				return { count: args.data.length };
			},
		},
	};
	const client = {
		$transaction: async (
			callback: (value: typeof transaction) => Promise<unknown>,
			settings: unknown,
		) => {
			transactionOptions = settings;
			return callback(transaction);
		},
	};
	return {
		client,
		insertedRows,
		get createManyCalls() {
			return createManyCalls;
		},
		get transactionOptions() {
			return transactionOptions;
		},
	};
}
