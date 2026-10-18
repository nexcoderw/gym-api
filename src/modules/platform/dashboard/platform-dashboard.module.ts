import { Module } from '@nestjs/common';

import { PlatformAuthModule } from '../auth/platform-auth.module.js';
import { PlatformDashboardController } from './platform-dashboard.controller.js';
import { PlatformDashboardService } from './platform-dashboard.service.js';

@Module({
	imports: [PlatformAuthModule],
	controllers: [PlatformDashboardController],
	providers: [PlatformDashboardService],
})
export class PlatformDashboardModule {}
