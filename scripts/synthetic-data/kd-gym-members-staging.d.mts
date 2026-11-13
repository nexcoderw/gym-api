import type { FixturePreflightResult } from './kd-gym-members-preflight.mjs';

export interface StagingSeedResult {
	readonly status: 'INSERTED' | 'ALREADY_SEEDED';
	readonly insertedCount: number;
	readonly totalCount: number;
}

export interface StagingSeedSummary {
	readonly database: string;
	readonly organization: string;
	readonly existingMembersPreserved: number;
	readonly syntheticMembersInserted: number;
	readonly totalMembers: number;
	readonly maleSyntheticMembers: number;
	readonly femaleSyntheticMembers: number;
	readonly earliestJoiningDate: string;
	readonly latestJoiningDate: string;
	readonly transactionStatus: StagingSeedResult['status'];
}

export class StagingSeedError extends Error {
	constructor(code: string, message: string);
	readonly code: string;
}

export function loadStagingFixtures(directory?: string): FixturePreflightResult;
export function seedStagingMembers(
	prisma: unknown,
	members: readonly Readonly<Record<string, unknown>>[],
	insertedAt?: Date,
	onWriteStart?: () => void,
): Promise<StagingSeedResult>;
export function assertBatchMatchesFixtures(
	rows: readonly Readonly<Record<string, unknown>>[],
	members: readonly Readonly<Record<string, unknown>>[],
	insertedAt?: Date,
): void;
export function makeStagingSummary(
	result: StagingSeedResult,
	members: readonly Readonly<Record<string, unknown>>[],
): StagingSeedSummary;
