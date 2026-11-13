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
	readonly manifestSha256: string | null;
}

export const KD_GYM_ORGANIZATION_ID: string;
export const EXPECTED_DATABASE_MIGRATIONS: readonly string[];
export const EXPECTED_PRODUCTION_DATABASE_NAME: string;
export const EXPECTED_PRODUCTION_DATABASE_HOST: string;
export const EXPECTED_FINAL_MEMBER_COUNT: number;
export const EXPECTED_DATE_RANGE: Readonly<{ from: string; to: string; timezone: string }>;
export const PRODUCTION_APPROVAL_DIRECTORY: string;
export const SMS_NOTIFICATION_SUPPRESSION_SUPPORTED: boolean;

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
	readonly businessStartDateAttestationVerified: boolean;
	readonly approvalReference: string;
	readonly approvalOperator: string;
	readonly existingMemberCount: number | null;
	readonly generatedMemberCount: number;
	readonly expectedTotalMemberCount: number;
	readonly expectedFinalCountMatches: boolean;
	readonly schemaChecks: Readonly<{
		organizationTable: boolean;
		memberTable: boolean;
		memberOrganizationIdColumn: boolean;
		normalizedNameColumn: boolean;
		phoneNumberColumn: boolean;
		memberCreatedAtColumn: boolean;
		joinedOnColumn: boolean;
		genderColumn: boolean;
		reminderEmailSuppressedAtColumn: boolean;
		reminderEmailSuppressionReasonColumn: boolean;
		manualSuppressionReasonAvailable: boolean;
		suppressionPairConstraintAvailable: boolean;
		migrationHistoryAvailable: boolean;
		suppressionMigrationApplied: boolean;
		genderMigrationApplied: boolean;
		joinedOnMigrationApplied: boolean;
	}>;
	readonly genderCounts: Readonly<Record<string, number>> | null;
	readonly monthlyRegistrationCounts: readonly Readonly<Record<string, string | number>>[] | null;
	readonly collisions: Readonly<Record<string, number | null>>;
	readonly blockers: readonly string[];
	readonly safeToProceedToSeparatelyApprovedImport: boolean;
	readonly [key: string]: unknown;
}

export class PreflightConfigurationError extends Error {
	constructor(code: string, message: string);
	readonly code: string;
}

export function validateFixtureFiles(directory?: string): FixturePreflightResult;
export function resolveDatabaseTarget(
	arguments_: readonly string[],
	environment?: Readonly<Record<string, string | undefined>>,
): DatabasePreflightTarget;
export function validateProductionApprovalArtifact(
	value: unknown,
	manifestSha256: string | null,
): Readonly<Record<string, string>>;
export function loadProductionApprovalArtifact(
	manifestSha256: string | null,
): Readonly<Record<string, string>>;
export function loadProductionBackupAttestation(): Readonly<Record<string, string>>;
export function inspectDatabase(
	prisma: unknown,
	target: DatabasePreflightTarget,
	members: readonly Readonly<Record<string, string | boolean | null>>[],
	datasetReport: DatasetPreflightReport,
	approval: Readonly<Record<string, string>>,
): Promise<DatabasePreflightReport>;
export function inspectDatabaseTransaction(
	transaction: unknown,
	target: DatabasePreflightTarget,
	members: readonly Readonly<Record<string, string | boolean | null>>[],
	datasetReport: DatasetPreflightReport,
	approval: Readonly<Record<string, string>>,
	options: Readonly<{ expectedReadOnly: boolean; lockOrganization?: boolean }>,
): Promise<DatabasePreflightReport>;
