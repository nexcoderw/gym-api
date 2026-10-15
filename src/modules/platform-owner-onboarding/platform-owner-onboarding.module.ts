import { Module } from '@nestjs/common';

import { PlatformAuthModule } from '../platform-auth/platform-auth.module.js';
import {
	DurableOwnerInvitationAudit,
	PlatformOwnerInvitationAudit,
} from './platform-owner-invitation-audit.js';
import { PlatformOwnerOnboardingController } from './platform-owner-onboarding.controller.js';
import { PlatformOwnerOnboardingService } from './platform-owner-onboarding.service.js';

@Module({
	imports: [PlatformAuthModule],
	controllers: [PlatformOwnerOnboardingController],
	providers: [
		PlatformOwnerOnboardingService,
		{ provide: PlatformOwnerInvitationAudit, useClass: DurableOwnerInvitationAudit },
	],
})
export class PlatformOwnerOnboardingModule {}
