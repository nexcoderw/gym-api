import { Module } from '@nestjs/common';

import { OwnerAuthModule } from '../auth/owner-auth.module.js';
import { OwnerMembershipPlansController } from './owner-membership-plans.controller.js';
import { OwnerMembershipPlansService } from './owner-membership-plans.service.js';

@Module({
	imports: [OwnerAuthModule],
	controllers: [OwnerMembershipPlansController],
	providers: [OwnerMembershipPlansService],
})
export class OwnerMembershipPlansModule {}
