import {
	EXPECTED_BASELINE_MEMBER_COUNT,
	EXPECTED_FINAL_MEMBER_COUNT,
	EXPECTED_GENERATION_SEED,
	EXPECTED_RECORD_COUNT,
	KD_GYM_ORGANIZATION_ID,
	validateFixtureFiles,
} from './kd-gym-members-preflight.mjs';
import {
	buildMemberInsertData,
	runSerializableImportTransaction,
} from './kd-gym-members-import.mjs';

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

export class StagingSeedError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'StagingSeedError';
		this.code = code;
	}
}

export function loadStagingFixtures(directory) {
	const fixture = validateFixtureFiles(directory);
	if (!fixture.report.valid || fixture.members.length !== EXPECTED_RECORD_COUNT) {
		throw new StagingSeedError(
			'FIXTURES_INVALID',
			'The local KD GYM fixture files are missing or failed validation.',
		);
	}
	return fixture;
}

/**
 * Inserts the complete fixture batch in one serializable transaction, or reports an exact rerun.
 */
export async function seedStagingMembers(
	prisma,
	members,
	insertedAt = new Date(),
	onWriteStart = () => {},
	onStage = () => {},
) {
	if (!Array.isArray(members) || members.length !== EXPECTED_RECORD_COUNT) {
		throw new StagingSeedError(
			'FIXTURE_COUNT_INVALID',
			'The KD GYM staging seed requires exactly 823 validated fixture members.',
		);
	}
	const operation = async (transaction) => {
		onStage('schema_check');
		await assertRequiredSchema(transaction);
		onStage('organization_check');
		const organization = await transaction.organization.findUnique({
			where: { id: KD_GYM_ORGANIZATION_ID },
			select: { id: true, name: true },
		});
		if (organization?.name !== 'KD GYM') {
			throw new StagingSeedError(
				'ORGANIZATION_NOT_FOUND',
				'The configured database does not contain the expected KD GYM organization.',
			);
		}

		onStage('baseline_check');
		const existingCount = await transaction.organizationMember.count({
			where: { organizationId: KD_GYM_ORGANIZATION_ID },
		});
		const existingRealMemberCount = await transaction.organizationMember.count({
			where: { organizationId: KD_GYM_ORGANIZATION_ID, isSynthetic: false },
		});
		onStage('batch_check');
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
				throw new StagingSeedError(
					'EXISTING_BATCH_TOTAL_MISMATCH',
					'The existing synthetic batch has an unexpected organization member total.',
				);
			}
			assertBatchMatchesFixtures(existingBatch, members);
			return { status: 'ALREADY_SEEDED', insertedCount: 0, totalCount: existingCount };
		}
		if (existingBatch.length !== 0) {
			throw new StagingSeedError(
				'PARTIAL_SYNTHETIC_BATCH',
				'A partial or unexpected synthetic batch exists; refusing to continue.',
			);
		}
		if (
			existingCount !== EXPECTED_BASELINE_MEMBER_COUNT ||
			existingRealMemberCount !== EXPECTED_BASELINE_MEMBER_COUNT
		) {
			throw new StagingSeedError(
				'MEMBER_BASELINE_MISMATCH',
				'The existing KD GYM member baseline changed; refusing to continue.',
			);
		}

		onStage('collision_check');
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
			throw new StagingSeedError(
				'MEMBER_COLLISION',
				'A member ID, normalized name, or phone collision exists; refusing to continue.',
			);
		}

		onStage('member_write');
		if (typeof onWriteStart === 'function') onWriteStart();
		const insertion = await transaction.organizationMember.createMany({
			data: buildMemberInsertData(members, insertedAt),
			skipDuplicates: false,
		});
		if (insertion.count !== EXPECTED_RECORD_COUNT) {
			throw new StagingSeedError(
				'INSERT_COUNT_MISMATCH',
				'The full synthetic member batch was not inserted; the transaction was rolled back.',
			);
		}
		onStage('member_verification');
		const insertedMembers = await transaction.organizationMember.findMany({
			where: {
				organizationId: KD_GYM_ORGANIZATION_ID,
				id: { in: members.map(({ id }) => id) },
			},
			select: MEMBER_SELECT,
		});
		assertBatchMatchesFixtures(insertedMembers, members, insertedAt);
		onStage('final_count_check');
		const totalCount = await transaction.organizationMember.count({
			where: { organizationId: KD_GYM_ORGANIZATION_ID },
		});
		if (totalCount !== EXPECTED_FINAL_MEMBER_COUNT) {
			throw new StagingSeedError(
				'FINAL_MEMBER_COUNT_MISMATCH',
				'The final KD GYM member total is unexpected; the transaction was rolled back.',
			);
		}
		return { status: 'INSERTED', insertedCount: insertion.count, totalCount };
	};
	return runSerializableImportTransaction(prisma, operation, { maxWait: 30_000 });
}

export function assertBatchMatchesFixtures(rows, members, insertedAt) {
	if (rows.length !== EXPECTED_RECORD_COUNT || members.length !== EXPECTED_RECORD_COUNT) {
		throw new StagingSeedError(
			'BATCH_VERIFICATION_FAILED',
			'The synthetic batch does not contain exactly 823 members.',
		);
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
			throw new StagingSeedError(
				'BATCH_VERIFICATION_FAILED',
				'Stored synthetic members do not match the validated fixture batch.',
			);
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
			throw new StagingSeedError(
				'SCHEMA_REQUIREMENTS_MISSING',
				'Required KD GYM member tables or columns are missing from the configured database.',
			);
		}
	}
}
