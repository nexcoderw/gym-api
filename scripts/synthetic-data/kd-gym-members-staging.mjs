import {
	EXPECTED_BASELINE_MEMBER_COUNT,
	EXPECTED_FINAL_MEMBER_COUNT,
	EXPECTED_GENERATION_SEED,
	EXPECTED_RECORD_COUNT,
	KD_GYM_ORGANIZATION_ID,
	validateFixtureFiles,
} from './kd-gym-members-preflight.mjs';
import { buildMemberInsertData, runSerializableImportTransaction } from './kd-gym-members-import.mjs';

const REQUIRED_COLUMNS = Object.freeze({
	organizations: ['id', 'name'],
	organization_members: [
		'id',
		'organization_id',
		'name',
		'normalized_name',
		'phone_number',
		'email',
		'joined_on',
		'gender',
		'is_synthetic',
		'synthetic_batch_id',
		'reminder_email_suppressed_at',
		'reminder_email_suppression_reason',
		'reminder_sms_suppressed_at',
		'reminder_sms_suppression_reason',
		'created_at',
		'updated_at',
	],
});

const MEMBER_SELECT = Object.freeze({
	id: true,
	organizationId: true,
	name: true,
	normalizedName: true,
	phoneNumber: true,
	email: true,
	gender: true,
	joinedOn: true,
	isSynthetic: true,
	syntheticBatchId: true,
	createdAt: true,
	updatedAt: true,
	reminderEmailSuppressedAt: true,
	reminderEmailSuppressionReason: true,
	reminderSmsSuppressedAt: true,
	reminderSmsSuppressionReason: true,
});

export function loadStagingFixtures(directory) {
	const fixture = validateFixtureFiles(directory);
	if (!fixture.report.valid || fixture.members.length !== EXPECTED_RECORD_COUNT) {
		throw new Error('The validated KD GYM member fixtures are unavailable or invalid.');
	}
	return fixture;
}

/** Inserts the complete fixture batch in one serializable transaction, or reports an exact rerun. */
export async function seedStagingMembers(prisma, members, insertedAt = new Date()) {
	if (!Array.isArray(members) || members.length !== EXPECTED_RECORD_COUNT) {
		throw new Error('The KD GYM staging seed requires exactly 823 validated fixture members.');
	}
	return runSerializableImportTransaction(prisma, async (transaction) => {
		await assertRequiredSchema(transaction);
		const organization = await transaction.organization.findUnique({
			where: { id: KD_GYM_ORGANIZATION_ID },
			select: { id: true, name: true },
		});
		if (organization?.name !== 'KD GYM') {
			throw new Error('The expected KD GYM organization was not found.');
		}

		const existingCount = await transaction.organizationMember.count({
			where: { organizationId: KD_GYM_ORGANIZATION_ID },
		});
		const existingRealMemberCount = await transaction.organizationMember.count({
			where: { organizationId: KD_GYM_ORGANIZATION_ID, isSynthetic: false },
		});
		const existingBatch = await transaction.organizationMember.findMany({
			where: {
				organizationId: KD_GYM_ORGANIZATION_ID,
				isSynthetic: true,
				syntheticBatchId: EXPECTED_GENERATION_SEED,
			},
			select: MEMBER_SELECT,
		});

		if (existingBatch.length === EXPECTED_RECORD_COUNT) {
			if (
				existingCount !== EXPECTED_FINAL_MEMBER_COUNT ||
				existingRealMemberCount !== EXPECTED_BASELINE_MEMBER_COUNT
			) {
				throw new Error('The existing synthetic batch has an unexpected organization member total.');
			}
			assertBatchMatchesFixtures(existingBatch, members);
			return { status: 'ALREADY_SEEDED', insertedCount: 0, totalCount: existingCount };
		}
		if (existingBatch.length !== 0) {
			throw new Error('A partial or unexpected synthetic batch exists; refusing to continue.');
		}
		if (
			existingCount !== EXPECTED_BASELINE_MEMBER_COUNT ||
			existingRealMemberCount !== EXPECTED_BASELINE_MEMBER_COUNT
		) {
			throw new Error('The existing KD GYM member baseline changed; refusing to continue.');
		}

		const collisions = await transaction.organizationMember.findMany({
			where: {
				organizationId: KD_GYM_ORGANIZATION_ID,
				OR: [
					{ id: { in: members.map(({ id }) => id) } },
					{ normalizedName: { in: members.map(({ normalizedName }) => normalizedName) } },
					{ phoneNumber: { in: members.map(({ phoneNumber }) => phoneNumber) } },
				],
			},
			select: { id: true },
		});
		if (collisions.length !== 0) {
			throw new Error('A member ID, normalized name, or phone collision exists; refusing to continue.');
		}

		const insertion = await transaction.organizationMember.createMany({
			data: buildMemberInsertData(members, insertedAt),
			skipDuplicates: false,
		});
		if (insertion.count !== EXPECTED_RECORD_COUNT) {
			throw new Error('The full synthetic member batch was not inserted; rolling back.');
		}
		const insertedMembers = await transaction.organizationMember.findMany({
			where: {
				organizationId: KD_GYM_ORGANIZATION_ID,
				id: { in: members.map(({ id }) => id) },
			},
			select: MEMBER_SELECT,
		});
		assertBatchMatchesFixtures(insertedMembers, members, insertedAt);
		const totalCount = await transaction.organizationMember.count({
			where: { organizationId: KD_GYM_ORGANIZATION_ID },
		});
		if (totalCount !== EXPECTED_FINAL_MEMBER_COUNT) {
			throw new Error('The final KD GYM member total is unexpected; rolling back.');
		}
		return { status: 'INSERTED', insertedCount: insertion.count, totalCount };
	});
}

export function assertBatchMatchesFixtures(rows, members, insertedAt) {
	if (rows.length !== EXPECTED_RECORD_COUNT || members.length !== EXPECTED_RECORD_COUNT) {
		throw new Error('The synthetic batch does not contain exactly 823 members.');
	}
	const expectedById = new Map(members.map((member) => [member.id, member]));
	const seenIds = new Set();
	for (const row of rows) {
		const fixture = expectedById.get(row.id);
		if (
			fixture === undefined ||
			seenIds.has(row.id) ||
			row.organizationId !== KD_GYM_ORGANIZATION_ID ||
			row.name !== fixture.name ||
			row.normalizedName !== fixture.normalizedName ||
			row.phoneNumber !== fixture.phoneNumber ||
			row.email !== null ||
			row.gender !== fixture.gender ||
			row.joinedOn?.toISOString().slice(0, 10) !== fixture.joinedOn ||
			row.isSynthetic !== true ||
			row.syntheticBatchId !== EXPECTED_GENERATION_SEED ||
			row.reminderEmailSuppressedAt == null ||
			row.reminderEmailSuppressionReason !== 'MANUAL' ||
			row.reminderSmsSuppressedAt == null ||
			row.reminderSmsSuppressionReason !== 'MANUAL' ||
			(insertedAt !== undefined &&
				(row.createdAt?.getTime() !== insertedAt.getTime() ||
					row.updatedAt?.getTime() !== insertedAt.getTime()))
		) {
			throw new Error('Stored synthetic members do not match the validated fixture batch.');
		}
		seenIds.add(row.id);
	}
}

export function makeStagingSummary(result, members) {
	const dates = members.map(({ joinedOn }) => joinedOn).sort();
	return {
		database: 'neondb',
		organization: 'KD GYM',
		existingMembersPreserved: EXPECTED_BASELINE_MEMBER_COUNT,
		syntheticMembersInserted: result.insertedCount,
		totalMembers: result.totalCount,
		maleSyntheticMembers: members.filter(({ gender }) => gender === 'MALE').length,
		femaleSyntheticMembers: members.filter(({ gender }) => gender === 'FEMALE').length,
		earliestJoiningDate: dates[0],
		latestJoiningDate: dates.at(-1),
		transactionStatus: result.status,
	};
}

async function assertRequiredSchema(transaction) {
	const rows = await transaction.$queryRaw`
		SELECT table_name, column_name
		FROM information_schema.columns
		WHERE table_schema = current_schema()
			AND table_name IN ('organizations', 'organization_members')
	`;
	const available = new Map();
	for (const { table_name: tableName, column_name: columnName } of rows) {
		if (!available.has(tableName)) available.set(tableName, new Set());
		available.get(tableName).add(columnName);
	}
	for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
		if (!columns.every((column) => available.get(tableName)?.has(column))) {
			throw new Error('Required KD GYM member tables or columns are missing.');
		}
	}
}
