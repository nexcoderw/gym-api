import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	EXPECTED_BASELINE_MEMBER_COUNT,
	EXPECTED_FINAL_MEMBER_COUNT,
	EXPECTED_GENERATION_SEED,
	EXPECTED_RECORD_COUNT,
	KD_GYM_ORGANIZATION_ID,
} from './kd-gym-members-preflight.mjs';
import { loadStagingFixtures, StagingSeedError } from './kd-gym-members-staging.mjs';
import { runSerializableImportTransaction } from './kd-gym-members-import.mjs';

export { StagingSeedError };

export const STAGING_DATABASE_NAME = 'neondb';
export const HISTORICAL_CUTOFF = '2026-11-12';
export const HISTORICAL_TIMEZONE = 'Africa/Kigali';
export const SUBSCRIPTION_GENERATION_SEED = 'kd-gym-subscriptions-2026-11-12-v1';
export const EXPECTED_PLAN_NAMES = Object.freeze(['Daily', 'Basic', 'Student', 'Plus', 'Premium']);

const EXPECTED_COLUMNS = Object.freeze({
	organizations: ['id', 'name'],
	organization_members: [
		'id',
		'organization_id',
		'is_synthetic',
		'synthetic_batch_id',
		'joined_on',
	],
	organization_membership_plans: [
		'id',
		'organization_id',
		'name',
		'normalized_name',
		'price_rwf',
		'archived_at',
	],
	organization_member_subscriptions: [
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
	],
	organization_memberships: ['organization_id', 'user_id', 'status'],
	users: ['id', 'status'],
});

const SUBSCRIPTION_SELECT = Object.freeze({
	id: true,
	organizationId: true,
	memberId: true,
	membershipPlanId: true,
	planName: true,
	priceRwf: true,
	periodUnit: true,
	periodCount: true,
	startDate: true,
	endDate: true,
	idempotencyKey: true,
	requestFingerprint: true,
	createdByUserId: true,
	cancelledAt: true,
	cancelledByUserId: true,
	createdAt: true,
	updatedAt: true,
});

const PERIOD_LIMITS = Object.freeze({ DAYS: 3650, WEEKS: 520, MONTHS: 120, YEARS: 10 });
const PLAN_WEIGHTS = Object.freeze({
	Daily: 0.1,
	Basic: 0.28,
	Student: 0.2,
	Plus: 0.24,
	Premium: 0.18,
});
const UUID_NAMESPACE = Buffer.from('3f5a5f41f7f34ac08ea4856a4b61946e', 'hex');
const INSERT_CHUNK_SIZE = 200;

export function assertStagingDatabaseConfiguration(databaseUrl) {
	let parsedUrl;
	try {
		parsedUrl = new URL(databaseUrl);
	} catch {
		throw new StagingSeedError(
			'SUBSCRIPTION_DATABASE_URL_INVALID',
			'A valid PostgreSQL DATABASE_URL for neondb is required.',
		);
	}
	let databaseName;
	try {
		databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
	} catch {
		throw new StagingSeedError(
			'SUBSCRIPTION_DATABASE_NAME_INVALID',
			'The configured staging database name is invalid.',
		);
	}
	if (
		!['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
		parsedUrl.hostname.length === 0 ||
		databaseName !== STAGING_DATABASE_NAME
	) {
		throw new StagingSeedError(
			'SUBSCRIPTION_STAGING_DATABASE_REQUIRED',
			'DATABASE_URL must identify the configured PostgreSQL neondb staging database.',
		);
	}
}

/** Mirrors owner memberPeriod's UTC calendar arithmetic and inclusive end-date convention. */
export function calculateSubscriptionPeriod(start, periodUnit, periodCount) {
	if (!/^20\d{2}-\d{2}-\d{2}$/u.test(start)) {
		throw new StagingSeedError(
			'SUBSCRIPTION_PERIOD_INVALID',
			'A valid subscription start date is required.',
		);
	}
	const startDate = dateFromIso(start);
	const maximum = PERIOD_LIMITS[periodUnit];
	if (
		maximum === undefined ||
		!Number.isInteger(periodCount) ||
		periodCount < 1 ||
		periodCount > maximum
	) {
		throw new StagingSeedError(
			'SUBSCRIPTION_PERIOD_INVALID',
			'The subscription period is invalid.',
		);
	}
	const boundary = new Date(startDate);
	if (periodUnit === 'DAYS' || periodUnit === 'WEEKS') {
		boundary.setUTCDate(boundary.getUTCDate() + periodCount * (periodUnit === 'WEEKS' ? 7 : 1));
	} else {
		const day = boundary.getUTCDate();
		boundary.setUTCDate(1);
		boundary.setUTCMonth(boundary.getUTCMonth() + periodCount * (periodUnit === 'YEARS' ? 12 : 1));
		const lastDay = new Date(Date.UTC(boundary.getUTCFullYear(), boundary.getUTCMonth() + 1, 0));
		boundary.setUTCDate(Math.min(day, lastDay.getUTCDate()));
	}
	boundary.setUTCDate(boundary.getUTCDate() - 1);
	return { startDate, endDate: boundary };
}

/** Makes deterministic, non-overlapping historical subscription episodes for synthetic members. */
export function generateHistoricalSubscriptions(members, plans, createdByUserId, createdAt) {
	assertPlanSet(plans);
	const planByName = new Map(plans.map((plan) => [plan.name, plan]));
	const histories = [];
	const cutoff = dateFromIso(HISTORICAL_CUTOFF);
	const cutoffText = HISTORICAL_CUTOFF;

	for (const member of members) {
		assertSyntheticMember(member);
		const joinedOn = normalizeDate(member.joinedOn);
		if (joinedOn > cutoffText) {
			throw new StagingSeedError(
				'MEMBER_JOINED_AFTER_CUTOFF',
				'A synthetic member joins after the historical subscription cutoff.',
			);
		}
		if (randomFraction(member.id, 'history', 0) < 0.07) continue;

		const delayDays = Math.floor(randomFraction(member.id, 'initial-delay', 0) * 15);
		let startText = addDays(joinedOn, delayDays);
		if (startText > cutoffText) continue;

		for (let episode = 0; episode < 14 && startText <= cutoffText; episode += 1) {
			const plan = choosePlan(plans, member.id, episode);
			const planCategory = canonicalPlanName(plan);
			const period = choosePeriod(planCategory, member.id, episode);
			const dates = calculateSubscriptionPeriod(startText, period.periodUnit, period.periodCount);
			const startDate = dateToIso(dates.startDate);
			const endDate = dateToIso(dates.endDate);
			if (startText < joinedOn || startText > cutoffText) {
				throw new StagingSeedError(
					'SUBSCRIPTION_DATE_OUT_OF_RANGE',
					'A generated subscription date is outside its member history.',
				);
			}
			const idempotencyKey = deterministicUuid(
				`${SUBSCRIPTION_GENERATION_SEED}:key:${member.id}:${episode}`,
			);
			const id = deterministicUuid(`${SUBSCRIPTION_GENERATION_SEED}:id:${member.id}:${episode}`);
			const fingerprintParts =
				episode === 0
					? [
							'create',
							member.name,
							member.normalizedName,
							member.phoneNumber,
							member.email ?? null,
							...(member.gender == null ? [] : [member.gender]),
							plan.id,
							startText,
							period.periodUnit,
							period.periodCount,
						]
					: ['renew', member.id, plan.id, startText, period.periodUnit, period.periodCount];
			const requestFingerprint = createHash('sha256')
				.update(JSON.stringify(fingerprintParts))
				.digest('hex');

			histories.push({
				memberId: member.id,
				episode,
				planName: planCategory,
				data: {
					id,
					organizationId: KD_GYM_ORGANIZATION_ID,
					memberId: member.id,
					membershipPlanId: plan.id,
					planName: plan.name,
					priceRwf: plan.priceRwf,
					periodUnit: period.periodUnit,
					periodCount: period.periodCount,
					startDate: dates.startDate,
					endDate: dates.endDate,
					idempotencyKey,
					requestFingerprint,
					createdByUserId,
					cancelledAt: null,
					cancelledByUserId: null,
					createdAt,
					updatedAt: createdAt,
				},
			});

			if (endDate >= cutoffText || randomFraction(member.id, 'renewal', episode) >= 0.78) break;
			const gapDays =
				randomFraction(member.id, 'gap', episode) < 0.24
					? 2 + Math.floor(randomFraction(member.id, 'gap-length', episode) * 29)
					: 0;
			startText = addDays(endDate, 1 + gapDays);
		}
	}

	assertNoSubscriptionOverlap(histories);
	return histories;
}

export function assertNoSubscriptionOverlap(histories) {
	const byMember = new Map();
	for (const history of histories) {
		const records = byMember.get(history.memberId) ?? [];
		records.push(history);
		byMember.set(history.memberId, records);
	}
	for (const records of byMember.values()) {
		records.sort((left, right) => left.data.startDate.getTime() - right.data.startDate.getTime());
		for (let index = 1; index < records.length; index += 1) {
			const previous = records[index - 1];
			const current = records[index];
			if (
				previous === undefined ||
				current === undefined ||
				previous.data.endDate >= current.data.startDate
			) {
				throw new StagingSeedError(
					'SUBSCRIPTION_PERIOD_OVERLAP',
					'Generated subscriptions overlap for a synthetic member.',
				);
			}
		}
	}
}

/** Inserts the exact deterministic episode set or accepts only an exact prior complete insert. */
export async function seedStagingSubscriptions(
	prisma,
	members,
	createdAt = new Date(),
	onWriteStart = () => {},
) {
	if (members.length !== EXPECTED_RECORD_COUNT) {
		throw new StagingSeedError(
			'SYNTHETIC_MEMBER_BATCH_INVALID',
			'The subscription seed requires the exact 823-member synthetic batch.',
		);
	}
	return runSerializableImportTransaction(
		prisma,
		async (transaction) => {
			await assertRequiredSchema(transaction);
			const [{ databaseName }] = await transaction.$queryRaw`
				SELECT current_database() AS "databaseName"
			`;
			if (databaseName !== STAGING_DATABASE_NAME) {
				throw new StagingSeedError(
					'SUBSCRIPTION_DATABASE_IDENTITY_INVALID',
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

			const memberIds = members.map(({ id }) => id);
			const syntheticMembers = await transaction.organizationMember.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					isSynthetic: true,
					syntheticBatchId: EXPECTED_GENERATION_SEED,
				},
				select: { id: true, joinedOn: true },
			});
			const totalMembers = await transaction.organizationMember.count({
				where: { organizationId: KD_GYM_ORGANIZATION_ID },
			});
			const realMemberCount = await transaction.organizationMember.count({
				where: { organizationId: KD_GYM_ORGANIZATION_ID, isSynthetic: false },
			});
			assertExactSyntheticMemberBatch(syntheticMembers, members);
			if (
				totalMembers !== EXPECTED_FINAL_MEMBER_COUNT ||
				realMemberCount !== EXPECTED_BASELINE_MEMBER_COUNT
			) {
				throw new StagingSeedError(
					'MEMBER_BASELINE_MISMATCH',
					'The KD GYM member baseline changed; refusing to seed subscriptions.',
				);
			}

			const plans = await transaction.organizationMembershipPlan.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					archivedAt: null,
				},
				select: { id: true, name: true, normalizedName: true, priceRwf: true },
				orderBy: { name: 'asc' },
			});
			assertPlanSet(plans);

			const actorMembership = await transaction.organizationMembership.findFirst({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					status: 'ACTIVE',
					user: { is: { status: 'ACTIVE' } },
				},
				select: { userId: true },
				orderBy: { userId: 'asc' },
			});
			if (actorMembership === null) {
				throw new StagingSeedError(
					'ACTIVE_ORGANIZATION_USER_REQUIRED',
					'An existing active KD GYM organization user is required.',
				);
			}

			const subscriptionCountBefore = await transaction.organizationMemberSubscription.count({
				where: { organizationId: KD_GYM_ORGANIZATION_ID },
			});
			const createdByUserId = actorMembership.userId;
			const fixturesById = new Map(members.map((member) => [member.id, member]));
			const histories = generateHistoricalSubscriptions(
				syntheticMembers.map((member) => ({
					...fixturesById.get(member.id),
					isSynthetic: true,
					syntheticBatchId: EXPECTED_GENERATION_SEED,
					joinedOn: member.joinedOn,
				})),
				plans,
				createdByUserId,
				createdAt,
			);
			const planned = histories.map(({ data }) => data);
			const existing = await transaction.organizationMemberSubscription.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					memberId: { in: memberIds },
				},
				select: SUBSCRIPTION_SELECT,
				orderBy: [{ memberId: 'asc' }, { startDate: 'asc' }, { id: 'asc' }],
			});

			if (existing.length > 0) {
				assertExistingBatchMatches(existing, planned);
				return {
					status: 'ALREADY_SEEDED',
					insertedCount: 0,
					totalSubscriptionCount: subscriptionCountBefore,
					histories,
				};
			}

			const idempotencyCollisions = await transaction.organizationMemberSubscription.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					idempotencyKey: { in: planned.map(({ idempotencyKey }) => idempotencyKey) },
				},
				select: { id: true },
			});
			if (idempotencyCollisions.length > 0) {
				throw new StagingSeedError(
					'SUBSCRIPTION_IDEMPOTENCY_COLLISION',
					'A generated subscription idempotency key already belongs to another record.',
				);
			}

			let insertedCount = 0;
			if (planned.length > 0) onWriteStart();
			for (let offset = 0; offset < planned.length; offset += INSERT_CHUNK_SIZE) {
				const batch = planned.slice(offset, offset + INSERT_CHUNK_SIZE);
				const inserted = await transaction.organizationMemberSubscription.createMany({
					data: batch,
					skipDuplicates: false,
				});
				insertedCount += inserted.count;
			}
			if (insertedCount !== planned.length) {
				throw new StagingSeedError(
					'SUBSCRIPTION_INSERT_COUNT_MISMATCH',
					'The complete synthetic subscription batch was not inserted; transaction rolled back.',
				);
			}
			const insertedRows = await transaction.organizationMemberSubscription.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					memberId: { in: memberIds },
				},
				select: SUBSCRIPTION_SELECT,
				orderBy: [{ memberId: 'asc' }, { startDate: 'asc' }, { id: 'asc' }],
			});
			assertExistingBatchMatches(insertedRows, planned);
			const totalSubscriptionCount = await transaction.organizationMemberSubscription.count({
				where: { organizationId: KD_GYM_ORGANIZATION_ID },
			});
			if (totalSubscriptionCount !== subscriptionCountBefore + insertedCount) {
				throw new StagingSeedError(
					'SUBSCRIPTION_TOTAL_MISMATCH',
					'The organization subscription total changed unexpectedly; transaction rolled back.',
				);
			}
			return { status: 'INSERTED', insertedCount, totalSubscriptionCount, histories };
		},
		{ maxWait: 30_000 },
	);
}

export function assertExactSyntheticMemberBatch(databaseMembers, fixtures) {
	if (
		databaseMembers.length !== EXPECTED_RECORD_COUNT ||
		fixtures.length !== EXPECTED_RECORD_COUNT
	) {
		throw new StagingSeedError(
			'SYNTHETIC_MEMBER_BATCH_INVALID',
			'The database must contain exactly the validated KD GYM synthetic member batch.',
		);
	}
	const fixturesById = new Map(fixtures.map((member) => [member.id, member]));
	const seen = new Set();
	for (const member of databaseMembers) {
		const fixture = fixturesById.get(member.id);
		if (
			fixture === undefined ||
			seen.has(member.id) ||
			fixture.organizationId !== KD_GYM_ORGANIZATION_ID ||
			fixture.synthetic !== true ||
			fixture.generationBatch !== EXPECTED_GENERATION_SEED ||
			normalizeDate(member.joinedOn) !== normalizeDate(fixture.joinedOn)
		) {
			throw new StagingSeedError(
				'SYNTHETIC_MEMBER_BATCH_INVALID',
				'The database synthetic member batch does not match the validated fixture IDs and dates.',
			);
		}
		seen.add(member.id);
	}
}

export function assertExistingBatchMatches(existingRows, plannedRows) {
	if (existingRows.length !== plannedRows.length) {
		throw new StagingSeedError(
			'PARTIAL_SUBSCRIPTION_BATCH',
			'A partial subscription history already exists for the synthetic members.',
		);
	}
	const plannedById = new Map(plannedRows.map((row) => [row.id, row]));
	for (const existing of existingRows) {
		const planned = plannedById.get(existing.id);
		if (
			planned === undefined ||
			!SUBSCRIPTION_FIELDS.every((field) => subscriptionFieldMatches(field, existing, planned))
		) {
			throw new StagingSeedError(
				'SUBSCRIPTION_HISTORY_CONFLICT',
				'Existing subscription history differs from the deterministic staging dataset.',
			);
		}
	}
}

export function makeSubscriptionSummary(result, members, histories) {
	const countsByPlan = Object.fromEntries(EXPECTED_PLAN_NAMES.map((planName) => [planName, 0]));
	const monthlyDistribution = {};
	const memberIds = new Set();
	let renewalCount = 0;
	let activeCount = 0;
	let expiredCount = 0;
	for (const history of histories) {
		const { data, episode } = history;
		countsByPlan[history.planName] += 1;
		memberIds.add(history.memberId);
		if (episode > 0) renewalCount += 1;
		const month = dateToIso(data.startDate).slice(0, 7);
		monthlyDistribution[month] = (monthlyDistribution[month] ?? 0) + 1;
		if (dateToIso(data.endDate) >= HISTORICAL_CUTOFF) activeCount += 1;
		else expiredCount += 1;
	}
	return {
		database: STAGING_DATABASE_NAME,
		organization: 'KD GYM',
		syntheticMembers: members.length,
		totalNewSubscriptions: result.insertedCount,
		subscriptionCountByPlan: countsByPlan,
		monthlySubscriptionDistribution: Object.fromEntries(
			Object.entries(monthlyDistribution).sort(([left], [right]) => left.localeCompare(right)),
		),
		renewalCount,
		expiredSubscriptionsAsOfCutoff: expiredCount,
		activeSubscriptionsAsOfCutoff: activeCount,
		syntheticMembersWithoutSubscriptions: members.length - memberIds.size,
		transactionResult: result.status,
		totalOrganizationSubscriptions: result.totalSubscriptionCount,
		cutoffDate: HISTORICAL_CUTOFF,
		timezone: HISTORICAL_TIMEZONE,
	};
}

function choosePlan(plans, memberId, episode) {
	let threshold = randomFraction(memberId, 'plan', episode);
	for (const name of EXPECTED_PLAN_NAMES) {
		threshold -= PLAN_WEIGHTS[name];
		if (threshold < 0) return plans.find((plan) => canonicalPlanName(plan) === name);
	}
	return plans.find((plan) => canonicalPlanName(plan) === 'Premium');
}

function choosePeriod(planCategory, memberId, episode) {
	if (planCategory === 'Daily') return { periodUnit: 'DAYS', periodCount: 1 };
	const duration = randomFraction(memberId, 'duration', episode);
	return {
		periodUnit: 'MONTHS',
		periodCount: duration < 0.73 ? 1 : duration < 0.94 ? 3 : 6,
	};
}

function assertPlanSet(plans) {
	const planCategories = plans.map((plan) => canonicalPlanName(plan));
	if (
		plans.length !== EXPECTED_PLAN_NAMES.length ||
		new Set(planCategories).size !== EXPECTED_PLAN_NAMES.length ||
		!EXPECTED_PLAN_NAMES.every((name) => planCategories.includes(name)) ||
		plans.some(
			({ id, priceRwf }) => typeof id !== 'string' || typeof priceRwf !== 'bigint' || priceRwf < 0n,
		)
	) {
		throw new StagingSeedError(
			'MEMBERSHIP_PLANS_INVALID',
			"KD GYM must have exactly one active plan for each expected name, with or without the 'Plan' suffix.",
		);
	}
}

function canonicalPlanName(plan) {
	const fromName = normalizePlanLabel(plan.name);
	const fromNormalizedName = normalizePlanLabel(plan.normalizedName);
	if (
		fromName !== undefined &&
		fromNormalizedName !== undefined &&
		fromName !== fromNormalizedName
	) {
		return undefined;
	}
	return fromNormalizedName ?? fromName;
}

function normalizePlanLabel(value) {
	if (typeof value !== 'string') return undefined;
	const normalized = value.trim().toLowerCase().replace(/\s+/gu, ' ');
	const withoutPlanSuffix = normalized.endsWith(' plan') ? normalized.slice(0, -5) : normalized;
	return EXPECTED_PLAN_NAMES.find((name) => name.toLowerCase() === withoutPlanSuffix);
}

function assertSyntheticMember(member) {
	if (
		member.organizationId !== KD_GYM_ORGANIZATION_ID ||
		(member.isSynthetic ?? member.synthetic) !== true ||
		(member.syntheticBatchId ?? member.generationBatch) !== EXPECTED_GENERATION_SEED ||
		typeof member.id !== 'string' ||
		typeof member.name !== 'string' ||
		typeof member.normalizedName !== 'string' ||
		typeof member.phoneNumber !== 'string'
	) {
		throw new StagingSeedError(
			'SYNTHETIC_MEMBER_BATCH_INVALID',
			'Only KD GYM members from the validated synthetic batch may receive subscriptions.',
		);
	}
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
				'SUBSCRIPTION_SCHEMA_MISSING',
				'Required KD GYM subscription tables or columns are missing.',
			);
		}
	}
	const constraints = await transaction.$queryRaw`
		SELECT conname FROM pg_constraint
		WHERE conrelid = 'public.organization_member_subscriptions'::regclass
			AND conname = 'member_subscriptions_no_overlap'
			AND contype = 'x' AND convalidated = true
	`;
	if (constraints.length !== 1) {
		throw new StagingSeedError(
			'SUBSCRIPTION_OVERLAP_CONSTRAINT_MISSING',
			'The subscription non-overlap database constraint is missing or unvalidated.',
		);
	}
}

const SUBSCRIPTION_FIELDS = Object.freeze([
	'organizationId',
	'memberId',
	'membershipPlanId',
	'planName',
	'priceRwf',
	'periodUnit',
	'periodCount',
	'startDate',
	'endDate',
	'idempotencyKey',
	'requestFingerprint',
	'createdByUserId',
	'cancelledAt',
	'cancelledByUserId',
]);

function subscriptionFieldMatches(field, actual, expected) {
	const actualValue = actual[field];
	const expectedValue = expected[field];
	if (actualValue instanceof Date && expectedValue instanceof Date) {
		return actualValue.getTime() === expectedValue.getTime();
	}
	return actualValue === expectedValue;
}

function randomFraction(memberId, purpose, episode) {
	const digest = createHash('sha256')
		.update(`${SUBSCRIPTION_GENERATION_SEED}\u001f${memberId}\u001f${purpose}\u001f${episode}`)
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

function normalizeDate(value) {
	if (value instanceof Date) return dateToIso(value);
	if (typeof value !== 'string') {
		throw new StagingSeedError(
			'SUBSCRIPTION_DATE_INVALID',
			'A fixture date is missing or invalid.',
		);
	}
	dateFromIso(value);
	return value;
}

function dateFromIso(value) {
	const date = new Date(`${value}T00:00:00.000Z`);
	if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
		throw new StagingSeedError(
			'SUBSCRIPTION_DATE_INVALID',
			'A fixture date is missing or invalid.',
		);
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

let writesMayHaveStarted = false;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		const knownError = error instanceof StagingSeedError;
		process.stderr.write(
			`${JSON.stringify({
				seeder: 'kd-gym-staging-subscription-seed',
				failed: true,
				code: knownError ? error.code : 'STAGING_SUBSCRIPTION_SEED_FAILED',
				writesMayHaveCommitted: writesMayHaveStarted,
				message: knownError
					? error.message
					: 'KD GYM subscription seeding failed; inspect staging state before retrying.',
			})}\n`,
		);
		process.exitCode = 2;
	});
}

async function main() {
	if (process.argv.length !== 3 || process.argv[2] !== '--apply') {
		throw new StagingSeedError(
			'SUBSCRIPTION_APPLY_FLAG_REQUIRED',
			'Supply the explicit --apply option for the staging subscription seed.',
		);
	}
	assertStagingDatabaseConfiguration(process.env.DATABASE_URL);
	const fixture = loadStagingFixtures();
	const { NestFactory } = await import('@nestjs/core');
	const { DatabaseModule, PrismaService, loadDatabaseConfig } = await import('@nexcoderw/gym-db');
	const databaseConfig = loadDatabaseConfig({
		DATABASE_URL: process.env.DATABASE_URL,
		DATABASE_POOL_MAX: '1',
	});
	const application = await NestFactory.createApplicationContext(
		DatabaseModule.forRoot(databaseConfig),
		{ logger: false },
	);
	let result;
	try {
		result = await seedStagingSubscriptions(
			application.get(PrismaService),
			fixture.members,
			new Date(),
			() => {
				writesMayHaveStarted = true;
			},
		);
		process.stdout.write(
			`${JSON.stringify(
				makeSubscriptionSummary(result, fixture.members, result.histories),
				null,
				2,
			)}\n`,
		);
	} finally {
		await application.close();
	}
}
