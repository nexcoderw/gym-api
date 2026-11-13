export interface PlannedPayment {
	readonly subscriptionId: string;
	readonly payment: Readonly<Record<string, unknown>> & {
		id: string;
		organizationId: string;
		memberId: string;
		receiptNumber: string;
		amountRwf: bigint;
		method: string;
		status: string;
		occurredAt: Date;
		confirmedAt: Date | null;
		idempotencyKey: string;
		requestFingerprint: string;
	};
	readonly allocation: Readonly<Record<string, unknown>> & {
		id: string;
		organizationId: string;
		paymentId: string;
		memberId: string;
		memberSubscriptionId: string;
		amountRwf: bigint;
	};
	readonly auditEvent: Readonly<Record<string, unknown>> & {
		id: string;
		organizationId: string;
		paymentId: string;
		actorUserId: string;
		idempotencyKey: string;
		requestFingerprint: string;
		occurredAt: Date;
	};
}

export class StagingSeedError extends Error {
	constructor(code: string, message: string);
	readonly code: string;
}

export const PAYMENT_GENERATION_SEED: string;
export const HISTORICAL_START: '2025-10-18';
export const PAYMENT_METHODS: readonly string[];
export function generateHistoricalPayments(
	subscriptions: readonly Readonly<Record<string, unknown>>[],
	recordedByUserId: string,
	insertedAt: Date,
): readonly PlannedPayment[];
export function assertPaymentBatchMatches(
	actualPayments: readonly Readonly<Record<string, unknown>>[],
	planned: readonly PlannedPayment[],
): void;
export function makePaymentSummary(
	result: Readonly<Record<string, unknown>>,
	subscriptions: readonly Readonly<Record<string, unknown>>[],
	storedPayments: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>>;
export function seedStagingPayments(
	prisma: unknown,
	onWriteStart?: () => void,
): Promise<Readonly<Record<string, unknown>>>;
