import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
	INITIAL_ORGANIZATION_ENTITLEMENTS,
	TenantTransactionService,
	type OrganizationEntitlementKey,
	type TenantContext,
} from '@nexcoderw/gym-db';

import { OWNER_ENTITLEMENT_ERROR } from './owner-entitlement.constants.js';

const reviewedEntitlements: ReadonlySet<string> = new Set(INITIAL_ORGANIZATION_ENTITLEMENTS);

function isOrganizationEntitlementKey(value: string): value is OrganizationEntitlementKey {
	return reviewedEntitlements.has(value);
}

@Injectable()
export class OwnerEntitlementService {
	constructor(private readonly transactions: TenantTransactionService) {}

	/** Returns the live capability set for a verified organization portal bootstrap. */
	async listEnabled(
		context: TenantContext,
		at = new Date(),
	): Promise<readonly OrganizationEntitlementKey[]> {
		try {
			const rows = await this.transactions.run(context, (transaction) =>
				transaction.organizationFeatureEntitlement.findMany({
					where: {
						organizationId: context.organizationId,
						enabled: true,
						AND: [
							{ OR: [{ startsAt: null }, { startsAt: { lte: at } }] },
							{ OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] },
						],
					},
					select: { featureKey: true },
					orderBy: { featureKey: 'asc' },
				}),
			);

			const capabilities: OrganizationEntitlementKey[] = [];
			for (const { featureKey } of rows) {
				if (!isOrganizationEntitlementKey(featureKey)) {
					throw new Error('Database returned an unreviewed organization entitlement.');
				}
				capabilities.push(featureKey);
			}

			return capabilities;
		} catch (error: unknown) {
			throw new ServiceUnavailableException(OWNER_ENTITLEMENT_ERROR.unavailable, {
				cause: error,
			});
		}
	}

	/** Evaluates all required capabilities from live tenant state without a cross-request cache. */
	async hasAllEnabled(
		context: TenantContext,
		required: readonly OrganizationEntitlementKey[],
		at = new Date(),
	): Promise<boolean> {
		const uniqueRequired = [...new Set(required)];
		if (uniqueRequired.length === 0) return false;

		try {
			const enabledCount = await this.transactions.run(context, (transaction) =>
				transaction.organizationFeatureEntitlement.count({
					where: {
						organizationId: context.organizationId,
						featureKey: { in: uniqueRequired },
						enabled: true,
						AND: [
							{ OR: [{ startsAt: null }, { startsAt: { lte: at } }] },
							{ OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] },
						],
					},
				}),
			);

			return enabledCount === uniqueRequired.length;
		} catch (error: unknown) {
			throw new ServiceUnavailableException(OWNER_ENTITLEMENT_ERROR.unavailable, {
				cause: error,
			});
		}
	}
}
