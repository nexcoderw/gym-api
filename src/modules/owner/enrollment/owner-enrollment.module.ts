import { Module } from '@nestjs/common';

import { OwnerAuthModule } from '../auth/owner-auth.module.js';
import { PlatformAuthModule } from '../../platform/auth/platform-auth.module.js';
import { PlatformOwnerOnboardingModule } from '../../platform/owner-onboarding/platform-owner-onboarding.module.js';
import { OwnerAcceptanceService } from './owner-acceptance.service.js';
import { OwnerEnrollmentController } from './owner-enrollment.controller.js';
import { OwnerEnrollmentService } from './owner-enrollment.service.js';
import { OwnerEnrollmentSessionGuard } from './owner-enrollment-session.guard.js';

@Module({
	imports: [OwnerAuthModule, PlatformAuthModule, PlatformOwnerOnboardingModule],
	controllers: [OwnerEnrollmentController],
	providers: [OwnerAcceptanceService, OwnerEnrollmentService, OwnerEnrollmentSessionGuard],
})
export class OwnerEnrollmentModule {}
