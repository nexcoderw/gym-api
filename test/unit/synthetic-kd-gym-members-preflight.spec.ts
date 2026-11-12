import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { jest } from '@jest/globals';

import {
	EXPECTED_DATABASE_MIGRATIONS,
	KD_GYM_ORGANIZATION_ID,
	inspectDatabase,
	resolveDatabaseTarget,
	validateFixtureFiles,
} from '../../scripts/synthetic-data/kd-gym-members-preflight.mjs';

const SCRIPT_PATH = fileURLToPath(
	new URL('../../scripts/synthetic-data/generate-kd-gym-members.mjs', import.meta.url),
);
const OUTPUT_ROOT = fileURLToPath(new URL('../../scripts/synthetic-data/output/', import.meta.url));
const SEED = 'kd-gym-members-2026-11-12-v1';
const DATABASE_ENV = {
	PREFLIGHT_DATABASE_TARGET: 'development',
	PREFLIGHT_DATABASE_URL: 'postgresql://127.0.0.1:5432/kd-gym-test',
	PREFLIGHT_EXPECTED_DATABASE_HOST: '127.0.0.1',
	PREFLIGHT_EXPECTED_DATABASE_NAME: 'kd-gym-test',
};
const DATABASE_TARGET = {
	target: 'development',
	databaseUrl: DATABASE_ENV.PREFLIGHT_DATABASE_URL,
	databaseName: 'kd-gym-test',
	host: '127.0.0.1',
};
const DATASET_REPORT = {
	valid: true,
	recordCount: 823,
	genderCounts: { male: 709, female: 114 },
	dateRange: { from: '2025-10-18', to: '2026-11-12', timezone: 'Africa/Kigali' },
	monthlyTargets: [],
	checks: { valid: true },
};

describe('offline KD GYM historical member preflight', () => {
	let baselineDirectory: string;
	let testDirectories: string[];

	beforeAll(() => {
		baselineDirectory = temporaryDirectory('baseline-');
		execFileSync(process.execPath, [SCRIPT_PATH, '--seed', SEED, '--output-dir', baselineDirectory], {
			encoding: 'utf8',
			stdio: 'pipe',
		});
	});

	beforeEach(() => {
		testDirectories = [];
	});

	afterEach(() => {
		for (const directory of testDirectories) rmSync(directory, { recursive: true, force: true });
	});

	afterAll(() => {
		rmSync(baselineDirectory, { recursive: true, force: true });
	});

	it('accepts the valid generated dataset and confirms CSV, JSONL and manifest integrity', () => {
		const result = validateFixtureFiles(baselineDirectory);
		expect(result.report.valid).toBe(true);
		expect(result.report.recordCount).toBe(823);
		expect(result.report.genderCounts).toEqual({ male: 709, female: 114 });
		expect(result.report.checks.csvJsonlAgree).toBe(true);
		expect(result.report.checks.manifestHashesMatch).toBe(true);
		expect(result.report.checks.generatorReportPassed).toBe(true);
		expect(result.report.monthlyTargets).toHaveLength(14);
		expect(result.report.monthlyTargets.every((month) => month.malePercentage >= 85)).toBe(true);
		expect(JSON.stringify(result.report)).not.toContain('+250');
	});

	it('rejects CSV records that differ from JSONL', () => {
		const directory = copyBaseline();
		const csvPath = join(directory, 'members.csv');
		const csv = readFileSync(csvPath, 'utf8');
		writeFileSync(csvPath, csv.replace('MALE', 'FEMALE'));
		expect(validateFixtureFiles(directory).report.checks.csvJsonlAgree).toBe(false);
	});

	it('rejects a corrupted fixture checksum', () => {
		const directory = copyBaseline();
		const manifestValue = readJson(directory, 'manifest.json');
		if (!isRecord(manifestValue) || !isRecord(manifestValue.sha256)) {
			throw new Error('Expected a valid fixture manifest.');
		}
		manifestValue.sha256['members.csv'] = '0'.repeat(64);
		writeJson(directory, 'manifest.json', manifestValue);
		expect(validateFixtureFiles(directory).report.checks.manifestHashesMatch).toBe(false);
	});

	it.each([
		[
			'duplicate member UUID',
			'id',
			(records: Fixture[]) => duplicateField(records, 'id'),
			'validUniqueUuids',
		],
		[
			'duplicate normalized name',
			'normalizedName',
			(records: Fixture[]) => duplicateField(records, 'normalizedName'),
			'uniqueNormalizedNames',
		],
		[
			'duplicate phone number',
			'phoneNumber',
			(records: Fixture[]) => duplicateField(records, 'phoneNumber'),
			'uniquePhones',
		],
	] as const)('rejects %s', (_description, _field, mutate, check) => {
		const directory = copyBaseline();
		const records = readMembers(directory);
		mutate(records);
		writeJsonLines(directory, records);
		expect(validateFixtureFiles(directory).report.checks[check]).toBe(false);
	});

	it('rejects an invalid organization ID and dates outside the historical range', () => {
		const directory = copyBaseline();
		const records = readMembers(directory);
		const first = records[0];
		const second = records[1];
		if (first === undefined || second === undefined) throw new Error('Expected generated fixtures.');
		first.organizationId = '11111111-1111-4111-8111-111111111111';
		second.joinedOn = '2025-10-17';
		writeJsonLines(directory, records);
		const checks = validateFixtureFiles(directory).report.checks;
		expect(checks.expectedOrganization).toBe(false);
		expect(checks.exactDateRange).toBe(false);
	});

	it('rejects incorrect generated gender totals and monthly male-share targets', () => {
		const directory = copyBaseline();
		const records = readMembers(directory);
		const female = records.find((record) => record.gender === 'FEMALE');
		if (female === undefined) throw new Error('Expected a generated female fixture.');
		female.gender = 'MALE';
		writeJsonLines(directory, records);
		const checks = validateFixtureFiles(directory).report.checks;
		expect(checks.expectedGenderTotals).toBe(false);
		expect(checks.generatorValidation).toBe(false);
	});

	describe('explicit read-only database preflight controls', () => {
		it('requires an explicitly selected and identity-matched database target', () => {
			expect(() => resolveDatabaseTarget([], DATABASE_ENV)).toThrow(/explicit/u);
			expect(() => resolveDatabaseTarget(['--database-target', 'staging'], DATABASE_ENV)).toThrow(
				/match/u,
			);
			expect(
				() => resolveDatabaseTarget(['--database-target', 'development'], DATABASE_ENV),
			).not.toThrow();
		});

		it('rejects accidental production selection without two independent confirmations', () => {
			const productionEnvironment = {
				...DATABASE_ENV,
				PREFLIGHT_DATABASE_TARGET: 'production',
			};
			expect(() =>
				resolveDatabaseTarget(['--database-target', 'production'], productionEnvironment),
			).toThrow(/requires the CLI flag/u);
		});

		it('blocks readiness when the organization is missing', async () => {
			const { prisma } = mockPrisma({ organizationExists: false });
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT);
			expect(report.organizationExists).toBe(false);
			expect(report.blockers).toContain('ORGANIZATION_NOT_FOUND');
			expect(report.safeToProceedToSeparatelyApprovedImport).toBe(false);
		});

		it('blocks incompatible schema without querying members missing required columns', async () => {
			const { prisma, transaction } = mockPrisma({ missingJoinedOnColumn: true });
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT);
			expect(report.schemaChecks.joinedOnColumn).toBe(false);
			expect(report.safeToProceedToSeparatelyApprovedImport).toBe(false);
			expect(transaction.organizationMember.count).not.toHaveBeenCalled();
		});

		it('blocks readiness when required database migrations are not recorded as applied', async () => {
			const { prisma, transaction } = mockPrisma({ missingMigration: true });
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT);
			expect(report.schemaChecks.joinedOnMigrationApplied).toBe(false);
			expect(report.safeToProceedToSeparatelyApprovedImport).toBe(false);
			expect(transaction.organizationMember.count).not.toHaveBeenCalled();
		});

		it('blocks readiness when the existing member count differs from baseline', async () => {
			const { prisma } = mockPrisma({ existingMemberCount: 2 });
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT);
			expect(report.existingMemberCount).toBe(2);
			expect(report.blockers).toContain('UNEXPECTED_EXISTING_MEMBER_COUNT');
			expect(report.safeToProceedToSeparatelyApprovedImport).toBe(false);
		});

		it('reports scoped fixture collisions without names or phone numbers', async () => {
			const { prisma, transaction } = mockPrisma({
				idCollision: 1,
				nameCollision: 1,
				phoneCollision: 1,
				matchingFixture: 1,
			});
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT);
			expect(report.collisions).toMatchObject({
				memberId: 1,
				normalizedName: 1,
				phoneNumber: 1,
				matchingAnyFixture: 1,
			});
			expect(report.blockers).toContain('GENERATED_FIXTURE_COLLISION');
			expect(transaction.organizationMember.count).toHaveBeenCalled();
			for (const [query] of transaction.organizationMember.count.mock.calls) {
				expect(query.where.organizationId).toBe(KD_GYM_ORGANIZATION_ID);
			}
			expect(JSON.stringify(report)).not.toContain('+250');
			expect(JSON.stringify(report)).not.toContain('Synthetic Fixture Name');
		});

		it('enforces PostgreSQL read-only mode and never calls write APIs', async () => {
			const { prisma, events, transaction } = mockPrisma();
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT);
			expect(events[0]).toBe('set-transaction-read-only');
			expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
			expect(transaction.$executeRaw.mock.calls[0]?.[0].join('').trim()).toBe(
				'SET TRANSACTION READ ONLY',
			);
			expect(report.safeToProceedToSeparatelyApprovedImport).toBe(false);
			expect(report.blockers).toContain('ORGANIZATION_BUSINESS_START_DATE_UNAVAILABLE');
			expect(transaction.organizationMember).not.toHaveProperty('create');
			expect(transaction.organizationMember).not.toHaveProperty('update');
			expect(transaction.organizationMember).not.toHaveProperty('delete');
		});

		it('refuses all database access when local dataset validation failed', async () => {
			const { prisma } = mockPrisma();
			await expect(
				inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), {
					...DATASET_REPORT,
					valid: false,
				}),
			).rejects.toThrow(/fixture validation did not pass/u);
			expect(prisma.$transaction).not.toHaveBeenCalled();
		});

		it('refuses readiness until the organization business start date is verifiable', async () => {
			const { prisma } = mockPrisma();
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT);
			expect(report.schemaChecks.businessStartDateAvailable).toBe(false);
			expect(report.blockers).toContain('ORGANIZATION_BUSINESS_START_DATE_UNAVAILABLE');
			expect(report.safeToProceedToSeparatelyApprovedImport).toBe(false);
		});
	});
});

interface Fixture {
	id: string;
	organizationId: string;
	name: string;
	normalizedName: string;
	phoneNumber: string;
	gender: string;
	email: null;
	joinedOn: string;
	synthetic: boolean;
	generationCategory: string;
	generationBatch: string;
}

function temporaryDirectory(prefix: string): string {
	mkdirSync(OUTPUT_ROOT, { recursive: true });
	return mkdtempSync(join(OUTPUT_ROOT, prefix));
}

function copyBaseline(): string {
	const directory = temporaryDirectory('preflight-test-');
	testDirectories.push(directory);
	cpSync(baselineDirectory, directory, { recursive: true });
	return directory;
}

function readJson(directory: string, filename: string): unknown {
	return JSON.parse(readFileSync(join(directory, filename), 'utf8'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFixture(value: unknown): value is Fixture {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.organizationId === 'string' &&
		typeof value.name === 'string' &&
		typeof value.normalizedName === 'string' &&
		typeof value.phoneNumber === 'string' &&
		typeof value.gender === 'string' &&
		value.email === null &&
		typeof value.joinedOn === 'string' &&
		typeof value.synthetic === 'boolean' &&
		typeof value.generationCategory === 'string' &&
		typeof value.generationBatch === 'string'
	);
}

function writeJson(directory: string, filename: string, value: unknown): void {
	writeFileSync(join(directory, filename), `${JSON.stringify(value, null, 2)}\n`);
}

function readMembers(directory: string): Fixture[] {
	return readFileSync(join(directory, 'members.jsonl'), 'utf8')
		.trimEnd()
		.split('\n')
		.map((line) => {
			const member: unknown = JSON.parse(line);
			if (!isFixture(member)) throw new Error('Expected valid fixture records.');
			return member;
		});
}

function duplicateField(
	records: Fixture[],
	field: 'id' | 'normalizedName' | 'phoneNumber',
): void {
	const first = records[0];
	const second = records[1];
	if (first === undefined || second === undefined) throw new Error('Expected generated fixtures.');
	second[field] = first[field];
}

function writeJsonLines(directory: string, members: readonly Fixture[]): void {
	writeFileSync(
		join(directory, 'members.jsonl'),
		`${members.map((member) => JSON.stringify(member)).join('\n')}\n`,
	);
}

function fixtureIds(): Readonly<Record<string, string | boolean | null>>[] {
	return Array.from({ length: 823 }, (_, index) => ({
		id: `00000000-0000-5000-8000-${String(index + 1).padStart(12, '0')}`,
		organizationId: KD_GYM_ORGANIZATION_ID,
		name: `Synthetic Fixture Name ${index}`,
		normalizedName: `synthetic fixture name ${index}`,
		phoneNumber: `+25078${String(index).padStart(7, '0')}`,
		gender: 'MALE',
		email: null,
		joinedOn: '2026-10-01',
		synthetic: true,
		generationCategory: 'RWANDAN_STYLE',
		generationBatch: SEED,
	}));
}

function mockPrisma(options: {
	organizationExists?: boolean;
	existingMemberCount?: number;
	idCollision?: number;
	nameCollision?: number;
	phoneCollision?: number;
	matchingFixture?: number;
	missingJoinedOnColumn?: boolean;
	missingMigration?: boolean;
} = {}) {
	const events: string[] = [];
	const queryRaw = jest.fn(async (strings: TemplateStringsArray) => {
		const sql = strings.join(' ');
		events.push(`query:${sql.trim().split(/\s+/u).slice(0, 2).join(' ')}`);
		if (sql.includes("current_setting('transaction_read_only')")) return [{ readOnly: 'on' }];
		if (sql.includes('current_database()')) {
			return [{ databaseName: DATABASE_TARGET.databaseName, host: '127.0.0.1', port: 5432 }];
		}
		if (sql.includes('information_schema.columns')) {
			return [
				{ tableName: 'organizations', columnName: 'id' },
				{ tableName: 'organization_members', columnName: 'id' },
				{ tableName: 'organization_members', columnName: 'organization_id' },
				{ tableName: 'organization_members', columnName: 'normalized_name' },
				{ tableName: 'organization_members', columnName: 'phone_number' },
				{ tableName: 'organization_members', columnName: 'created_at' },
				...(options.missingJoinedOnColumn
					? []
					: [{ tableName: 'organization_members', columnName: 'joined_on' }]),
				{ tableName: 'organization_members', columnName: 'gender' },
			];
		}
		if (sql.includes('information_schema.tables')) return [{ exists: true }];
		if (sql.includes('migration_name')) {
			return EXPECTED_DATABASE_MIGRATIONS.filter(
				(migrationName) => !options.missingMigration,
			).map((migrationName) => ({ migrationName }));
		}
		if (sql.includes('business_start_date')) return [{ businessStartDate: '2025-10-18' }];
		if (sql.includes('SELECT gender::text')) return [{ gender: null, count: 1 }];
		if (sql.includes('TO_CHAR(COALESCE')) return [{ month: '2026-10', gender: null, count: 1 }];
		return [];
	});
	const executeRaw = jest.fn(async (_strings: TemplateStringsArray) => {
		events.push('set-transaction-read-only');
		return 0;
	});
	const memberCount = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
		if ('OR' in where) return options.matchingFixture ?? 0;
		if ('id' in where) return options.idCollision ?? 0;
		if ('normalizedName' in where) return options.nameCollision ?? 0;
		if ('phoneNumber' in where) return options.phoneCollision ?? 0;
		return options.existingMemberCount ?? 1;
	});
	const transaction = {
		$executeRaw: executeRaw,
		$queryRaw: queryRaw,
		organization: {
			findUnique: jest.fn(async () =>
				options.organizationExists === false ? null : { id: KD_GYM_ORGANIZATION_ID },
			),
		},
		organizationMember: { count: memberCount },
	};
	const prisma = {
		$transaction: jest.fn(async (operation: (client: typeof transaction) => Promise<unknown>) =>
			operation(transaction),
		),
	};
	return { prisma, transaction, events };
}
