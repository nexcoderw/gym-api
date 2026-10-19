import { Module } from '@nestjs/common';

import { OwnerAuthModule } from './auth/owner-auth.module.js';
import { OwnerEnrollmentModule } from './enrollment/owner-enrollment.module.js';
import { OwnerMembershipPlansModule } from './membership-plans/owner-membership-plans.module.js';
import { OwnerMembersModule } from './members/owner-members.module.js';
import { OwnerPaymentsModule } from './payments/owner-payments.module.js';
import { OwnerPortalModule } from './portal/owner-portal.module.js';
import { OwnerReminderActivityModule } from './reminders/owner-reminder-activity.module.js';

@Module({
	imports: [
		OwnerAuthModule,
		OwnerEnrollmentModule,
		OwnerMembershipPlansModule,
		OwnerMembersModule,
		OwnerPaymentsModule,
		OwnerPortalModule,
		OwnerReminderActivityModule,
	],
})
export class OwnerModule {}
