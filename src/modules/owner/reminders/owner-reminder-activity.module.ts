import { Module } from '@nestjs/common';

import { OwnerAuthModule } from '../auth/owner-auth.module.js';
import { OwnerEntitlementsModule } from '../entitlements/owner-entitlements.module.js';
import { OwnerReminderActivityController } from './owner-reminder-activity.controller.js';
import { OwnerReminderActivityService } from './owner-reminder-activity.service.js';

@Module({
	imports: [OwnerAuthModule, OwnerEntitlementsModule],
	controllers: [OwnerReminderActivityController],
	providers: [OwnerReminderActivityService],
})
export class OwnerReminderActivityModule {}
