import { createHash } from 'node:crypto';
import {
	closeSync,
	constants as fsConstants,
	fstatSync,
	lstatSync,
	openSync,
	readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDataset } from './generate-kd-gym-members.mjs';

export const KD_GYM_ORGANIZATION_ID = 'f6e417be-b93e-40ef-b028-d9d03666e69f';
export const EXPECTED_RECORD_COUNT = 823;
export const EXPECTED_GENDER_COUNTS = Object.freeze({ male: 709, female: 114 });
export const EXPECTED_DATE_RANGE = Object.freeze({
	from: '2025-10-18',
	to: '2026-11-12',
	timezone: 'Africa/Kigali',
});
export const EXPECTED_BASELINE_MEMBER_COUNT = 1;
export const EXPECTED_GENERATION_SEED = 'kd-gym-members-2026-11-12-v1';
export const EXPECTED_FINAL_MEMBER_COUNT = 824;
export const EXPECTED_PRODUCTION_DATABASE_NAME = 'neondb';
export const EXPECTED_PRODUCTION_DATABASE_HOST =
	'ep-rapid-violet-b4txcgks-pooler.c-6.us-east-2.aws.neon.tech';
export const APPLICATION_NOTIFICATION_PROTECTION_VERSION =
	'kd-gym-member-notification-protection-v1';
const PRODUCTION_DATABASE_MARKER_PATTERN =
	/^nexcode-gym:bootstrap:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const EXPECTED_BUSINESS_START_DATE = '2025-10-18';
export const EXPECTED_DATABASE_MIGRATIONS = Object.freeze([
	'20261019202006_add_member_email_reminder_outbox',
	'20261112193052_add_organization_member_gender',
	'20261112212705_add_organization_member_joined_on',
	'20261113005446_add_member_synthetic_identity_and_sms_suppression',
	'20261113015549_enforce_member_synthetic_suppression_checks_forward',
]);
export const PRODUCTION_APPROVAL_DIRECTORY = fileURLToPath(new URL('./private/', import.meta.url));
export const PRODUCTION_APPROVAL_PATH = join(
	PRODUCTION_APPROVAL_DIRECTORY,
	'production-approval.json',
);

export class PreflightConfigurationError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'PreflightConfigurationError';
		this.code = code;
	}
}

const FIXTURE_FIELDS = Object.freeze([
	'id',
	'organizationId',
	'name',
	'normalizedName',
	'phoneNumber',
	'gender',
	'email',
	'joinedOn',
	'synthetic',
	'generationCategory',
	'generationBatch',
]);
const OUTPUT_DIRECTORY = fileURLToPath(new URL('./output/', import.meta.url));
const MONTH_TARGETS = Object.freeze([
	['2025-10', 16, 2, 0],
	['2025-11', 33, 5, 0],
	['2025-12', 38, 6, 0],
	['2026-01', 50, 8, 0],
	['2026-02', 44, 7, 0],
	['2026-03', 54, 9, 0],
	['2026-04', 46, 8, 0],
	['2026-05', 60, 10, 0],
	['2026-06', 52, 9, 0],
	['2026-07', 68, 11, 0],
	['2026-08', 63, 10, 0],
	['2026-09', 74, 12, 0],
	['2026-10', 79, 12, 1],
	['2026-11', 32, 5, 0],
]);

/** Read and validate local fixture files without opening a database connection. */
export function validateFixtureFiles(directory = OUTPUT_DIRECTORY) {
	const checks = Object.create(null);
	let members = [];
	let manifest = null;
	let validationReport = null;
	let validation = { valid: false, errors: [], monthlyGenderBreakdown: [] };
	let csvText = '';
	let jsonlText = '';
	let manifestText = '';
	const failed = (name) => (checks[name] = false);
	const passed = (name) => (checks[name] = true);

	try {
		csvText = readFileSync(join(directory, 'members.csv'), 'utf8');
		jsonlText = readFileSync(join(directory, 'members.jsonl'), 'utf8');
		manifestText = readFileSync(join(directory, 'manifest.json'), 'utf8');
		manifest = JSON.parse(manifestText);
		validationReport = JSON.parse(readFileSync(join(directory, 'validation-report.json'), 'utf8'));
		passed('allExpectedFilesReadable');
	} catch {
		failed('allExpectedFilesReadable');
	}

	if (checks.allExpectedFilesReadable === true) {
		try {
			members = parseJsonLines(jsonlText);
			passed('jsonlParses');
		} catch {
			failed('jsonlParses');
		}
		try {
			const csvRows = parseCsv(csvText);
			checks.csvParses = csvRows.length > 0;
			checks.csvJsonlAgree = checks.csvParses && csvMatchesMembers(csvRows, members);
		} catch {
			failed('csvParses');
			failed('csvJsonlAgree');
		}
	}

	const structureValid = members.length === EXPECTED_RECORD_COUNT && members.every(isFixture);
	checks.requiredFieldsAndTypes = structureValid;
	if (structureValid) {
		try {
			validation = validateDataset(members);
		} catch {
			validation = { valid: false, errors: ['invalid fixture shape'] };
		}
		checks.generatorValidation = validation.valid;
		checks.expectedRecordCount = members.length === EXPECTED_RECORD_COUNT;
		checks.expectedGenderTotals =
			members.filter((member) => member.gender === 'MALE').length === EXPECTED_GENDER_COUNTS.male &&
			members.filter((member) => member.gender === 'FEMALE').length ===
				EXPECTED_GENDER_COUNTS.female;
		checks.expectedOrganization = members.every(
			(member) => member.organizationId === KD_GYM_ORGANIZATION_ID,
		);
		checks.exactDateRange =
			isRecord(manifest) &&
			isRecord(manifest.dateRange) &&
			manifest.dateRange.from === EXPECTED_DATE_RANGE.from &&
			manifest.dateRange.to === EXPECTED_DATE_RANGE.to &&
			manifest.dateRange.timezone === EXPECTED_DATE_RANGE.timezone &&
			members.every(
				(member) =>
					member.joinedOn >= EXPECTED_DATE_RANGE.from && member.joinedOn <= EXPECTED_DATE_RANGE.to,
			);
		checks.validUniqueUuids =
			members.every((member) => isUuid(member.id)) &&
			uniqueCount(members.map(({ id }) => id)) === 0;
		checks.uniqueNormalizedNames =
			uniqueCount(members.map(({ normalizedName }) => normalizedName)) === 0;
		checks.uniquePhones = uniqueCount(members.map(({ phoneNumber }) => phoneNumber)) === 0;
		checks.validPhoneFormats = members.every((member) =>
			/^\+250(?:78|72)\d{7}$/u.test(member.phoneNumber),
		);
		checks.nameComponentCounts = members.every((member) => {
			const count = member.name.trim().split(/[\s\u0085]+/u).length;
			return count >= 2 && count <= 4;
		});
		checks.manifestMatchesDataset =
			isRecord(manifest) &&
			manifest.organizationId === KD_GYM_ORGANIZATION_ID &&
			manifest.generationSeed === EXPECTED_GENERATION_SEED &&
			manifest.recordCount === EXPECTED_RECORD_COUNT &&
			members.every((member) => member.generationBatch === EXPECTED_GENERATION_SEED) &&
			matchesCounts(manifest.namingCategoryCounts, validation.namingCategoryCounts) &&
			matchesCounts(manifest.phonePrefixDistribution, validation.phonePrefixDistribution) &&
			matchesDuplicateCounts(manifest.duplicateCounts, validation.duplicateCounts) &&
			monthlySummariesMatch(manifest.monthlyGenderBreakdown, validation.monthlyGenderBreakdown);
		checks.manifestHashesMatch =
			isRecord(manifest) &&
			isRecord(manifest.sha256) &&
			manifest.sha256['members.csv'] === sha256(csvText) &&
			manifest.sha256['members.jsonl'] === sha256(jsonlText);
		checks.generatorReportPassed =
			isRecord(validationReport) &&
			validationReport.valid === true &&
			validationReport.recordCount === EXPECTED_RECORD_COUNT &&
			isRecord(validationReport.dateRange) &&
			validationReport.dateRange.from === EXPECTED_DATE_RANGE.from &&
			validationReport.dateRange.to === EXPECTED_DATE_RANGE.to &&
			Array.isArray(validationReport.errors) &&
			validationReport.errors.length === 0 &&
			isRecord(validationReport.checks) &&
			Object.keys(validationReport.checks).length > 0 &&
			Object.values(validationReport.checks).every((value) => value === true) &&
			monthlySummariesMatch(
				validationReport.monthlyGenderBreakdown,
				validation.monthlyGenderBreakdown,
			) &&
			matchesCounts(validationReport.namingCategoryCounts, validation.namingCategoryCounts) &&
			matchesCounts(validationReport.phonePrefixDistribution, validation.phonePrefixDistribution) &&
			matchesDuplicateCounts(validationReport.duplicateCounts, validation.duplicateCounts);
		checks.monthlyMaleShareAtLeast85Percent = validation.monthlyGenderBreakdown.every(
			(month) => month.malePercentageIncludingReservedUnknown >= 85,
		);
	} else {
		for (const name of [
			'generatorValidation',
			'expectedRecordCount',
			'expectedGenderTotals',
			'expectedOrganization',
			'exactDateRange',
			'validUniqueUuids',
			'uniqueNormalizedNames',
			'uniquePhones',
			'validPhoneFormats',
			'nameComponentCounts',
			'manifestMatchesDataset',
			'manifestHashesMatch',
			'generatorReportPassed',
			'monthlyMaleShareAtLeast85Percent',
		]) {
			failed(name);
		}
	}

	const monthlyTargets = makeMonthlyTargets(
		isRecord(manifest) ? manifest.monthlyGenderBreakdown : [],
	);
	checks.monthlyTargetsMatchManifest =
		isRecord(manifest) &&
		Array.isArray(manifest.monthlyGenderBreakdown) &&
		manifest.monthlyGenderBreakdown.length === MONTH_TARGETS.length &&
		monthlyTargets.every((month) => month.manifestMatches);
	const report = {
		valid: Object.values(checks).length > 0 && Object.values(checks).every(Boolean),
		recordCount: members.length,
		genderCounts: {
			male: members.filter((member) => member?.gender === 'MALE').length,
			female: members.filter((member) => member?.gender === 'FEMALE').length,
		},
		manifestSha256: manifestText.length === 0 ? null : sha256(manifestText),
		dateRange: EXPECTED_DATE_RANGE,
		monthlyTargets,
		checks,
	};
	return { members, manifest, report };
}

/** Validate explicit database target configuration before any connection is created. */
export function resolveDatabaseTarget(arguments_, environment = process.env) {
	const args = [...arguments_];
	let target;
	let allowProductionReadOnly = false;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === '--allow-production-read-only') {
			allowProductionReadOnly = true;
			continue;
		}
		if (args[index] !== '--database-target') {
			throw new PreflightConfigurationError(
				'PREFLIGHT_OPTION_INVALID',
				'Unknown preflight option.',
			);
		}
		const candidate = args[index + 1];
		if (candidate === undefined || candidate.startsWith('--') || target !== undefined) {
			throw new PreflightConfigurationError(
				'DATABASE_TARGET_REQUIRED',
				'Supply exactly one explicit --database-target value.',
			);
		}
		target = candidate;
		index += 1;
	}
	if (target === undefined) {
		throw new PreflightConfigurationError(
			'DATABASE_TARGET_REQUIRED',
			'Supply an explicit --database-target production value.',
		);
	}
	if (target !== 'production') {
		throw new PreflightConfigurationError(
			'PRODUCTION_TARGET_REQUIRED',
			'This historical import workflow is restricted to the production target.',
		);
	}
	if (environment.PREFLIGHT_DATABASE_TARGET !== 'production') {
		throw new PreflightConfigurationError(
			'DATABASE_TARGET_CONFIRMATION_MISMATCH',
			'Set PREFLIGHT_DATABASE_TARGET=production for this production-only workflow.',
		);
	}
	const databaseMarker = environment.PREFLIGHT_EXPECTED_DATABASE_MARKER;
	if (
		typeof databaseMarker !== 'string' ||
		!PRODUCTION_DATABASE_MARKER_PATTERN.test(databaseMarker)
	) {
		throw new PreflightConfigurationError(
			'PRODUCTION_DATABASE_MARKER_REQUIRED',
			'Use the independently provisioned production database marker; hostnames alone cannot distinguish targets.',
		);
	}
	if (
		typeof environment.PREFLIGHT_DATABASE_URL !== 'string' ||
		environment.PREFLIGHT_DATABASE_URL.trim().length === 0
	) {
		throw new PreflightConfigurationError(
			'PREFLIGHT_DATABASE_URL_REQUIRED',
			'Set a non-empty PREFLIGHT_DATABASE_URL; export KD_GYM_PREFLIGHT_DATABASE_URL first.',
		);
	}
	let connection;
	try {
		connection = new URL(environment.PREFLIGHT_DATABASE_URL);
	} catch {
		throw new PreflightConfigurationError(
			'PREFLIGHT_DATABASE_URL_INVALID',
			'Use a full postgres:// or postgresql:// URL; percent-encode reserved credential characters.',
		);
	}
	if (!['postgres:', 'postgresql:'].includes(connection.protocol)) {
		throw new PreflightConfigurationError(
			'PREFLIGHT_DATABASE_URL_INVALID',
			'PREFLIGHT_DATABASE_URL must use PostgreSQL.',
		);
	}
	let databaseName;
	try {
		databaseName = decodeURIComponent(connection.pathname.slice(1));
	} catch {
		throw new PreflightConfigurationError(
			'PREFLIGHT_DATABASE_URL_INVALID',
			'PREFLIGHT_DATABASE_URL contains an invalid encoded database name.',
		);
	}
	if (
		connection.username.length === 0 ||
		connection.password.length === 0 ||
		databaseName !== EXPECTED_PRODUCTION_DATABASE_NAME ||
		databaseName !== environment.PREFLIGHT_EXPECTED_DATABASE_NAME ||
		connection.hostname.toLowerCase() !== EXPECTED_PRODUCTION_DATABASE_HOST ||
		connection.hostname.toLowerCase() !==
			environment.PREFLIGHT_EXPECTED_DATABASE_HOST?.toLowerCase()
	) {
		throw new PreflightConfigurationError(
			'DATABASE_IDENTITY_EXPECTATION_MISMATCH',
			'Database URL must identify the approved Neon production endpoint and neondb.',
		);
	}
	if (
		!allowProductionReadOnly ||
		environment.PREFLIGHT_PRODUCTION_READ_ONLY_CONFIRMATION !== 'KD-GYM-READ-ONLY-PREFLIGHT'
	) {
		throw new PreflightConfigurationError(
			'PRODUCTION_READ_ONLY_CONFIRMATION_REQUIRED',
			'Production requires the read-only CLI flag and separate confirmation variable.',
		);
	}
	return Object.freeze({
		target,
		databaseUrl: environment.PREFLIGHT_DATABASE_URL,
		databaseName,
		host: connection.hostname,
		databaseMarker,
	});
}

/** Validate the operator's attested production import approval without exposing its contents. */
export function validateProductionApprovalArtifact(value, manifestSha256, databaseMarker) {
	const valid =
		isRecord(value) &&
		value.version === 1 &&
		value.organizationId === KD_GYM_ORGANIZATION_ID &&
		isRecord(value.productionDatabase) &&
		value.productionDatabase.environment === 'production' &&
		value.productionDatabase.host === EXPECTED_PRODUCTION_DATABASE_HOST &&
		value.productionDatabase.name === EXPECTED_PRODUCTION_DATABASE_NAME &&
		value.productionDatabase.marker === databaseMarker &&
		isRecord(value.historicalBusinessStartDateAttestation) &&
		value.historicalBusinessStartDateAttestation.date === EXPECTED_BUSINESS_START_DATE &&
		value.historicalBusinessStartDateAttestation.operatorAttested === true &&
		isNonEmptyText(value.historicalBusinessStartDateAttestation.attestedBy, 160) &&
		isRecord(value.dateRange) &&
		value.dateRange.from === EXPECTED_DATE_RANGE.from &&
		value.dateRange.to === EXPECTED_DATE_RANGE.to &&
		value.dateRange.timezone === EXPECTED_DATE_RANGE.timezone &&
		value.datasetManifestSha256 === manifestSha256 &&
		value.expectedExistingMemberCount === EXPECTED_BASELINE_MEMBER_COUNT &&
		value.expectedGeneratedMemberCount === EXPECTED_RECORD_COUNT &&
		value.expectedFinalMemberCount === EXPECTED_FINAL_MEMBER_COUNT &&
		isRecord(value.generatedGenderCounts) &&
		value.generatedGenderCounts.male === EXPECTED_GENDER_COUNTS.male &&
		value.generatedGenderCounts.female === EXPECTED_GENDER_COUNTS.female &&
		value.authorizationConfirmed === true &&
		isNonEmptyText(value.authorizedBy, 160) &&
		value.syntheticRecordsAcknowledged === true &&
		isRecord(value.productionBackupVerification) &&
		value.productionBackupVerification.verified === true &&
		isNonEmptyText(value.productionBackupVerification.reference, 200) &&
		isNonEmptyText(value.productionBackupVerification.verifiedBy, 160) &&
		isValidTimestamp(value.productionBackupVerification.verifiedAt) &&
		Date.parse(value.productionBackupVerification.verifiedAt) <= Date.now() &&
		isRecord(value.notificationSuppressionVerification) &&
		value.notificationSuppressionVerification.verified === true &&
		value.notificationSuppressionVerification.emailSuppression === true &&
		value.notificationSuppressionVerification.smsSuppression === true &&
		value.notificationSuppressionVerification.applicationProtectionVersion ===
			APPLICATION_NOTIFICATION_PROTECTION_VERSION &&
		isNonEmptyText(value.notificationSuppressionVerification.verifiedBy, 160) &&
		isValidTimestamp(value.notificationSuppressionVerification.verifiedAt) &&
		Date.parse(value.notificationSuppressionVerification.verifiedAt) <= Date.now() &&
		isNonEmptyText(value.approvalReference, 160) &&
		isNonEmptyText(value.operator, 160) &&
		isValidTimestamp(value.approvedAt) &&
		Date.parse(value.approvedAt) <= Date.now();
	if (!valid) {
		throw new PreflightConfigurationError(
			'PRODUCTION_APPROVAL_ARTIFACT_INVALID',
			'The protected approval artifact does not attest to this production target and dataset.',
		);
	}
	return Object.freeze({
		approvalReference: value.approvalReference,
		authorizedBy: value.authorizedBy,
		authorizationConfirmed: true,
		operator: value.operator,
		historicalBusinessStartDate: EXPECTED_BUSINESS_START_DATE,
		approvedAt: value.approvedAt,
		manifestSha256,
		databaseMarker,
		productionBackupVerification: value.productionBackupVerification,
		notificationSuppressionVerification: value.notificationSuppressionVerification,
	});
}

/** Read the fixed local approval artifact only when its directory and file are owner-only. */
export function loadProductionApprovalArtifact(manifestSha256, databaseMarker) {
	return validateProductionApprovalArtifact(
		readProtectedArtifact(PRODUCTION_APPROVAL_PATH, 'approval'),
		manifestSha256,
		databaseMarker,
	);
}

function readProtectedArtifact(path, artifactKind) {
	let directoryMetadata;
	try {
		directoryMetadata = lstatSync(PRODUCTION_APPROVAL_DIRECTORY);
	} catch {
		throw new PreflightConfigurationError(
			`PRODUCTION_${artifactKind.toUpperCase()}_ARTIFACT_UNAVAILABLE`,
			'Create the ignored private artifact directory with owner-only permissions.',
		);
	}
	if (
		!directoryMetadata.isDirectory() ||
		directoryMetadata.isSymbolicLink() ||
		(directoryMetadata.mode & 0o777) !== 0o700
	) {
		throw new PreflightConfigurationError(
			`PRODUCTION_${artifactKind.toUpperCase()}_ARTIFACT_UNPROTECTED`,
			'The ignored private artifact directory must be a real directory with mode 0700.',
		);
	}
	let descriptor;
	try {
		if (typeof fsConstants.O_NOFOLLOW !== 'number') throw new Error('unsupported');
		descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
		const metadata = fstatSync(descriptor);
		if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || metadata.size > 16_384) {
			throw new PreflightConfigurationError(
				`PRODUCTION_${artifactKind.toUpperCase()}_ARTIFACT_UNPROTECTED`,
				'The protected artifact must be a regular file no larger than 16 KiB with mode 0600.',
			);
		}
		const text = readFileSync(descriptor, { encoding: 'utf8' });
		try {
			return JSON.parse(text);
		} catch {
			throw new PreflightConfigurationError(
				`PRODUCTION_${artifactKind.toUpperCase()}_ARTIFACT_INVALID`,
				'The protected artifact must contain valid JSON.',
			);
		}
	} catch (error) {
		if (error instanceof PreflightConfigurationError) throw error;
		throw new PreflightConfigurationError(
			`PRODUCTION_${artifactKind.toUpperCase()}_ARTIFACT_UNAVAILABLE`,
			'Unable to read the protected local artifact; check that it exists and is not a symlink.',
		);
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
	}
}

function isNonEmptyText(value, maximumLength) {
	return (
		typeof value === 'string' &&
		value.trim().length > 0 &&
		value.length <= maximumLength &&
		!/[\r\n\p{Cc}]/u.test(value)
	);
}

function isValidTimestamp(value) {
	return typeof value === 'string' && Number.isFinite(Date.parse(value)) && value.includes('T');
}

/** Read-only production preflight, with no non-production target support. */
export async function inspectDatabase(prisma, target, members, datasetReport, approval) {
	assertInspectionInputs(target, members, datasetReport, approval);
	return prisma.$transaction(
		async (transaction) => {
			await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
			return inspectDatabaseTransaction(transaction, target, members, datasetReport, approval, {
				expectedReadOnly: true,
			});
		},
		{ isolationLevel: 'RepeatableRead', timeout: 30_000 },
	);
}

/** Run the identical checks inside an existing transaction, including APPLY's serializable pass. */
export async function inspectDatabaseTransaction(
	transaction,
	target,
	members,
	datasetReport,
	approval,
	{ expectedReadOnly, lockOrganization = false },
) {
	assertInspectionInputs(target, members, datasetReport, approval);
	const readOnlyState = await transaction.$queryRaw`
		SELECT current_setting('transaction_read_only') AS "readOnly"
	`;
	const actualReadOnly = readOnlyState[0]?.readOnly === 'on';
	if (actualReadOnly !== expectedReadOnly) {
		throw new Error('Database transaction mode did not match the requested preflight mode.');
	}
	await transaction.$queryRaw`
		SELECT set_config('app.current_organization_id', ${KD_GYM_ORGANIZATION_ID}, true)
	`;
	await transaction.$queryRaw`SELECT set_config('app.current_branch_id', '', true)`;
	if (lockOrganization) {
		await transaction.$queryRaw`
			SELECT id FROM public.organizations
			WHERE id = ${KD_GYM_ORGANIZATION_ID}::uuid
			FOR UPDATE
		`;
	}
	const identityRows = await transaction.$queryRaw`
		SELECT current_database() AS "databaseName", inet_server_port() AS "port",
			shobj_description(db_identity.oid, 'pg_database') AS "databaseMarker"
		FROM pg_database AS db_identity
		WHERE db_identity.datname = current_database()
	`;
	const identity = identityRows[0];
	const columns = await transaction.$queryRaw`
		SELECT table_name AS "tableName", column_name AS "columnName"
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name IN ('organizations', 'organization_members')
	`;
	const columnSet = new Set(columns.map((row) => `${row.tableName}.${row.columnName}`));
	const migrationTableRows = await transaction.$queryRaw`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
		) AS "exists"
	`;
	const migrationRows = migrationTableRows[0]?.exists
		? await transaction.$queryRaw`
			SELECT migration_name AS "migrationName"
			FROM public._prisma_migrations
			WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
				AND migration_name IN (
					'20261019202006_add_member_email_reminder_outbox',
					'20261112193052_add_organization_member_gender',
					'20261112212705_add_organization_member_joined_on',
					'20261113005446_add_member_synthetic_identity_and_sms_suppression',
					'20261113015549_enforce_member_synthetic_suppression_checks_forward'
				)
		`
		: [];
	const migrationSet = new Set(migrationRows.map((row) => row.migrationName));
	const manualReasonRows = await transaction.$queryRaw`
		SELECT EXISTS (
			SELECT 1 FROM pg_type AS type
			JOIN pg_enum AS enum ON enum.enumtypid = type.oid
			WHERE type.typname = 'organization_member_email_suppression_reason'
				AND type.typnamespace = 'public'::regnamespace
				AND enum.enumlabel = 'manual'
		) AS "exists"
	`;
	const smsReasonRows = await transaction.$queryRaw`
		SELECT EXISTS (
			SELECT 1 FROM pg_type AS type
			JOIN pg_enum AS enum ON enum.enumtypid = type.oid
			WHERE type.typname = 'organization_member_sms_suppression_reason'
				AND type.typnamespace = 'public'::regnamespace
				AND enum.enumlabel = 'manual'
		) AS "exists"
	`;
	const suppressionConstraintRows = await transaction.$queryRaw`
		SELECT EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conrelid = 'public.organization_members'::regclass
				AND conname = 'members_reminder_suppression_pair_check'
				AND contype = 'c'
				AND convalidated
		) AS "exists"
	`;
	const syntheticConstraintRows = await transaction.$queryRaw`
		SELECT conname AS "name", contype AS "type", convalidated AS "validated",
			pg_get_constraintdef(oid) AS "definition"
		FROM pg_constraint
		WHERE conrelid = 'public.organization_members'::regclass
			AND conname IN (
				'organization_members_sms_suppression_pair_check',
				'organization_members_synthetic_protection_check'
			)
	`;
	const smsPairConstraintVerified = isVerifiedConstraint(
		syntheticConstraintRows,
		'organization_members_sms_suppression_pair_check',
		['reminder_sms_suppressed_at IS NULL', 'reminder_sms_suppression_reason IS NULL', '='],
	);
	const syntheticProtectionConstraintVerified = isVerifiedConstraint(
		syntheticConstraintRows,
		'organization_members_synthetic_protection_check',
		[
			'is_synthetic = false',
			'synthetic_batch_id IS NULL',
			'is_synthetic = true',
			'synthetic_batch_id IS NOT NULL',
			'length(btrim(synthetic_batch_id)) BETWEEN 1 AND 120',
			'email IS NULL',
			'reminder_email_suppressed_at IS NOT NULL',
			'reminder_email_suppression_reason IS NOT NULL',
			'reminder_sms_suppressed_at IS NOT NULL',
			'reminder_sms_suppression_reason IS NOT NULL',
		],
	);
	const schemaChecks = {
		organizationTable: columnSet.has('organizations.id'),
		memberTable: columnSet.has('organization_members.id'),
		memberOrganizationIdColumn: columnSet.has('organization_members.organization_id'),
		nameColumn: columnSet.has('organization_members.name'),
		normalizedNameColumn: columnSet.has('organization_members.normalized_name'),
		phoneNumberColumn: columnSet.has('organization_members.phone_number'),
		emailColumn: columnSet.has('organization_members.email'),
		memberCreatedAtColumn: columnSet.has('organization_members.created_at'),
		memberUpdatedAtColumn: columnSet.has('organization_members.updated_at'),
		joinedOnColumn: columnSet.has('organization_members.joined_on'),
		genderColumn: columnSet.has('organization_members.gender'),
		reminderEmailSuppressedAtColumn: columnSet.has(
			'organization_members.reminder_email_suppressed_at',
		),
		reminderEmailSuppressionReasonColumn: columnSet.has(
			'organization_members.reminder_email_suppression_reason',
		),
		isSyntheticColumn: columnSet.has('organization_members.is_synthetic'),
		syntheticBatchIdColumn: columnSet.has('organization_members.synthetic_batch_id'),
		reminderSmsSuppressedAtColumn: columnSet.has('organization_members.reminder_sms_suppressed_at'),
		reminderSmsSuppressionReasonColumn: columnSet.has(
			'organization_members.reminder_sms_suppression_reason',
		),
		manualSuppressionReasonAvailable: manualReasonRows[0]?.exists === true,
		smsSuppressionReasonAvailable: smsReasonRows[0]?.exists === true,
		suppressionPairConstraintAvailable: suppressionConstraintRows[0]?.exists === true,
		smsSuppressionPairConstraintVerified: smsPairConstraintVerified,
		syntheticProtectionConstraintVerified,
		migrationHistoryAvailable: migrationTableRows[0]?.exists === true,
		suppressionMigrationApplied: migrationSet.has(EXPECTED_DATABASE_MIGRATIONS[0]),
		genderMigrationApplied: migrationSet.has(EXPECTED_DATABASE_MIGRATIONS[1]),
		joinedOnMigrationApplied: migrationSet.has(EXPECTED_DATABASE_MIGRATIONS[2]),
		syntheticIdentityMigrationApplied: migrationSet.has(EXPECTED_DATABASE_MIGRATIONS[3]),
		syntheticProtectionMigrationApplied: migrationSet.has(EXPECTED_DATABASE_MIGRATIONS[4]),
	};
	const blockers = Object.entries(schemaChecks)
		.filter(([, passed]) => !passed)
		.map(([name]) => `SCHEMA_${name.replace(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase()}`);
	const applicationNotificationSafeguardsVerified =
		approval.notificationSuppressionVerification?.applicationProtectionVersion ===
		APPLICATION_NOTIFICATION_PROTECTION_VERSION;
	if (!applicationNotificationSafeguardsVerified) {
		blockers.push('APPLICATION_NOTIFICATION_SAFEGUARDS_UNVERIFIED');
	}
	const report = {
		performed: true,
		target: target.target,
		databaseIdentity: {
			databaseName: identity?.databaseName ?? null,
			host: target.host,
			port: identity?.port ?? null,
		},
		databaseMarkerMatchesExpected: identity?.databaseMarker === target.databaseMarker,
		databaseIdentityMatchesExpected:
			target.target === 'production' &&
			target.host === EXPECTED_PRODUCTION_DATABASE_HOST &&
			target.databaseName === EXPECTED_PRODUCTION_DATABASE_NAME &&
			identity?.databaseName === EXPECTED_PRODUCTION_DATABASE_NAME &&
			identity?.databaseMarker === target.databaseMarker,
		organizationId: KD_GYM_ORGANIZATION_ID,
		organizationExists: null,
		organizationBusinessStartDate: approval.historicalBusinessStartDate,
		businessStartDateAttestationVerified: true,
		approvalReference: approval.approvalReference,
		approvalOperator: approval.operator,
		applicationNotificationSafeguardsVerified,
		datasetManifestSha256: datasetReport.manifestSha256,
		existingMemberCount: null,
		generatedMemberCount: datasetReport.recordCount,
		expectedTotalMemberCount: EXPECTED_FINAL_MEMBER_COUNT,
		expectedFinalCountMatches: false,
		schemaChecks,
		genderCounts: null,
		monthlyRegistrationCounts: null,
		collisions: {
			memberId: null,
			normalizedName: null,
			phoneNumber: null,
			matchingAnyFixture: null,
		},
		blockers,
		safeToProceedToSeparatelyApprovedImport: false,
	};
	if (!report.databaseIdentityMatchesExpected) report.blockers.push('DATABASE_IDENTITY_MISMATCH');
	if (!report.databaseMarkerMatchesExpected) {
		report.blockers.push('PRODUCTION_DATABASE_MARKER_MISMATCH');
	}
	if (schemaChecks.organizationTable) {
		const organizationRows = await transaction.$queryRaw`
			SELECT id FROM public.organizations
			WHERE id = ${KD_GYM_ORGANIZATION_ID}::uuid
		`;
		report.organizationExists = organizationRows.length === 1;
	}
	if (report.organizationExists !== true) report.blockers.push('ORGANIZATION_NOT_FOUND');
	const memberSchemaReady =
		schemaChecks.memberTable &&
		schemaChecks.memberOrganizationIdColumn &&
		schemaChecks.nameColumn &&
		schemaChecks.normalizedNameColumn &&
		schemaChecks.phoneNumberColumn &&
		schemaChecks.emailColumn &&
		schemaChecks.memberCreatedAtColumn &&
		schemaChecks.memberUpdatedAtColumn &&
		schemaChecks.joinedOnColumn &&
		schemaChecks.genderColumn &&
		schemaChecks.reminderEmailSuppressedAtColumn &&
		schemaChecks.reminderEmailSuppressionReasonColumn &&
		schemaChecks.isSyntheticColumn &&
		schemaChecks.syntheticBatchIdColumn &&
		schemaChecks.reminderSmsSuppressedAtColumn &&
		schemaChecks.reminderSmsSuppressionReasonColumn &&
		schemaChecks.manualSuppressionReasonAvailable &&
		schemaChecks.smsSuppressionReasonAvailable &&
		schemaChecks.suppressionPairConstraintAvailable &&
		schemaChecks.smsSuppressionPairConstraintVerified &&
		schemaChecks.syntheticProtectionConstraintVerified &&
		schemaChecks.migrationHistoryAvailable &&
		schemaChecks.suppressionMigrationApplied &&
		schemaChecks.genderMigrationApplied &&
		schemaChecks.joinedOnMigrationApplied &&
		schemaChecks.syntheticIdentityMigrationApplied &&
		schemaChecks.syntheticProtectionMigrationApplied;
	if (report.organizationExists === true && memberSchemaReady) {
		const organizationId = KD_GYM_ORGANIZATION_ID;
		const [existingMemberCount, idCollisions, nameCollisions, phoneCollisions, matchingAnyFixture] =
			await Promise.all([
				transaction.organizationMember.count({ where: { organizationId } }),
				transaction.organizationMember.count({
					where: { organizationId, id: { in: members.map(({ id }) => id) } },
				}),
				transaction.organizationMember.count({
					where: {
						organizationId,
						normalizedName: { in: members.map(({ normalizedName }) => normalizedName) },
					},
				}),
				transaction.organizationMember.count({
					where: {
						organizationId,
						phoneNumber: { in: members.map(({ phoneNumber }) => phoneNumber) },
					},
				}),
				transaction.organizationMember.count({
					where: {
						organizationId,
						OR: [
							{ id: { in: members.map(({ id }) => id) } },
							{ normalizedName: { in: members.map(({ normalizedName }) => normalizedName) } },
							{ phoneNumber: { in: members.map(({ phoneNumber }) => phoneNumber) } },
						],
					},
				}),
			]);
		report.existingMemberCount = existingMemberCount;
		report.expectedFinalCountMatches =
			existingMemberCount + datasetReport.recordCount === EXPECTED_FINAL_MEMBER_COUNT;
		report.collisions = {
			memberId: idCollisions,
			normalizedName: nameCollisions,
			phoneNumber: phoneCollisions,
			matchingAnyFixture,
		};
		const genderRows = await transaction.$queryRaw`
			SELECT gender::text AS "gender", COUNT(*)::int AS "count"
			FROM public.organization_members
			WHERE organization_id = ${organizationId}::uuid
			GROUP BY gender
		`;
		report.genderCounts = Object.fromEntries(
			['male', 'female', 'other', 'prefer_not_to_say', 'unknown'].map((gender) => [
				gender,
				genderRows.find((row) => (row.gender ?? 'unknown') === gender)?.count ?? 0,
			]),
		);
		const monthlyRows = await transaction.$queryRaw`
			SELECT TO_CHAR(joined_on::timestamp, 'YYYY-MM') AS "month",
				gender::text AS "gender", COUNT(*)::int AS "count"
			FROM public.organization_members
			WHERE organization_id = ${organizationId}::uuid
			GROUP BY 1, gender
			ORDER BY 1, 2
		`;
		report.monthlyRegistrationCounts = monthlyRows.map((row) => ({
			month: row.month,
			gender: row.gender ?? 'unknown',
			count: row.count,
		}));
		if (existingMemberCount !== EXPECTED_BASELINE_MEMBER_COUNT) {
			report.blockers.push('UNEXPECTED_EXISTING_MEMBER_COUNT');
		}
		if (!report.expectedFinalCountMatches) {
			report.blockers.push('EXPECTED_FINAL_MEMBER_COUNT_MISMATCH');
		}
		if (idCollisions + nameCollisions + phoneCollisions + matchingAnyFixture > 0) {
			report.blockers.push('GENERATED_FIXTURE_COLLISION');
		}
	}
	report.safeToProceedToSeparatelyApprovedImport =
		datasetReport.valid &&
		datasetReport.recordCount === EXPECTED_RECORD_COUNT &&
		datasetReport.manifestSha256 === approval.manifestSha256 &&
		report.databaseIdentityMatchesExpected &&
		report.organizationExists === true &&
		report.existingMemberCount === EXPECTED_BASELINE_MEMBER_COUNT &&
		Object.values(schemaChecks).every(Boolean) &&
		applicationNotificationSafeguardsVerified &&
		report.collisions.memberId === 0 &&
		report.collisions.normalizedName === 0 &&
		report.collisions.phoneNumber === 0 &&
		report.collisions.matchingAnyFixture === 0 &&
		report.blockers.length === 0;
	return report;
}

function assertInspectionInputs(target, members, datasetReport, approval) {
	if (
		!datasetReport.valid ||
		datasetReport.recordCount !== EXPECTED_RECORD_COUNT ||
		members.length !== EXPECTED_RECORD_COUNT ||
		members.some(
			(member) =>
				member.organizationId !== KD_GYM_ORGANIZATION_ID ||
				!isUuid(member.id) ||
				typeof member.normalizedName !== 'string' ||
				typeof member.phoneNumber !== 'string',
		) ||
		uniqueCount(members.map(({ id }) => id)) !== 0 ||
		uniqueCount(members.map(({ normalizedName }) => normalizedName)) !== 0 ||
		uniqueCount(members.map(({ phoneNumber }) => phoneNumber)) !== 0
	) {
		throw new PreflightConfigurationError(
			'FIXTURE_VALIDATION_FAILED',
			'Refusing inspection: fixtures do not match the approved organization or uniqueness rules.',
		);
	}
	if (
		target.target !== 'production' ||
		target.host !== EXPECTED_PRODUCTION_DATABASE_HOST ||
		target.databaseName !== EXPECTED_PRODUCTION_DATABASE_NAME ||
		!PRODUCTION_DATABASE_MARKER_PATTERN.test(target.databaseMarker ?? '')
	) {
		throw new PreflightConfigurationError(
			'DATABASE_IDENTITY_EXPECTATION_MISMATCH',
			'This historical import workflow is restricted to the approved production database.',
		);
	}
	if (
		!isRecord(approval) ||
		approval.historicalBusinessStartDate !== EXPECTED_BUSINESS_START_DATE ||
		approval.manifestSha256 !== datasetReport.manifestSha256 ||
		approval.databaseMarker !== target.databaseMarker ||
		approval.authorizationConfirmed !== true ||
		!isNonEmptyText(approval.authorizedBy, 160) ||
		!isNonEmptyText(approval.approvalReference, 160) ||
		!isNonEmptyText(approval.operator, 160)
	) {
		throw new PreflightConfigurationError(
			'PRODUCTION_APPROVAL_ARTIFACT_INVALID',
			'A matching production approval and historical date attestation are required.',
		);
	}
}

function parseJsonLines(text) {
	const lines = text.trimEnd().split('\n');
	if (lines.length === 0 || lines.some((line) => line.trim().length === 0)) {
		throw new Error('invalid');
	}
	return lines.map((line) => JSON.parse(line));
}

function parseCsv(text) {
	const rows = [];
	let row = [];
	let cell = '';
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (character === '"' && quoted && text[index + 1] === '"') {
			cell += '"';
			index += 1;
		} else if (character === '"') {
			quoted = !quoted;
		} else if (character === ',' && !quoted) {
			row.push(cell);
			cell = '';
		} else if (character === '\n' && !quoted) {
			row.push(cell.replace(/\r$/u, ''));
			rows.push(row);
			row = [];
			cell = '';
		} else {
			cell += character;
		}
	}
	if (quoted) throw new Error('invalid csv');
	if (cell.length > 0 || row.length > 0) {
		row.push(cell.replace(/\r$/u, ''));
		rows.push(row);
	}
	return rows;
}

function csvMatchesMembers(rows, members) {
	if (
		rows.length !== members.length + 1 ||
		JSON.stringify(rows[0]) !== JSON.stringify(FIXTURE_FIELDS)
	) {
		return false;
	}
	return members.every((member, index) => {
		const row = rows[index + 1];
		if (row === undefined || row.length !== FIXTURE_FIELDS.length) return false;
		return FIXTURE_FIELDS.every((field, fieldIndex) => {
			const cell = row[fieldIndex];
			const value = member[field];
			return field === 'synthetic'
				? cell === String(value)
				: field === 'email'
					? cell === (value === null ? '' : value)
					: cell === String(value);
		});
	});
}

function isFixture(value) {
	if (!isRecord(value)) return false;
	return (
		Object.keys(value).length === FIXTURE_FIELDS.length &&
		FIXTURE_FIELDS.every((field) => Object.hasOwn(value, field)) &&
		typeof value.id === 'string' &&
		typeof value.organizationId === 'string' &&
		typeof value.name === 'string' &&
		typeof value.normalizedName === 'string' &&
		typeof value.phoneNumber === 'string' &&
		(value.gender === 'MALE' || value.gender === 'FEMALE') &&
		value.email === null &&
		typeof value.joinedOn === 'string' &&
		typeof value.synthetic === 'boolean' &&
		typeof value.generationCategory === 'string' &&
		typeof value.generationBatch === 'string'
	);
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function uniqueCount(values) {
	return values.length - new Set(values).size;
}

function matchesCounts(actual, expected) {
	return (
		isRecord(actual) &&
		isRecord(expected) &&
		Object.keys(actual).length === Object.keys(expected).length &&
		Object.entries(expected).every(([key, value]) => actual[key] === value)
	);
}

function matchesDuplicateCounts(actual, expected) {
	return (
		matchesCounts(actual, expected) &&
		actual.id === 0 &&
		actual.normalizedName === 0 &&
		actual.phoneNumber === 0
	);
}

function monthlySummariesMatch(actual, expected) {
	if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
		return false;
	}
	return expected.every((month, index) => {
		const candidate = actual[index];
		return (
			isRecord(candidate) &&
			candidate.month === month.month &&
			candidate.male === month.male &&
			candidate.female === month.female &&
			candidate.reservedExistingUnknown === month.reservedExistingUnknown &&
			candidate.plannedTotalIncludingReserved === month.plannedTotalIncludingReserved &&
			candidate.malePercentageIncludingReservedUnknown ===
				month.malePercentageIncludingReservedUnknown &&
			candidate.targetMale === month.targetMale &&
			candidate.targetFemale === month.targetFemale
		);
	});
}

function sha256(contents) {
	return createHash('sha256').update(contents).digest('hex');
}

function makeMonthlyTargets(monthlyBreakdown) {
	return MONTH_TARGETS.map(([month, male, female, reservedExistingUnknown]) => {
		const existing = Array.isArray(monthlyBreakdown)
			? monthlyBreakdown.find((entry) => entry?.month === month)
			: undefined;
		return {
			month,
			generatedMale: male,
			generatedFemale: female,
			reservedExistingUnknown,
			expectedTotal: male + female + reservedExistingUnknown,
			malePercentage: Number(((male / (male + female + reservedExistingUnknown)) * 100).toFixed(2)),
			manifestMatches:
				existing?.male === male &&
				existing?.female === female &&
				existing?.reservedExistingUnknown === reservedExistingUnknown &&
				existing?.targetMale === male &&
				existing?.targetFemale === female,
		};
	});
}

function countMonthlyUnknown(rows, month) {
	return rows
		.filter((row) => row.month === month && row.gender === null)
		.reduce((total, row) => total + Number(row.count), 0);
}

function isVerifiedConstraint(rows, name, requiredTokens) {
	const constraint = rows.find((row) => row.name === name);
	if (
		constraint?.type !== 'c' ||
		constraint.validated !== true ||
		typeof constraint.definition !== 'string'
	) {
		return false;
	}
	const definition = constraint.definition.toLowerCase().replaceAll('"', '');
	return requiredTokens.every((token) => definition.includes(token.toLowerCase()));
}
