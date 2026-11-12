export interface DatasetPreflightReport {
	readonly valid: boolean;
	readonly recordCount: number;
	readonly genderCounts: Readonly<{ male: number; female: number }>;
	readonly dateRange: Readonly<{ from: string; to: string; timezone: string }>;
	readonly monthlyTargets: readonly Readonly<{
		month: string;
		generatedMale: number;
		generatedFemale: number;
		reservedExistingUnknown: number;
		expectedTotal: number;
		malePercentage: number;
		manifestMatches: boolean;
	}>[];
	readonly checks: Readonly<Record<string, boolean>>;
}

export const KD_GYM_ORGANIZATION_ID: string;
export const EXPECTED_DATABASE_MIGRATIONS: readonly string[];

export interface FixturePreflightResult {
	readonly members: readonly Readonly<Record<string, string | boolean | null>>[];
	readonly manifest: Readonly<Record<string, unknown>> | null;
	readonly report: DatasetPreflightReport;
}

export interface DatabasePreflightTarget {
	readonly target: string;
	readonly databaseUrl: string;
	readonly databaseName: string;
	readonly host: string;
}

export interface DatabasePreflightReport {
	readonly performed: boolean;
	readonly target: string;
	readonly databaseIdentity: Readonly<Record<string, string | number | null>>;
	readonly organizationId: string;
	readonly organizationExists: boolean | null;
	readonly organizationBusinessStartDate: string | null;
	readonly existingMemberCount: number | null;
	readonly generatedMemberCount: number;
	readonly expectedTotalMemberCount: number;
	readonly genderCounts: Readonly<Record<string, number>> | null;
	readonly monthlyRegistrationCounts: readonly Readonly<Record<string, string | number>>[] | null;
	readonly collisions: Readonly<Record<string, number | null>>;
	readonly blockers: readonly string[];
	readonly safeToProceedToSeparatelyApprovedImport: boolean;
	readonly [key: string]: unknown;
}

export function validateFixtureFiles(directory?: string): FixturePreflightResult;
export function resolveDatabaseTarget(
	arguments_: readonly string[],
	environment?: Readonly<Record<string, string | undefined>>,
): DatabasePreflightTarget;
export function inspectDatabase(
	prisma: unknown,
	target: DatabasePreflightTarget,
	members: readonly Readonly<Record<string, string | boolean | null>>[],
	datasetReport: DatasetPreflightReport,
): Promise<DatabasePreflightReport>;
