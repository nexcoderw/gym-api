import { Module } from '@nestjs/common';

import { OwnerEntitlementGuard } from './owner-entitlement.guard.js';
import { OwnerEntitlementService } from './owner-entitlement.service.js';

@Module({
	providers: [OwnerEntitlementGuard, OwnerEntitlementService],
	exports: [OwnerEntitlementGuard, OwnerEntitlementService],
})
export class OwnerEntitlementsModule {}
