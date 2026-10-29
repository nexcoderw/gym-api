import { SetMetadata } from '@nestjs/common';
import type { OrganizationEntitlementKey } from '@nexcoderw/gym-db';

import { OWNER_ENTITLEMENTS_METADATA } from './owner-entitlement.constants.js';

/** Declares every organization entitlement required by a guarded owner operation. */
export const RequireOwnerEntitlements = (
	...entitlements: readonly OrganizationEntitlementKey[]
): MethodDecorator => SetMetadata(OWNER_ENTITLEMENTS_METADATA, entitlements);
