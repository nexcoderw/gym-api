import { Module } from '@nestjs/common';

import { PlatformAuthModule } from '../platform-auth/platform-auth.module.js';
import {
	PlatformOrganizationAudit,
	DurableOrganizationAudit,
} from './platform-organization-audit.js';
import { PlatformOrganizationMutationsService } from './platform-organization-mutations.service.js';
import { PlatformOrganizationsController } from './platform-organizations.controller.js';
import { PlatformOrganizationsService } from './platform-organizations.service.js';

@Module({
	imports: [PlatformAuthModule],
	controllers: [PlatformOrganizationsController],
	providers: [
		PlatformOrganizationsService,
		PlatformOrganizationMutationsService,
		{ provide: PlatformOrganizationAudit, useClass: DurableOrganizationAudit },
	],
})
export class PlatformOrganizationsModule {}
