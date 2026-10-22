import { Module } from '@nestjs/common';

import { OwnerAuthModule } from '../auth/owner-auth.module.js';
import { OwnerDashboardAnalyticsController } from './owner-dashboard-analytics.controller.js';
import { OwnerDashboardAnalyticsService } from './owner-dashboard-analytics.service.js';

@Module({
	imports: [OwnerAuthModule],
	controllers: [OwnerDashboardAnalyticsController],
	providers: [OwnerDashboardAnalyticsService],
})
export class OwnerDashboardAnalyticsModule {}
