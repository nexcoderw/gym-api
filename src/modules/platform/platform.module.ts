import { Module } from '@nestjs/common';

import { PlatformAuthModule } from './auth/platform-auth.module.js';
import { PlatformDashboardModule } from './dashboard/platform-dashboard.module.js';
import { PlatformOrganizationEntitlementsModule } from './organization-entitlements/platform-organization-entitlements.module.js';
import { PlatformOrganizationsModule } from './organizations/platform-organizations.module.js';
import { PlatformOwnerOnboardingModule } from './owner-onboarding/platform-owner-onboarding.module.js';

@Module({
	imports: [
		PlatformAuthModule,
		PlatformDashboardModule,
		PlatformOrganizationEntitlementsModule,
		PlatformOrganizationsModule,
		PlatformOwnerOnboardingModule,
	],
})
export class PlatformModule {}
