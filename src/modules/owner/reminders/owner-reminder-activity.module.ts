import { Module } from '@nestjs/common';

import { OwnerAuthModule } from '../auth/owner-auth.module.js';
import { OwnerReminderActivityController } from './owner-reminder-activity.controller.js';
import { OwnerReminderActivityService } from './owner-reminder-activity.service.js';

@Module({
	imports: [OwnerAuthModule],
	controllers: [OwnerReminderActivityController],
	providers: [OwnerReminderActivityService],
})
export class OwnerReminderActivityModule {}
