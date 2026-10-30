import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
	INITIAL_ORGANIZATION_ENTITLEMENTS,
	OrganizationFeatureEntitlementChangeSource,
	OrganizationStatus,
	Prisma,
	PrismaService,
	type OrganizationEntitlementKey,
	type OrganizationFeatureEntitlement,
} from '@nexcoderw/gym-db';

import type { OrganizationEntitlementListResponseDto } from './dto/organization-entitlement-response.dto.js';
import type { OrganizationEntitlementResponseDto } from './dto/organization-entitlement-response.dto.js';
import type { UpdateOrganizationEntitlementDto } from './dto/update-organization-entitlement.dto.js';
import {
	organizationEntitlementArchived,
	organizationEntitlementChangeRequired,
	organizationEntitlementFailure,
	organizationEntitlementFeatureInvalid,
	organizationEntitlementNotFound,
	organizationEntitlementStale,
	organizationEntitlementUnchanged,
	organizationEntitlementWindowInvalid,
} from './platform-organization-entitlement-errors.js';

const TRANSACTION_OPTIONS = Object.freeze({
	maxWait: 5_000,
	timeout: 10_000,
	isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
});

export interface OrganizationEntitlementMutationContext {
	readonly actorPlatformStaffId: string;
	readonly requestId: string;
}

@Injectable()
export class PlatformOrganizationEntitlementsService {
	constructor(private readonly prisma: PrismaService) {}

	async list(organizationId: string): Promise<OrganizationEntitlementListResponseDto> {
		try {
			return await this.prisma.$transaction(async (transaction) => {
				const organization = await transaction.organization.findUnique({
					where: { id: organizationId },
					select: { id: true },
				});
				if (organization === null) throw organizationEntitlementNotFound();
				const rows = await transaction.organizationFeatureEntitlement.findMany({
					where: { organizationId },
					orderBy: { featureKey: 'asc' },
				});
				const byKey = new Map(rows.map((row) => [row.featureKey, row]));
				const now = new Date();
				return {
					organizationId,
					items: INITIAL_ORGANIZATION_ENTITLEMENTS.map((featureKey) =>
						entitlementResponse(featureKey, byKey.get(featureKey), now),
					),
				};
			}, TRANSACTION_OPTIONS);
		} catch (error: unknown) {
			throw organizationEntitlementFailure(error);
		}
	}

	async update(
		context: OrganizationEntitlementMutationContext,
		organizationId: string,
		featureKeyInput: string,
		expectedVersion: number,
		input: UpdateOrganizationEntitlementDto,
	): Promise<OrganizationEntitlementResponseDto> {
		const featureKey = entitlementKey(featureKeyInput);
		if (
			input.enabled === undefined &&
			input.startsAt === undefined &&
			input.expiresAt === undefined
		) {
			throw organizationEntitlementChangeRequired();
		}
		try {
			return await this.prisma.$transaction(async (transaction) => {
				const organization = await transaction.organization.findUnique({
					where: { id: organizationId },
					select: { id: true, status: true },
				});
				if (organization === null) throw organizationEntitlementNotFound();
				if (organization.status === OrganizationStatus.ARCHIVED) {
					throw organizationEntitlementArchived();
				}

				const previous = await transaction.organizationFeatureEntitlement.findUnique({
					where: { organizationId_featureKey: { organizationId, featureKey } },
				});
				if ((previous?.version ?? 0) !== expectedVersion) {
					throw organizationEntitlementStale();
				}
				const next = nextState(previous, input);
				if (previous !== null && sameState(previous, next)) {
					throw organizationEntitlementUnchanged();
				}
				const occurredAt = new Date();
				const row =
					previous === null
						? await transaction.organizationFeatureEntitlement.create({
								data: {
									organizationId,
									featureKey,
									...next,
									version: 1,
									updatedByPlatformStaffId: context.actorPlatformStaffId,
								},
							})
						: await updateExisting(
								transaction,
								organizationId,
								featureKey,
								previous,
								next,
								context.actorPlatformStaffId,
							);
				await recordAudit(transaction, {
					context,
					organizationId,
					featureKey,
					previous,
					row,
					reason: input.reason,
					occurredAt,
				});
				return entitlementResponse(featureKey, row, occurredAt);
			}, TRANSACTION_OPTIONS);
		} catch (error: unknown) {
			throw organizationEntitlementFailure(error);
		}
	}
}

interface EntitlementState {
	readonly enabled: boolean;
	readonly startsAt: Date | null;
	readonly expiresAt: Date | null;
}

function entitlementKey(value: string): OrganizationEntitlementKey {
	const key = INITIAL_ORGANIZATION_ENTITLEMENTS.find((candidate) => candidate === value);
	if (key === undefined) throw organizationEntitlementFeatureInvalid();
	return key;
}

function nextState(
	previous: OrganizationFeatureEntitlement | null,
	input: UpdateOrganizationEntitlementDto,
): EntitlementState {
	const state = {
		enabled: input.enabled ?? previous?.enabled ?? false,
		startsAt: timestamp(input.startsAt, previous?.startsAt ?? null),
		expiresAt: timestamp(input.expiresAt, previous?.expiresAt ?? null),
	};
	if (
		state.startsAt !== null &&
		state.expiresAt !== null &&
		state.startsAt.getTime() >= state.expiresAt.getTime()
	) {
		throw organizationEntitlementWindowInvalid();
	}
	return state;
}

function timestamp(value: string | null | undefined, current: Date | null): Date | null {
	if (value === undefined) return current;
	if (value === null) return null;
	const parsed = new Date(value);
	if (!Number.isFinite(parsed.getTime())) throw organizationEntitlementWindowInvalid();
	return parsed;
}

function sameState(row: OrganizationFeatureEntitlement, state: EntitlementState): boolean {
	return (
		row.enabled === state.enabled &&
		row.startsAt?.getTime() === state.startsAt?.getTime() &&
		row.expiresAt?.getTime() === state.expiresAt?.getTime()
	);
}

async function updateExisting(
	transaction: Prisma.TransactionClient,
	organizationId: string,
	featureKey: OrganizationEntitlementKey,
	previous: OrganizationFeatureEntitlement,
	state: EntitlementState,
	actorPlatformStaffId: string,
): Promise<OrganizationFeatureEntitlement> {
	const result = await transaction.organizationFeatureEntitlement.updateMany({
		where: { organizationId, featureKey, version: previous.version },
		data: {
			...state,
			version: { increment: 1 },
			updatedByPlatformStaffId: actorPlatformStaffId,
		},
	});
	if (result.count !== 1) throw organizationEntitlementStale();
	const row = await transaction.organizationFeatureEntitlement.findUnique({
		where: { organizationId_featureKey: { organizationId, featureKey } },
	});
	if (row === null) throw organizationEntitlementStale();
	return row;
}

interface AuditInput {
	readonly context: OrganizationEntitlementMutationContext;
	readonly organizationId: string;
	readonly featureKey: OrganizationEntitlementKey;
	readonly previous: OrganizationFeatureEntitlement | null;
	readonly row: OrganizationFeatureEntitlement;
	readonly reason: string;
	readonly occurredAt: Date;
}

async function recordAudit(
	transaction: Prisma.TransactionClient,
	input: AuditInput,
): Promise<void> {
	try {
		await transaction.organizationFeatureEntitlementAuditEvent.create({
			data: {
				organizationId: input.organizationId,
				featureKey: input.featureKey,
				source: OrganizationFeatureEntitlementChangeSource.PLATFORM_ADMIN,
				previousEnabled: input.previous?.enabled ?? null,
				resultingEnabled: input.row.enabled,
				previousStartsAt: input.previous?.startsAt ?? null,
				resultingStartsAt: input.row.startsAt,
				previousExpiresAt: input.previous?.expiresAt ?? null,
				resultingExpiresAt: input.row.expiresAt,
				resultingVersion: input.row.version,
				actorPlatformStaffId: input.context.actorPlatformStaffId,
				requestId: input.context.requestId,
				reason: input.reason,
				occurredAt: input.occurredAt,
			},
			select: { id: true },
		});
	} catch (error: unknown) {
		throw new ServiceUnavailableException(
			{
				code: 'ORGANIZATION_ENTITLEMENT_AUDIT_UNAVAILABLE',
				message: 'Durable entitlement auditing is unavailable',
			},
			{ cause: error },
		);
	}
}

function entitlementResponse(
	featureKey: OrganizationEntitlementKey,
	row: OrganizationFeatureEntitlement | undefined,
	at: Date,
): OrganizationEntitlementResponseDto {
	return {
		featureKey,
		enabled: row?.enabled ?? false,
		effectiveStatus: effectiveStatus(row, at),
		startsAt: row?.startsAt?.toISOString() ?? null,
		expiresAt: row?.expiresAt?.toISOString() ?? null,
		version: row?.version ?? 0,
		updatedAt: row?.updatedAt.toISOString() ?? null,
	};
}

function effectiveStatus(
	row: OrganizationFeatureEntitlement | undefined,
	at: Date,
): OrganizationEntitlementResponseDto['effectiveStatus'] {
	if (row === undefined || !row.enabled) return 'DISABLED';
	if (row.startsAt !== null && row.startsAt.getTime() > at.getTime()) return 'SCHEDULED';
	if (row.expiresAt !== null && row.expiresAt.getTime() <= at.getTime()) return 'EXPIRED';
	return 'ENABLED';
}
