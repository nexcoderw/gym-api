export interface HistoricalSubscription {
	readonly memberId: string;
	readonly episode: number;
	readonly planName: string;
	readonly data: Readonly<Record<string, unknown>> & {
		id: string;
		organizationId: string;
		memberId: string;
		membershipPlanId: string;
		startDate: Date;
		endDate: Date;
		idempotencyKey: string;
		requestFingerprint: string;
	};
}

export class StagingSeedError extends Error {
	constructor(code: string, message: string);
	readonly code: string;
}

export const STAGING_DATABASE_NAME: 'neondb';
export const HISTORICAL_CUTOFF: '2026-11-12';
export const HISTORICAL_TIMEZONE: 'Africa/Kigali';
export const SUBSCRIPTION_GENERATION_SEED: string;
export const EXPECTED_PLAN_NAMES: readonly string[];
export function assertStagingDatabaseConfiguration(databaseUrl: string | undefined): void;
export function calculateSubscriptionPeriod(
	start: string,
	periodUnit: 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS',
	periodCount: number,
): Readonly<{ startDate: Date; endDate: Date }>;
export function generateHistoricalSubscriptions(
	members: readonly Readonly<Record<string, unknown>>[],
	plans: readonly Readonly<{
		id: string;
		name: string;
		normalizedName?: string;
		priceRwf: bigint;
	}>[],
	createdByUserId: string,
	createdAt: Date,
): readonly HistoricalSubscription[];
export function assertNoSubscriptionOverlap(histories: readonly HistoricalSubscription[]): void;
export function seedStagingSubscriptions(
	prisma: unknown,
	members: readonly Readonly<Record<string, unknown>>[],
	createdAt?: Date,
	onWriteStart?: () => void,
): Promise<Readonly<Record<string, unknown>>>;
export function assertExactSyntheticMemberBatch(
	databaseMembers: readonly Readonly<Record<string, unknown>>[],
	fixtures: readonly Readonly<Record<string, unknown>>[],
): void;
export function assertExistingBatchMatches(
	existingRows: readonly Readonly<Record<string, unknown>>[],
	plannedRows: readonly Readonly<Record<string, unknown>>[],
): void;
export function makeSubscriptionSummary(
	result: Readonly<Record<string, unknown>>,
	members: readonly Readonly<Record<string, unknown>>[],
	histories: readonly HistoricalSubscription[],
): Readonly<Record<string, unknown>>;
