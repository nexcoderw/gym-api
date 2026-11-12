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
	validateProductionApprovalArtifact,
	EXPECTED_PRODUCTION_DATABASE_HOST,
	EXPECTED_PRODUCTION_DATABASE_NAME,
	EXPECTED_DATE_RANGE,
	validateFixtureFiles,
} from '../../scripts/synthetic-data/kd-gym-members-preflight.mjs';

const SCRIPT_PATH = fileURLToPath(
	new URL('../../scripts/synthetic-data/generate-kd-gym-members.mjs', import.meta.url),
);
const OUTPUT_ROOT = fileURLToPath(new URL('../../scripts/synthetic-data/output/', import.meta.url));
const SEED = 'kd-gym-members-2026-11-12-v1';
const DATABASE_ENV = {
	PREFLIGHT_DATABASE_TARGET: 'production',
	PREFLIGHT_DATABASE_URL:
		'postgresql://user:password@ep-rapid-violet-b4txcgks-pooler.c-6.us-east-2.aws.neon.tech/neondb',
	PREFLIGHT_EXPECTED_DATABASE_HOST: 'ep-rapid-violet-b4txcgks-pooler.c-6.us-east-2.aws.neon.tech',
	PREFLIGHT_EXPECTED_DATABASE_NAME: 'neondb',
	PREFLIGHT_PRODUCTION_READ_ONLY_CONFIRMATION: 'KD-GYM-READ-ONLY-PREFLIGHT',
};
const DATABASE_TARGET = {
	target: 'production',
	databaseUrl: DATABASE_ENV.PREFLIGHT_DATABASE_URL,
	databaseName: 'neondb',
	host: 'ep-rapid-violet-b4txcgks-pooler.c-6.us-east-2.aws.neon.tech',
};
const DATASET_REPORT = {
	valid: true,
	recordCount: 823,
	genderCounts: { male: 709, female: 114 },
	dateRange: { from: '2025-10-18', to: '2026-11-12', timezone: 'Africa/Kigali' },
	monthlyTargets: [],
	checks: { valid: true },
	manifestSha256: 'a'.repeat(64),
};
const APPROVAL = {
	historicalBusinessStartDate: '2025-10-18',
	approvalReference: 'TEST-APPROVAL',
	operator: 'test operator',
	manifestSha256: DATASET_REPORT.manifestSha256,
};

let baselineDirectory: string;
let testDirectories: string[] = [];

describe('offline KD GYM historical member preflight', () => {
	function copyBaseline(): string {
		const directory = temporaryDirectory('preflight-test-');
		testDirectories.push(directory);
		cpSync(baselineDirectory, directory, { recursive: true });
		return directory;
	}

	beforeAll(() => {
		baselineDirectory = temporaryDirectory('baseline-');
		execFileSync(
			process.execPath,
			[SCRIPT_PATH, '--seed', SEED, '--output-dir', baselineDirectory],
			{ encoding: 'utf8', stdio: 'pipe' },
		);
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
			(records: Fixture[]) => {
				duplicateField(records, 'id');
			},
			'validUniqueUuids',
		],
		[
			'duplicate normalized name',
			'normalizedName',
			(records: Fixture[]) => {
				duplicateField(records, 'normalizedName');
			},
			'uniqueNormalizedNames',
		],
		[
			'duplicate phone number',
			'phoneNumber',
			(records: Fixture[]) => {
				duplicateField(records, 'phoneNumber');
			},
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
		if (first === undefined || second === undefined) {
			throw new Error('Expected generated fixtures.');
		}
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
			expect(() => resolveDatabaseTarget(['--database-target', 'development'], DATABASE_ENV)).toThrow(
				/production target/u,
			);
			expect(() =>
				resolveDatabaseTarget(['--database-target', 'production'], {
					PREFLIGHT_DATABASE_TARGET: 'production',
				}),
			).toThrow(/non-empty PREFLIGHT_DATABASE_URL/u);
			expect(() =>
				resolveDatabaseTarget(['--database-target', 'production'], {
					...DATABASE_ENV,
					PREFLIGHT_DATABASE_URL: '   ',
				}),
			).toThrow(/non-empty PREFLIGHT_DATABASE_URL/u);
			expect(() => resolveDatabaseTarget([
				'--database-target', 'production', '--allow-production-read-only',
			], DATABASE_ENV)).not.toThrow();
		});

		it('rejects accidental production selection without two independent confirmations', () => {
			const productionEnvironment = {
				...DATABASE_ENV,
				PREFLIGHT_DATABASE_TARGET: 'production',
			};
			expect(() =>
				resolveDatabaseTarget(['--database-target', 'production'], productionEnvironment),
			).toThrow(/CLI flag/u);
		});

		it('requires a checksum-bound production approval and explicit historical date attestation', () => {
			const artifact = {
				version: 1,
				organizationId: KD_GYM_ORGANIZATION_ID,
				productionDatabase: {
					host: EXPECTED_PRODUCTION_DATABASE_HOST,
					name: EXPECTED_PRODUCTION_DATABASE_NAME,
				},
				historicalBusinessStartDateAttestation: {
					date: '2025-10-18',
					operatorAttested: true,
				},
				dateRange: EXPECTED_DATE_RANGE,
				datasetManifestSha256: DATASET_REPORT.manifestSha256,
				expectedExistingMemberCount: 1,
				expectedGeneratedMemberCount: 823,
				expectedFinalMemberCount: 824,
				syntheticRecordsAcknowledged: true,
				approvalReference: 'TEST-APPROVAL',
				operator: 'test operator',
				approvedAt: '2020-01-01T10:00:00.000Z',
			};
			expect(() => validateProductionApprovalArtifact(artifact, DATASET_REPORT.manifestSha256)).not.toThrow();
			expect(() => validateProductionApprovalArtifact(artifact, 'b'.repeat(64))).toThrow();
			expect(() => validateProductionApprovalArtifact({
				...artifact,
				historicalBusinessStartDateAttestation: { date: '2025-10-18', operatorAttested: false },
			}, DATASET_REPORT.manifestSha256)).toThrow();
		});

		it('blocks readiness when the organization is missing', async () => {
			const { prisma } = mockPrisma({ organizationExists: false });
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT, APPROVAL);
			expect(report.organizationExists).toBe(false);
			expect(report.blockers).toContain('ORGANIZATION_NOT_FOUND');
			expect(report.safeToProceedToSeparatelyApprovedImport).toBe(false);
		});

		it('blocks incompatible schema without querying members missing required columns', async () => {
			const { prisma, transaction } = mockPrisma({ missingJoinedOnColumn: true });
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT, APPROVAL);
			expect(report.schemaChecks.joinedOnColumn).toBe(false);
			expect(report.safeToProceedToSeparatelyApprovedImport).toBe(false);
			expect(transaction.organizationMember.count).not.toHaveBeenCalled();
		});

		it('blocks readiness when required database migrations are not recorded as applied', async () => {
			const { prisma, transaction } = mockPrisma({ missingMigration: true });
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT, APPROVAL);
			expect(report.schemaChecks.joinedOnMigrationApplied).toBe(false);
			expect(report.safeToProceedToSeparatelyApprovedImport).toBe(false);
			expect(transaction.organizationMember.count).not.toHaveBeenCalled();
		});

		it('blocks readiness when the existing member count differs from baseline', async () => {
			const { prisma } = mockPrisma({ existingMemberCount: 2 });
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT, APPROVAL);
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
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT, APPROVAL);
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
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT, APPROVAL);
			expect(events[0]).toBe('set:SET TRANSACTION READ ONLY');
			expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
			expect(transaction.$executeRaw.mock.calls[0]?.[0].join('').trim()).toBe(
				'SET TRANSACTION READ ONLY',
			);
			expect(report.safeToProceedToSeparatelyApprovedImport).toBe(false);
			expect(report.expectedTotalMemberCount).toBe(824);
			expect(report.blockers).toContain('SMS_NOTIFICATION_SUPPRESSION_UNAVAILABLE');
			expect(report.businessStartDateAttestationVerified).toBe(true);
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
				}, APPROVAL),
			).rejects.toThrow(/fixtures do not match/u);
			expect(prisma.$transaction).not.toHaveBeenCalled();
		});

		it('reports the operator-attested business start date without deriving it from organization dates', async () => {
			const { prisma } = mockPrisma();
			const report = await inspectDatabase(prisma, DATABASE_TARGET, fixtureIds(), DATASET_REPORT, APPROVAL);
			expect(report.businessStartDateAttestationVerified).toBe(true);
			expect(report.organizationBusinessStartDate).toBe('2025-10-18');
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

function duplicateField(records: Fixture[], field: 'id' | 'normalizedName' | 'phoneNumber'): void {
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
		name: `Synthetic Fixture Name ${String(index)}`,
		normalizedName: `synthetic fixture name ${String(index)}`,
		phoneNumber: `+25078${String(index).padStart(7, '0')}`,
		gender: 'MALE',
		email: null,
		joinedOn: '2026-10-01',
		synthetic: true,
		generationCategory: 'RWANDAN_STYLE',
		generationBatch: SEED,
	}));
}

function mockPrisma(
	options: {
		organizationExists?: boolean;
		existingMemberCount?: number;
		idCollision?: number;
		nameCollision?: number;
		phoneCollision?: number;
		matchingFixture?: number;
		missingJoinedOnColumn?: boolean;
		missingMigration?: boolean;
	} = {},
) {
	const events: string[] = [];
	const queryRaw = jest.fn((strings: TemplateStringsArray) => {
		const sql = strings.join(' ');
		events.push(`query:${sql.trim().split(/\s+/u).slice(0, 2).join(' ')}`);
		if (sql.includes("current_setting('transaction_read_only')")) {
			return Promise.resolve([{ readOnly: 'on' }]);
		}
		if (sql.includes('current_database()')) {
			return Promise.resolve([
				{ databaseName: DATABASE_TARGET.databaseName, host: DATABASE_TARGET.host, port: 5432 },
			]);
		}
		if (sql.includes('FROM public.organizations')) {
			return Promise.resolve(options.organizationExists === false ? [] : [{ id: KD_GYM_ORGANIZATION_ID }]);
		}
		if (sql.includes('information_schema.columns')) {
			return Promise.resolve([
				{ tableName: 'organizations', columnName: 'id' },
				{ tableName: 'organization_members', columnName: 'id' },
				{ tableName: 'organization_members', columnName: 'organization_id' },
				{ tableName: 'organization_members', columnName: 'name' },
				{ tableName: 'organization_members', columnName: 'normalized_name' },
				{ tableName: 'organization_members', columnName: 'phone_number' },
				{ tableName: 'organization_members', columnName: 'email' },
				{ tableName: 'organization_members', columnName: 'created_at' },
				{ tableName: 'organization_members', columnName: 'updated_at' },
				...(options.missingJoinedOnColumn
					? []
					: [{ tableName: 'organization_members', columnName: 'joined_on' }]),
				{ tableName: 'organization_members', columnName: 'gender' },
				{ tableName: 'organization_members', columnName: 'reminder_email_suppressed_at' },
				{ tableName: 'organization_members', columnName: 'reminder_email_suppression_reason' },
			]);
		}
		if (sql.includes('pg_enum')) return Promise.resolve([{ exists: true }]);
		if (sql.includes('pg_constraint')) return Promise.resolve([{ exists: true }]);
		if (sql.includes('information_schema.tables')) return Promise.resolve([{ exists: true }]);
		if (sql.includes('migration_name')) {
			const migrations = options.missingMigration ? [] : [...EXPECTED_DATABASE_MIGRATIONS];
			return Promise.resolve(migrations.map((migrationName) => ({ migrationName })));
		}
		if (sql.includes('SELECT gender::text')) {
			return Promise.resolve([{ gender: null, count: 1 }]);
		}
		if (sql.includes('TO_CHAR(joined_on')) {
			return Promise.resolve([{ month: '2026-10', gender: null, count: 1 }]);
		}
		return Promise.resolve([]);
	});
	const executeRaw = jest.fn((strings: TemplateStringsArray) => {
		events.push(`set:${strings.join('').trim()}`);
		return Promise.resolve(0);
	});
	const memberCount = jest.fn(({ where }: { where: Record<string, unknown> }) => {
		if ('OR' in where) return Promise.resolve(options.matchingFixture ?? 0);
		if ('id' in where) return Promise.resolve(options.idCollision ?? 0);
		if ('normalizedName' in where) return Promise.resolve(options.nameCollision ?? 0);
		if ('phoneNumber' in where) return Promise.resolve(options.phoneCollision ?? 0);
		return Promise.resolve(options.existingMemberCount ?? 1);
	});
	const transaction = {
		$executeRaw: executeRaw,
		$queryRaw: queryRaw,
		organization: {
			findUnique: jest.fn(() =>
				Promise.resolve(
					options.organizationExists === false ? null : { id: KD_GYM_ORGANIZATION_ID },
				),
			),
		},
		organizationMember: { count: memberCount },
	};
	const prisma = {
		$transaction: jest.fn((operation: (client: typeof transaction) => Promise<unknown>) =>
			operation(transaction),
		),
	};
	return { prisma, transaction, events };
}
