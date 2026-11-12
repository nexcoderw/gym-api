import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
export const EXPECTED_DATABASE_MIGRATIONS = Object.freeze([
	'20261112193052_add_organization_member_gender',
	'20261112212705_add_organization_member_joined_on',
]);

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
	const failed = (name) => (checks[name] = false);
	const passed = (name) => (checks[name] = true);

	try {
		csvText = readFileSync(join(directory, 'members.csv'), 'utf8');
		jsonlText = readFileSync(join(directory, 'members.jsonl'), 'utf8');
		manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
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
	if (!['development', 'staging', 'production'].includes(target)) {
		throw new PreflightConfigurationError(
			'DATABASE_TARGET_REQUIRED',
			'Database preflight requires an explicit development, staging or production target.',
		);
	}
	if (environment.PREFLIGHT_DATABASE_TARGET !== target) {
		throw new PreflightConfigurationError(
			'DATABASE_TARGET_CONFIRMATION_MISMATCH',
			'Set PREFLIGHT_DATABASE_TARGET to match the explicit database target.',
		);
	}
	if (
		typeof environment.PREFLIGHT_DATABASE_URL !== 'string' ||
		environment.PREFLIGHT_DATABASE_URL.trim().length === 0
	) {
		throw new PreflightConfigurationError(
			'PREFLIGHT_DATABASE_URL_REQUIRED',
			'Set a non-empty PREFLIGHT_DATABASE_URL; .env files and DATABASE_URL are not used.',
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
	const databaseName = decodeURIComponent(connection.pathname.slice(1));
	if (
		databaseName.length === 0 ||
		databaseName !== environment.PREFLIGHT_EXPECTED_DATABASE_NAME ||
		connection.hostname.toLowerCase() !==
			environment.PREFLIGHT_EXPECTED_DATABASE_HOST?.toLowerCase()
	) {
		throw new PreflightConfigurationError(
			'DATABASE_IDENTITY_EXPECTATION_MISMATCH',
			'Database URL identity does not match the explicitly expected host and database.',
		);
	}
	if (
		target === 'production' &&
		(!allowProductionReadOnly ||
			environment.PREFLIGHT_PRODUCTION_READ_ONLY_CONFIRMATION !== 'KD-GYM-READ-ONLY-PREFLIGHT')
	) {
		throw new PreflightConfigurationError(
			'PRODUCTION_READ_ONLY_CONFIRMATION_REQUIRED',
			'Production requires the CLI flag and separate read-only confirmation variable.',
		);
	}
	if (allowProductionReadOnly && target !== 'production') {
		throw new PreflightConfigurationError(
			'PRODUCTION_FLAG_TARGET_MISMATCH',
			'--allow-production-read-only is valid only for the production target.',
		);
	}
	return Object.freeze({
		target,
		databaseUrl: environment.PREFLIGHT_DATABASE_URL,
		databaseName,
		host: connection.hostname,
	});
}

/**
 * The shared tenant helper performs SELECTs before its callback. PostgreSQL requires the read-only
 * transaction setting first, so this uses the public Prisma client and then applies the same fixed
 * organization and branch transaction settings before running any inspection query.
 */
export async function inspectDatabase(prisma, target, members, datasetReport) {
	if (!datasetReport.valid || members.length !== EXPECTED_RECORD_COUNT) {
		throw new Error('Refusing database inspection because fixture validation did not pass.');
	}
	return prisma.$transaction(
		async (transaction) => {
			await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
			const readOnlyState = await transaction.$queryRaw`
			SELECT current_setting('transaction_read_only') AS "readOnly"
		`;
			if (readOnlyState[0]?.readOnly !== 'on') {
				throw new Error('Read-only transaction was not enabled.');
			}
			await transaction.$queryRaw`
			SELECT set_config('app.current_organization_id', ${KD_GYM_ORGANIZATION_ID}, true)
		`;
			await transaction.$queryRaw`SELECT set_config('app.current_branch_id', '', true)`;
			const identityRows = await transaction.$queryRaw`
			SELECT current_database() AS "databaseName",
				inet_server_addr()::text AS "host",
				inet_server_port() AS "port"
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
							'20261112193052_add_organization_member_gender',
							'20261112212705_add_organization_member_joined_on'
						)
				`
				: [];
			const migrationSet = new Set(migrationRows.map((row) => row.migrationName));
			const schemaChecks = {
				organizationTable: columnSet.has('organizations.id'),
				memberTable: columnSet.has('organization_members.id'),
				memberOrganizationIdColumn: columnSet.has('organization_members.organization_id'),
				normalizedNameColumn: columnSet.has('organization_members.normalized_name'),
				phoneNumberColumn: columnSet.has('organization_members.phone_number'),
				memberCreatedAtColumn: columnSet.has('organization_members.created_at'),
				joinedOnColumn: columnSet.has('organization_members.joined_on'),
				genderColumn: columnSet.has('organization_members.gender'),
				// The published gym-db Organization model has no configured business start-date field.
				businessStartDateAvailable: false,
				migrationHistoryAvailable: migrationTableRows[0]?.exists === true,
				genderMigrationApplied: migrationSet.has(EXPECTED_DATABASE_MIGRATIONS[0]),
				joinedOnMigrationApplied: migrationSet.has(EXPECTED_DATABASE_MIGRATIONS[1]),
			};
			const blockers = Object.entries(schemaChecks)
				.filter(([, passed]) => !passed)
				.map(([name]) =>
					name === 'businessStartDateAvailable'
						? 'ORGANIZATION_BUSINESS_START_DATE_UNAVAILABLE'
						: `SCHEMA_${name.replace(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase()}`,
				);
			const report = {
				performed: true,
				target: target.target,
				databaseIdentity: {
					databaseName: identity?.databaseName ?? target.databaseName,
					host: identity?.host ?? target.host,
					port: identity?.port ?? null,
				},
				organizationId: KD_GYM_ORGANIZATION_ID,
				databaseIdentityMatchesExpected: identity?.databaseName === target.databaseName,
				schemaChecks,
				organizationExists: null,
				organizationBusinessStartDate: null,
				existingMemberCount: null,
				generatedMemberCount: datasetReport.recordCount,
				expectedTotalMemberCount: EXPECTED_BASELINE_MEMBER_COUNT + EXPECTED_RECORD_COUNT,
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
			if (!report.databaseIdentityMatchesExpected)
				report.blockers.push('DATABASE_IDENTITY_MISMATCH');

			const organization = await transaction.organization.findUnique({
				where: { id: KD_GYM_ORGANIZATION_ID },
				select: { id: true },
			});
			report.organizationExists = organization !== null;
			if (organization === null) report.blockers.push('ORGANIZATION_NOT_FOUND');
			if (
				organization !== null &&
				schemaChecks.memberTable &&
				schemaChecks.memberOrganizationIdColumn &&
				schemaChecks.normalizedNameColumn &&
				schemaChecks.phoneNumberColumn &&
				schemaChecks.memberCreatedAtColumn &&
				schemaChecks.joinedOnColumn &&
				schemaChecks.genderColumn &&
				schemaChecks.migrationHistoryAvailable &&
				schemaChecks.genderMigrationApplied &&
				schemaChecks.joinedOnMigrationApplied
			) {
				const organizationId = KD_GYM_ORGANIZATION_ID;
				const [
					existingMemberCount,
					idCollisions,
					nameCollisions,
					phoneCollisions,
					matchingAnyFixture,
					genderRows,
					monthlyRows,
				] = await Promise.all([
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
					transaction.$queryRaw`
					SELECT gender::text AS "gender", COUNT(*)::int AS "count"
					FROM public.organization_members
					WHERE organization_id = ${organizationId}::uuid
					GROUP BY gender
				`,
					transaction.$queryRaw`
					SELECT TO_CHAR(
						COALESCE(joined_on::timestamp, created_at AT TIME ZONE 'Africa/Kigali'),
						'YYYY-MM'
					) AS "month",
						gender::text AS "gender", COUNT(*)::int AS "count"
					FROM public.organization_members
					WHERE organization_id = ${organizationId}::uuid
					GROUP BY 1, gender
					ORDER BY 1, 2
				`,
				]);
				report.existingMemberCount = existingMemberCount;
				report.genderCounts = Object.fromEntries(
					['male', 'female', 'other', 'prefer_not_to_say', 'unknown'].map((gender) => [
						gender,
						genderRows.find((row) => (row.gender ?? 'unknown') === gender)?.count ?? 0,
					]),
				);
				report.monthlyRegistrationCounts = monthlyRows.map((row) => ({
					month: row.month,
					gender: row.gender ?? 'unknown',
					count: row.count,
				}));
				report.collisions = {
					memberId: idCollisions,
					normalizedName: nameCollisions,
					phoneNumber: phoneCollisions,
					matchingAnyFixture,
				};
				if (existingMemberCount !== EXPECTED_BASELINE_MEMBER_COUNT) {
					report.blockers.push('UNEXPECTED_EXISTING_MEMBER_COUNT');
				}
				if (
					report.genderCounts.unknown !== 1 ||
					Object.entries(report.genderCounts).some(
						([gender, count]) => gender !== 'unknown' && count !== 0,
					)
				) {
					report.blockers.push('EXISTING_GENDER_BASELINE_MISMATCH');
				}
				if (
					MONTH_TARGETS.some(
						([month, , , reserved]) => countMonthlyUnknown(monthlyRows, month) !== reserved,
					)
				) {
					report.blockers.push('EXISTING_MONTHLY_REGISTRATION_BASELINE_MISMATCH');
				}
				if (idCollisions + nameCollisions + phoneCollisions + matchingAnyFixture > 0) {
					report.blockers.push('GENERATED_FIXTURE_COLLISION');
				}
			}
			report.safeToProceedToSeparatelyApprovedImport =
				datasetReport.valid &&
				report.organizationExists === true &&
				report.existingMemberCount === EXPECTED_BASELINE_MEMBER_COUNT &&
				Object.values(schemaChecks).every(Boolean) &&
				report.collisions.matchingAnyFixture === 0 &&
				report.blockers.length === 0;
			return report;
		},
		{ isolationLevel: 'RepeatableRead', timeout: 30_000 },
	);
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
