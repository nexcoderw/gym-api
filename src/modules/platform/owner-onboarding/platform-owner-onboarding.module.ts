import { Module } from '@nestjs/common';

import { PlatformAuthModule } from '../auth/platform-auth.module.js';
import { OwnerInvitationDeliveryGate } from './owner-invitation-delivery.policy.js';
import { OwnerInvitationDeliveryService } from './owner-invitation-delivery.service.js';
import { OwnerInvitationPreviewController } from './owner-invitation-preview.controller.js';
import { OwnerInvitationTokenService } from './owner-invitation-token.service.js';
import { OwnerInvitationTokenEnvelopeService } from './owner-invitation-token-envelope.service.js';
import {
	DurableOwnerInvitationAudit,
	PlatformOwnerInvitationAudit,
} from './platform-owner-invitation-audit.js';
import { PlatformOwnerOnboardingController } from './platform-owner-onboarding.controller.js';
import { PlatformOwnerOnboardingService } from './platform-owner-onboarding.service.js';

@Module({
	imports: [PlatformAuthModule],
	controllers: [PlatformOwnerOnboardingController, OwnerInvitationPreviewController],
	providers: [
		PlatformOwnerOnboardingService,
		OwnerInvitationDeliveryGate,
		OwnerInvitationDeliveryService,
		OwnerInvitationTokenService,
		OwnerInvitationTokenEnvelopeService,
		{ provide: PlatformOwnerInvitationAudit, useClass: DurableOwnerInvitationAudit },
	],
	exports: [OwnerInvitationTokenService],
})
export class PlatformOwnerOnboardingModule {}
