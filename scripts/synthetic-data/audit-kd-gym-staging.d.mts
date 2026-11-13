export interface StagingAuditSnapshot {
	readonly databaseName: string;
	readonly organizationName: string;
	readonly members: {
		readonly total: number;
		readonly synthetic: number;
		readonly original: number;
		readonly syntheticWrongBatch: number;
		readonly syntheticWithoutJoiningDate: number;
		readonly monthlyByJoinedOn: readonly { readonly month: string; readonly count: number }[];
		readonly monthlyByDashboardDate: readonly { readonly month: string; readonly count: number }[];
	};
	readonly subscriptions: {
		readonly syntheticCount: number;
		readonly linkageAnomalies: number;
		readonly historicalBusinessActiveMembers: number;
		readonly dashboardTechnicalActiveMembers: number;
		readonly monthlyByStartDate: readonly { readonly month: string; readonly count: number }[];
	};
	readonly payments: {
		readonly organizationTotal: number;
		readonly syntheticCount: number;
		readonly syntheticLinkageAnomalies: number;
		readonly statusRows: readonly {
			readonly status: string;
			readonly count: number;
			readonly amountRwf: string | bigint;
		}[];
		readonly monthlyByOccurredAtKigali: readonly Readonly<Record<string, unknown>>[];
		readonly monthlyByCreatedAtKigali: readonly {
			readonly month: string;
			readonly count: number;
		}[];
	};
	readonly allocations: {
		readonly syntheticCount: number;
		readonly linkageAnomalies: number;
		readonly coverageAnomalies: number;
	};
	readonly auditEvents: {
		readonly syntheticCount: number;
		readonly linkageAnomalies: number;
		readonly coverageAnomalies: number;
	};
	readonly reminders: {
		readonly syntheticCount: number;
		readonly providerAcknowledgementCount: number;
		readonly linkageAnomalies: number;
		readonly statusRows: readonly {
			readonly status: string;
			readonly channel: string;
			readonly count: number;
		}[];
		readonly monthlyByDueDate: readonly { readonly month: string; readonly count: number }[];
	};
}

export const EXPECTED: Readonly<Record<string, unknown>>;
export function buildAuditReport(snapshot: StagingAuditSnapshot): Readonly<Record<string, unknown>>;
export function auditStagingDatabase(prisma: unknown): Promise<Readonly<Record<string, unknown>>>;
export class StagingAuditError extends Error {
	readonly code: string;
}
