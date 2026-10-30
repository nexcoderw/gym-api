import { Module } from '@nestjs/common';

import { PlatformAuthModule } from '../auth/platform-auth.module.js';
import { PlatformOrganizationEntitlementsController } from './platform-organization-entitlements.controller.js';
import { PlatformOrganizationEntitlementsService } from './platform-organization-entitlements.service.js';

@Module({
	imports: [PlatformAuthModule],
	controllers: [PlatformOrganizationEntitlementsController],
	providers: [PlatformOrganizationEntitlementsService],
})
export class PlatformOrganizationEntitlementsModule {}
