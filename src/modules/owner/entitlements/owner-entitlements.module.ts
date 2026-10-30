import { Module } from '@nestjs/common';

import { OwnerAuthModule } from '../auth/owner-auth.module.js';
import { OwnerCapabilitiesController } from './owner-capabilities.controller.js';
import { OwnerEntitlementGuard } from './owner-entitlement.guard.js';
import { OwnerEntitlementService } from './owner-entitlement.service.js';

@Module({
	imports: [OwnerAuthModule],
	controllers: [OwnerCapabilitiesController],
	providers: [OwnerEntitlementGuard, OwnerEntitlementService],
	exports: [OwnerEntitlementGuard, OwnerEntitlementService],
})
export class OwnerEntitlementsModule {}
