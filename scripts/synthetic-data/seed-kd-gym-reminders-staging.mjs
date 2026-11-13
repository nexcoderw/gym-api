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

export const REMINDER_GENERATION_SEED = 'kd-gym-reminders-2026-11-12-v1';
export const HISTORICAL_START = '2025-10-18';
export const REMINDER_KINDS = Object.freeze(['THREE_DAYS_BEFORE', 'EXPIRY_DAY']);
export const REMINDER_CHANNEL = 'SMS';
export const SYNTHETIC_SUPPRESSION_CODE = 'SYNTHETIC_MEMBER_SUPPRESSED';

const UUID_NAMESPACE = Buffer.from('165c807769f74dff9b30aa5a5f8992fd', 'hex');
const INSERT_CHUNK_SIZE = 200;
const EXPECTED_COLUMNS = Object.freeze({
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
});

const REMINDER_SELECT = Object.freeze({
	id: true,
	organizationId: true,
	memberId: true,
	memberSubscriptionId: true,
	kind: true,
	channel: true,
	status: true,
	dueDate: true,
	recipientEmail: true,
	messageSubject: true,
	messageBody: true,
	attemptCount: true,
	nextAttemptAt: true,
	leaseExpiresAt: true,
	providerIdempotencyKey: true,
	providerMessageId: true,
	lastErrorCode: true,
	acceptedAt: true,
	deliveredAt: true,
	createdAt: true,
	updatedAt: true,
});

/** Selects historical occasions by subscription expiry; deterministic across reruns. */
export function generateHistoricalReminders(subscriptions, insertedAt) {
	const planned = [];
	for (const subscription of subscriptions) {
		assertSyntheticSubscription(subscription);
		const expiryDate = normalizeDate(subscription.endDate);
		for (const kind of REMINDER_KINDS) {
			if (!occasionSelected(subscription.id, kind)) continue;
			const dueDate = kind === 'EXPIRY_DAY' ? expiryDate : addDays(expiryDate, -3);
			const startDate = normalizeDate(subscription.startDate);
			const joinedOn = normalizeDate(subscription.member.joinedOn);
			if (
				dueDate < HISTORICAL_START ||
				dueDate > HISTORICAL_CUTOFF ||
				dueDate < startDate ||
				dueDate < joinedOn
			) {
				continue;
			}
			const identity = `${REMINDER_GENERATION_SEED}:${subscription.id}:${kind}:${REMINDER_CHANNEL}`;
			planned.push({
				id: deterministicUuid(`${identity}:id`),
				organizationId: KD_GYM_ORGANIZATION_ID,
				memberId: subscription.memberId,
				memberSubscriptionId: subscription.id,
				kind,
				channel: REMINDER_CHANNEL,
				status: 'SKIPPED',
				dueDate: dateFromIso(dueDate),
				recipientEmail: null,
				messageSubject: null,
				messageBody: null,
				attemptCount: 0,
				nextAttemptAt: null,
				leaseExpiresAt: null,
				providerIdempotencyKey: createHash('sha256').update(`${identity}:provider`).digest('hex'),
				providerMessageId: null,
				lastErrorCode: SYNTHETIC_SUPPRESSION_CODE,
				acceptedAt: null,
				deliveredAt: null,
				createdAt: insertedAt,
				updatedAt: insertedAt,
			});
		}
	}
	return planned;
}

export function assertReminderBatchMatches(actual, expected) {
	if (actual.length !== expected.length) {
		throw new StagingSeedError(
			'REMINDER_BATCH_MISMATCH',
			'Existing KD GYM reminder rows do not match the complete deterministic synthetic batch.',
		);
	}
	const actualById = new Map(actual.map((row) => [row.id, row]));
	for (const fixture of expected) {
		const stored = actualById.get(fixture.id);
		if (stored === undefined || !fieldsMatch(stored, fixture, Object.keys(REMINDER_SELECT))) {
			throw new StagingSeedError(
				'REMINDER_BATCH_MISMATCH',
				'Existing KD GYM reminder rows do not match the complete deterministic synthetic batch.',
			);
		}
	}
}

export function makeReminderSummary(result, subscriptions, storedReminders) {
	const byMonth = makeMonthRange();
	const byKind = { THREE_DAYS_BEFORE: 0, EXPIRY_DAY: 0 };
	for (const reminder of storedReminders) {
		const date = normalizeDate(reminder.dueDate);
		const month = date.slice(0, 7);
		byMonth[month] = (byMonth[month] ?? 0) + 1;
		if (reminder.kind in byKind) byKind[reminder.kind] += 1;
	}
	const eligibleSubscriptionIds = new Set(result.eligibleSubscriptionIds);
	return {
		database: STAGING_DATABASE_NAME,
		organization: 'KD GYM',
		syntheticSubscriptionsExamined: subscriptions.length,
		eligibleSubscriptions: eligibleSubscriptionIds.size,
		remindersInserted: result.insertedCount,
		threeDaysBeforeReminders: byKind.THREE_DAYS_BEFORE,
		expiryDayReminders: byKind.EXPIRY_DAY,
		skippedReminders: storedReminders.filter(({ status }) => status === 'SKIPPED').length,
		emailChannelReminders: storedReminders.filter(({ channel }) => channel === 'EMAIL').length,
		smsChannelReminders: storedReminders.filter(({ channel }) => channel === 'SMS').length,
		providerSendsPerformed: 0,
		monthlyReminderDistribution: byMonth,
		originalReminderRecordsPreserved: result.originalReminderCount,
		totalOrganizationReminders: result.totalOrganizationReminders,
		transactionStatus: result.status,
		timezone: HISTORICAL_TIMEZONE,
	};
}

export async function seedStagingReminders(
	prisma,
	insertedAt = new Date(),
	onWriteStart = () => {},
) {
	return runSerializableImportTransaction(
		prisma,
		async (transaction) => {
			await assertRequiredSchema(transaction);
			const [{ databaseName }] =
				await transaction.$queryRaw`SELECT current_database() AS "databaseName"`;
			if (databaseName !== STAGING_DATABASE_NAME) {
				throw new StagingSeedError(
					'REMINDER_DATABASE_IDENTITY_INVALID',
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
			const members = await transaction.organizationMember.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					isSynthetic: true,
					syntheticBatchId: EXPECTED_GENERATION_SEED,
				},
				select: { id: true },
			});
			if (members.length !== 823) {
				throw new StagingSeedError(
					'SYNTHETIC_MEMBER_BATCH_INVALID',
					'The exact 823-member KD GYM synthetic batch is required.',
				);
			}
			const memberIds = members.map(({ id }) => id);
			const subscriptions = await transaction.organizationMemberSubscription.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					memberId: { in: memberIds },
					member: {
						is: {
							organizationId: KD_GYM_ORGANIZATION_ID,
							isSynthetic: true,
							syntheticBatchId: EXPECTED_GENERATION_SEED,
						},
					},
				},
				select: {
					id: true,
					organizationId: true,
					memberId: true,
					startDate: true,
					endDate: true,
					cancelledAt: true,
					member: {
						select: {
							id: true,
							organizationId: true,
							isSynthetic: true,
							syntheticBatchId: true,
							joinedOn: true,
							email: true,
							reminderEmailSuppressedAt: true,
							reminderEmailSuppressionReason: true,
							reminderSmsSuppressedAt: true,
							reminderSmsSuppressionReason: true,
						},
					},
				},
				orderBy: [{ memberId: 'asc' }, { startDate: 'asc' }, { id: 'asc' }],
			});
			if (subscriptions.length === 0) {
				throw new StagingSeedError(
					'SYNTHETIC_SUBSCRIPTIONS_MISSING',
					'No subscriptions exist for the KD GYM synthetic member batch.',
				);
			}
			for (const subscription of subscriptions) assertSyntheticSubscription(subscription);
			const activeSubscriptions = subscriptions.filter(({ cancelledAt }) => cancelledAt === null);
			const planned = generateHistoricalReminders(activeSubscriptions, insertedAt);
			const subscriptionIds = subscriptions.map(({ id }) => id);
			const totalBefore = await transaction.organizationMemberReminderDelivery.count({
				where: { organizationId: KD_GYM_ORGANIZATION_ID },
			});
			const existing = await transaction.organizationMemberReminderDelivery.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					memberSubscriptionId: { in: subscriptionIds },
					kind: { in: REMINDER_KINDS },
					channel: REMINDER_CHANNEL,
				},
				select: REMINDER_SELECT,
				orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
			});
			const originalReminderCount = await transaction.organizationMemberReminderDelivery.count({
				where: { organizationId: KD_GYM_ORGANIZATION_ID, member: { is: { isSynthetic: false } } },
			});
			const eligibleSubscriptionIds = [
				...new Set(planned.map(({ memberSubscriptionId }) => memberSubscriptionId)),
			];
			if (existing.length > 0 || planned.length === 0) {
				assertReminderBatchMatches(existing, planned);
				return {
					status: 'ALREADY_SEEDED',
					insertedCount: 0,
					originalReminderCount,
					totalOrganizationReminders: totalBefore,
					eligibleSubscriptionIds,
					subscriptions,
					storedReminders: existing,
				};
			}
			const collisions = await transaction.organizationMemberReminderDelivery.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					OR: [
						{ id: { in: planned.map(({ id }) => id) } },
						{
							providerIdempotencyKey: {
								in: planned.map(({ providerIdempotencyKey }) => providerIdempotencyKey),
							},
						},
					],
				},
				select: { id: true },
			});
			if (collisions.length > 0)
				throw new StagingSeedError(
					'REMINDER_IDENTITY_COLLISION',
					'A deterministic reminder identity already exists in KD GYM.',
				);
			if (planned.length > 0) onWriteStart();
			const insertedCount = await createInChunks(
				transaction.organizationMemberReminderDelivery,
				planned,
			);
			if (insertedCount !== planned.length)
				throw new StagingSeedError(
					'REMINDER_INSERT_COUNT_MISMATCH',
					'The full deterministic reminder batch was not inserted; transaction rolled back.',
				);
			const storedReminders = await transaction.organizationMemberReminderDelivery.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					memberSubscriptionId: { in: subscriptionIds },
					kind: { in: REMINDER_KINDS },
					channel: REMINDER_CHANNEL,
				},
				select: REMINDER_SELECT,
				orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
			});
			assertReminderBatchMatches(storedReminders, planned);
			const totalOrganizationReminders = await transaction.organizationMemberReminderDelivery.count(
				{ where: { organizationId: KD_GYM_ORGANIZATION_ID } },
			);
			if (totalOrganizationReminders !== totalBefore + insertedCount)
				throw new StagingSeedError(
					'REMINDER_TOTAL_MISMATCH',
					'The organization reminder total changed unexpectedly; transaction rolled back.',
				);
			return {
				status: 'INSERTED',
				insertedCount,
				originalReminderCount,
				totalOrganizationReminders,
				eligibleSubscriptionIds,
				subscriptions,
				storedReminders,
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
		member?.email !== null ||
		member?.reminderEmailSuppressedAt == null ||
		member?.reminderEmailSuppressionReason !== 'MANUAL' ||
		member?.reminderSmsSuppressedAt == null ||
		member?.reminderSmsSuppressionReason !== 'MANUAL'
	)
		throw new StagingSeedError(
			'SYNTHETIC_SUBSCRIPTION_INVALID',
			'Only email-less, suppressed subscriptions for the exact KD GYM synthetic batch can receive historical skipped reminders.',
		);
	const joinedOn = normalizeDate(member.joinedOn);
	const startDate = normalizeDate(subscription.startDate);
	const endDate = normalizeDate(subscription.endDate);
	if (
		joinedOn < HISTORICAL_START ||
		joinedOn > HISTORICAL_CUTOFF ||
		startDate < joinedOn ||
		startDate > HISTORICAL_CUTOFF ||
		endDate < startDate
	) {
		throw new StagingSeedError(
			'SUBSCRIPTION_DATE_INVALID',
			'A synthetic subscription date is outside its member history.',
		);
	}
}

function occasionSelected(subscriptionId, kind) {
	const digest = createHash('sha256')
		.update(`${REMINDER_GENERATION_SEED}\u001f${subscriptionId}\u001f${kind}`)
		.digest();
	return digest.readUInt32BE(0) / 0x1_0000_0000 < (kind === 'EXPIRY_DAY' ? 0.72 : 0.48);
}

function makeMonthRange() {
	const result = {};
	const cursor = dateFromIso(HISTORICAL_START);
	const end = dateFromIso(HISTORICAL_CUTOFF);
	while (cursor <= end) {
		result[cursor.toISOString().slice(0, 7)] = 0;
		cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
	}
	return result;
}

function normalizeDate(value) {
	const date = value instanceof Date ? value.toISOString().slice(0, 10) : value;
	dateFromIso(date);
	return date;
}

function dateFromIso(value) {
	const date = new Date(`${value}T00:00:00.000Z`);
	if (typeof value !== 'string' || date.toISOString().slice(0, 10) !== value)
		throw new StagingSeedError('REMINDER_DATE_INVALID', 'A historical reminder date is invalid.');
	return date;
}

function addDays(value, count) {
	const date = dateFromIso(value);
	date.setUTCDate(date.getUTCDate() + count);
	return date.toISOString().slice(0, 10);
}

function deterministicUuid(value) {
	const digest = createHash('sha1').update(UUID_NAMESPACE).update(value).digest();
	digest[6] = (digest[6] & 0x0f) | 0x50;
	digest[8] = (digest[8] & 0x3f) | 0x80;
	const hex = digest.subarray(0, 16).toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fieldsMatch(actual, expected, fields) {
	return fields.every((field) => {
		const left = actual[field];
		const right = expected[field];
		return left instanceof Date && right instanceof Date
			? left.getTime() === right.getTime()
			: left === right;
	});
}

async function createInChunks(model, rows) {
	let count = 0;
	for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
		const result = await model.createMany({
			data: rows.slice(offset, offset + INSERT_CHUNK_SIZE),
			skipDuplicates: false,
		});
		count += result.count;
	}
	return count;
}

async function assertRequiredSchema(transaction) {
	const names = Object.keys(EXPECTED_COLUMNS);
	const columns = await transaction.$queryRaw`
		SELECT table_name, column_name FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = ANY(${names}::text[])
	`;
	const available = new Map();
	for (const { table_name: tableName, column_name: columnName } of columns) {
		if (!available.has(tableName)) available.set(tableName, new Set());
		available.get(tableName).add(columnName);
	}
	for (const [tableName, required] of Object.entries(EXPECTED_COLUMNS)) {
		if (!required.every((column) => available.get(tableName)?.has(column))) {
			throw new StagingSeedError(
				'REMINDER_SCHEMA_MISSING',
				'Required KD GYM reminder tables or columns are missing.',
			);
		}
	}
}

let stage = 'arguments';
let writesMayHaveStarted = false;
let databaseCloseFailed = false;
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).catch((error) => {
		const known = error instanceof StagingSeedError;
		const databaseErrorCode =
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			typeof error.code === 'string' &&
			/^[A-Z]\d{4}$/u.test(error.code)
				? error.code
				: undefined;
		process.stderr.write(
			`${JSON.stringify({ seeder: 'kd-gym-staging-reminder-seed', failed: true, stage, code: known ? error.code : `STAGING_${stage.toUpperCase()}_FAILED`, ...(databaseErrorCode === undefined ? {} : { databaseErrorCode }), writesMayHaveCommitted: writesMayHaveStarted, databaseCloseFailed, message: known ? error.message : 'KD GYM staging reminder seed failed; inspect staging state before retrying.' })}\n`,
		);
		process.exitCode = 2;
	});
}

async function main(arguments_) {
	if (arguments_.length !== 1 || arguments_[0] !== '--apply')
		throw new StagingSeedError(
			'REMINDER_APPLY_FLAG_REQUIRED',
			'Supply the explicit --apply option for the staging reminder seed.',
		);
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
		stage = 'reminder_transaction';
		const result = await seedStagingReminders(application.get(PrismaService), new Date(), () => {
			writesMayHaveStarted = true;
		});
		stage = 'summary';
		process.stdout.write(
			`${JSON.stringify(makeReminderSummary(result, result.subscriptions ?? [], result.storedReminders), null, 2)}\n`,
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
			'The staging reminder operation may have completed; inspect totals before retrying.',
		);
	}
}
