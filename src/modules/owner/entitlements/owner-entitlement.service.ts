import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
	TenantTransactionService,
	type OrganizationEntitlementKey,
	type TenantContext,
} from '@nexcoderw/gym-db';

import { OWNER_ENTITLEMENT_ERROR } from './owner-entitlement.constants.js';

@Injectable()
export class OwnerEntitlementService {
	constructor(private readonly transactions: TenantTransactionService) {}

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
