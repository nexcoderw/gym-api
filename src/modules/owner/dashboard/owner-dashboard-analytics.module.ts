import { Module } from '@nestjs/common';

import { OwnerAuthModule } from '../auth/owner-auth.module.js';
import { OwnerEntitlementsModule } from '../entitlements/owner-entitlements.module.js';
import { OwnerDashboardAnalyticsController } from './owner-dashboard-analytics.controller.js';
import { OwnerDashboardAnalyticsService } from './owner-dashboard-analytics.service.js';

@Module({
	imports: [OwnerAuthModule, OwnerEntitlementsModule],
	controllers: [OwnerDashboardAnalyticsController],
	providers: [OwnerDashboardAnalyticsService],
})
export class OwnerDashboardAnalyticsModule {}
