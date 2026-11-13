export class StagingSeedError extends Error {
	readonly code: string;
	constructor(code: string, message: string);
}

export const REMINDER_GENERATION_SEED: string;
export const HISTORICAL_START: string;
export const REMINDER_KINDS: readonly string[];
export const REMINDER_CHANNEL: 'SMS';
export const SYNTHETIC_SUPPRESSION_CODE: string;

export interface SyntheticReminderSubscription {
	readonly id: string;
	readonly organizationId: string;
	readonly memberId: string;
	readonly startDate: Date;
	readonly endDate: Date;
	readonly cancelledAt?: Date | null;
	readonly member: {
		readonly id: string;
		readonly organizationId: string;
		readonly isSynthetic: boolean;
		readonly syntheticBatchId: string;
		readonly joinedOn: Date;
		readonly email: string | null;
		readonly reminderEmailSuppressedAt: Date | null;
		readonly reminderEmailSuppressionReason: string | null;
		readonly reminderSmsSuppressedAt: Date | null;
		readonly reminderSmsSuppressionReason: string | null;
	};
}

export interface SyntheticReminderRecord {
	readonly id: string;
	readonly organizationId: string;
	readonly memberId: string;
	readonly memberSubscriptionId: string;
	readonly kind: 'THREE_DAYS_BEFORE' | 'EXPIRY_DAY';
	readonly channel: 'SMS';
	readonly status: 'SKIPPED';
	readonly dueDate: Date;
	readonly recipientEmail: null;
	readonly messageSubject: null;
	readonly messageBody: null;
	readonly attemptCount: 0;
	readonly nextAttemptAt: null;
	readonly leaseExpiresAt: null;
	readonly providerIdempotencyKey: string;
	readonly providerMessageId: null;
	readonly lastErrorCode: string;
	readonly acceptedAt: null;
	readonly deliveredAt: null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

export function generateHistoricalReminders(
	subscriptions: readonly SyntheticReminderSubscription[],
	insertedAt: Date,
): SyntheticReminderRecord[];

export function assertReminderBatchMatches(
	actual: readonly SyntheticReminderRecord[],
	expected: readonly SyntheticReminderRecord[],
): void;

export function makeReminderSummary(
	result: Readonly<{ status: string; insertedCount: number; originalReminderCount: number; totalOrganizationReminders: number; eligibleSubscriptionIds: readonly string[] }>,
	subscriptions: readonly SyntheticReminderSubscription[],
	storedReminders: readonly SyntheticReminderRecord[],
): Readonly<Record<string, unknown>>;

export function seedStagingReminders(
	prisma: Readonly<Record<string, unknown>>,
	insertedAt?: Date,
	onWriteStart?: () => void,
): Promise<Readonly<Record<string, unknown>>>;
