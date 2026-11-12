import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(
	new URL('../../scripts/synthetic-data/generate-kd-gym-members.mjs', import.meta.url),
);
const OUTPUT_ROOT = fileURLToPath(
	new URL('../../scripts/synthetic-data/output/', import.meta.url),
);
const ORGANIZATION_ID = 'f6e417be-b93e-40ef-b028-d9d03666e69f';
const SEED = 'kd-gym-members-2026-11-12-v1';
const FILES = ['members.csv', 'members.jsonl', 'manifest.json', 'validation-report.json'];
const EXPECTED_MONTHS: readonly (readonly [string, number, number, number])[] = [
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
];
type GeneratedMember = {
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
};
type MonthlySummary = {
	month: string;
	male: number;
	female: number;
	reservedExistingUnknown: number;
	malePercentageIncludingReservedUnknown: number;
};
type GeneratorManifest = {
	organizationId: string;
	generationSeed: string;
	recordCount: number;
	dateRange: { from: string; to: string; timezone: string };
	monthlyGenderBreakdown: MonthlySummary[];
	namingCategoryCounts: Record<string, number>;
	phonePrefixDistribution: Record<string, number>;
	duplicateCounts: { id: number; normalizedName: number; phoneNumber: number };
	sha256: Record<string, string>;
	syntheticDataWarning: string;
};
type ValidationReport = { valid: boolean; checks: Record<string, boolean> };

describe('offline KD GYM member generator', () => {
	it('writes matching deterministic CSV and JSONL with all required targets', () => {
		const firstDirectory = temporaryDirectory();
		const secondDirectory = temporaryDirectory();
		try {
			runGenerator(firstDirectory);
			runGenerator(secondDirectory);

			for (const filename of FILES) {
				expect(readFileSync(join(firstDirectory, filename))).toEqual(
					readFileSync(join(secondDirectory, filename)),
				);
			}

			const csv = readFileSync(join(firstDirectory, 'members.csv'), 'utf8').trimEnd();
			const jsonl = readFileSync(join(firstDirectory, 'members.jsonl'), 'utf8').trimEnd();
			const parsedRecords: unknown[] = jsonl
				.split('\n')
				.map((line): unknown => JSON.parse(line));
			expect(parsedRecords.every(isGeneratedMember)).toBe(true);
			const records = parsedRecords.filter(isGeneratedMember);
			const csvRows = csv.split('\n').map(parseCsvRow);
			const headers = csvRows[0] ?? [];
			const csvRecords = parseCsvRecords(headers, csvRows.slice(1));
			expect(csvRecords).toEqual(records);
			expect(records).toHaveLength(823);
			expect(records.filter((record) => record.gender === 'MALE')).toHaveLength(709);
			expect(records.filter((record) => record.gender === 'FEMALE')).toHaveLength(114);
			expect(new Set(records.map((record) => record.id)).size).toBe(823);
			expect(new Set(records.map((record) => record.normalizedName)).size).toBe(823);
			expect(new Set(records.map((record) => record.phoneNumber)).size).toBe(823);
			expect(records.every((record) => record.organizationId === ORGANIZATION_ID)).toBe(true);
			expect(records.every((record) => record.synthetic && record.email === null)).toBe(true);
			expect(
				records.every((record) => !('createdAt' in record) && !('updatedAt' in record)),
			).toBe(true);
			expect(
				records.every((record) =>
					/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
						record.id,
					),
				),
			).toBe(true);
			expect(records.every((record) => /^\+250(?:78|72)\d{7}$/u.test(record.phoneNumber))).toBe(true);
			expect(
				records.every(
					(record) => record.joinedOn >= '2025-10-18' && record.joinedOn <= '2026-11-12',
				),
			).toBe(true);
			expect(
				records.every((record) => {
					const componentCount = record.name.trim().split(/\s+/u).length;
					return componentCount >= 2 && componentCount <= 4;
				}),
			).toBe(true);
			expect(
				records.every((record) => record.normalizedName === normalizeName(record.name)),
			).toBe(true);
			for (const [month] of EXPECTED_MONTHS) {
				const dailyCounts = new Map<string, number>();
				for (const record of records.filter((member) => member.joinedOn.startsWith(month))) {
					dailyCounts.set(record.joinedOn, (dailyCounts.get(record.joinedOn) ?? 0) + 1);
				}
				expect(new Set(dailyCounts.values()).size).toBeGreaterThan(1);
			}

			const manifestValue: unknown = JSON.parse(
				readFileSync(join(firstDirectory, 'manifest.json'), 'utf8'),
			);
			const reportValue: unknown = JSON.parse(
				readFileSync(join(firstDirectory, 'validation-report.json'), 'utf8'),
			);
			expect(isGeneratorManifest(manifestValue)).toBe(true);
			expect(isValidationReport(reportValue)).toBe(true);
			if (!isGeneratorManifest(manifestValue) || !isValidationReport(reportValue)) {
				throw new Error('The generator output did not match its manifest or report contract.');
			}
			const manifest = manifestValue;
			const report = reportValue;
			expect(manifest.organizationId).toBe(ORGANIZATION_ID);
			expect(manifest.generationSeed).toBe(SEED);
			expect(manifest.recordCount).toBe(823);
			expect(manifest.dateRange).toEqual({
				from: '2025-10-18',
				to: '2026-11-12',
				timezone: 'Africa/Kigali',
			});
			expect(
				manifest.monthlyGenderBreakdown.map(
					({ month, male, female, reservedExistingUnknown }) => [
						month,
						male,
						female,
						reservedExistingUnknown,
					],
				),
			).toEqual(EXPECTED_MONTHS);
			expect(
				manifest.monthlyGenderBreakdown.every(
					(month) => month.malePercentageIncludingReservedUnknown >= 85,
				),
			).toBe(true);
			expect(manifest.namingCategoryCounts).toEqual({
				RWANDAN_STYLE: 330,
				RWANDAN_CHRISTIAN_COMBINATION: 390,
				RWANDAN_MUSLIM_COMBINATION: 103,
			});
			expect(manifest.phonePrefixDistribution['+25078']).toBeGreaterThan(0);
			expect(manifest.phonePrefixDistribution['+25072']).toBeGreaterThan(0);
			expect(
				Object.values(manifest.phonePrefixDistribution).reduce((sum, count) => sum + count, 0),
			).toBe(823);
			expect(manifest.duplicateCounts).toEqual({ id: 0, normalizedName: 0, phoneNumber: 0 });
			expect(manifest.sha256['members.csv']).toBe(
				createHash('sha256').update(`${csv}\n`).digest('hex'),
			);
			expect(manifest.sha256['members.jsonl']).toBe(
				createHash('sha256').update(`${jsonl}\n`).digest('hex'),
			);
			expect(manifest.syntheticDataWarning).toMatch(/synthetic fixtures only/iu);
			expect(manifest.syntheticDataWarning).toMatch(
				/no claims about real people or religious identity/iu,
			);
			expect(report.valid).toBe(true);
			expect(Object.values(report.checks).every((passed) => passed === true)).toBe(true);
			expect(readdirSync(firstDirectory).sort()).toEqual([...FILES].sort());
		} finally {
			rmSync(firstDirectory, { recursive: true, force: true });
			rmSync(secondDirectory, { recursive: true, force: true });
		}
	});

	it('rejects an empty seed before writing any output', () => {
		const outputDirectory = temporaryDirectory();
		try {
			expect(() =>
				execFileSync(
					process.execPath,
					[SCRIPT_PATH, '--seed', '', '--output-dir', outputDirectory],
					{ encoding: 'utf8', stdio: 'pipe' },
				),
			).toThrow();
			expect(readdirSync(outputDirectory)).toHaveLength(0);
		} finally {
			rmSync(outputDirectory, { recursive: true, force: true });
		}
	});

	it('rejects output paths outside the ignored local fixture directory', () => {
		expect(() =>
			execFileSync(
				process.execPath,
				[SCRIPT_PATH, '--output-dir', tmpdir()],
				{ encoding: 'utf8', stdio: 'pipe' },
			),
		).toThrow(/gitignored synthetic-data output directory/iu);
	});
});

function temporaryDirectory(): string {
	mkdirSync(OUTPUT_ROOT, { recursive: true });
	return mkdtempSync(join(OUTPUT_ROOT, 'test-'));
}

function runGenerator(outputDirectory: string): void {
	execFileSync(
		process.execPath,
		[SCRIPT_PATH, '--seed', SEED, '--output-dir', outputDirectory],
		{ encoding: 'utf8', stdio: 'pipe' },
	);
}

function parseCsvRow(line: string): string[] {
	const cells: string[] = [];
	let cell = '';
	let quoted = false;
	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (character === '"' && quoted && line[index + 1] === '"') {
			cell += '"';
			index += 1;
		} else if (character === '"') {
			quoted = !quoted;
		} else if (character === ',' && !quoted) {
			cells.push(cell);
			cell = '';
		} else {
			cell += character;
		}
	}
	cells.push(cell);
	return cells;
}

function parseCsvRecords(
	headers: readonly string[],
	rows: readonly string[][],
): Record<string, string | boolean | null>[] {
	return rows.map((row) => {
		const record: Record<string, string | boolean | null> = {};
		for (let index = 0; index < headers.length; index += 1) {
			const header = headers[index];
			if (header === undefined) continue;
			const value = row[index] ?? '';
			if (header === 'email') {
				record[header] = value === '' ? null : value;
			} else if (header === 'synthetic') {
				record[header] = value === 'true';
			} else {
				record[header] = value;
			}
		}
		return record;
	});
}

function isGeneratedMember(value: unknown): value is GeneratedMember {
	if (typeof value !== 'object' || value === null) return false;
	return (
		'id' in value &&
		typeof value.id === 'string' &&
		'organizationId' in value &&
		typeof value.organizationId === 'string' &&
		'name' in value &&
		typeof value.name === 'string' &&
		'normalizedName' in value &&
		typeof value.normalizedName === 'string' &&
		'phoneNumber' in value &&
		typeof value.phoneNumber === 'string' &&
		'gender' in value &&
		typeof value.gender === 'string' &&
		'email' in value &&
		value.email === null &&
		'joinedOn' in value &&
		typeof value.joinedOn === 'string' &&
		'synthetic' in value &&
		typeof value.synthetic === 'boolean' &&
		'generationCategory' in value &&
		typeof value.generationCategory === 'string' &&
		'generationBatch' in value &&
		typeof value.generationBatch === 'string'
	);
}

function isGeneratorManifest(value: unknown): value is GeneratorManifest {
	if (!isRecord(value)) return false;
	if (
		!isRecord(value.dateRange) ||
		!Array.isArray(value.monthlyGenderBreakdown) ||
		!isNumberRecord(value.namingCategoryCounts) ||
		!isNumberRecord(value.phonePrefixDistribution) ||
		!isDuplicateCounts(value.duplicateCounts) ||
		!isStringRecord(value.sha256)
	) {
		return false;
	}
	return (
		typeof value.organizationId === 'string' &&
		typeof value.generationSeed === 'string' &&
		typeof value.recordCount === 'number' &&
		typeof value.syntheticDataWarning === 'string' &&
		typeof value.dateRange.from === 'string' &&
		typeof value.dateRange.to === 'string' &&
		typeof value.dateRange.timezone === 'string' &&
		value.monthlyGenderBreakdown.every(isMonthlySummary)
	);
}

function isMonthlySummary(value: unknown): value is MonthlySummary {
	if (!isRecord(value)) return false;
	return (
		typeof value.month === 'string' &&
		typeof value.male === 'number' &&
		typeof value.female === 'number' &&
		typeof value.reservedExistingUnknown === 'number' &&
		typeof value.malePercentageIncludingReservedUnknown === 'number'
	);
}

function isDuplicateCounts(value: unknown): value is GeneratorManifest['duplicateCounts'] {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === 'number' &&
		typeof value.normalizedName === 'number' &&
		typeof value.phoneNumber === 'number'
	);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
	return (
		isRecord(value) &&
		Object.values(value).every((item) => typeof item === 'number')
	);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.values(value).every((item) => typeof item === 'string')
	);
}

function isValidationReport(value: unknown): value is ValidationReport {
	return (
		isRecord(value) &&
		typeof value.valid === 'boolean' &&
		isRecord(value.checks) &&
		Object.values(value.checks).every((check) => typeof check === 'boolean')
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function normalizeName(value: string): string {
	return value
		.normalize('NFKC')
		.replace(/[\s\u0085]+/gu, ' ')
		.trim()
		.toLocaleLowerCase('en-US');
}
