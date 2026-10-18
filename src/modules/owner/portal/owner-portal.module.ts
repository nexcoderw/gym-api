import { Module } from '@nestjs/common';

import { OwnerAuthModule } from '../auth/owner-auth.module.js';
import { OwnerPortalController } from './owner-portal.controller.js';

@Module({
	imports: [OwnerAuthModule],
	controllers: [OwnerPortalController],
})
export class OwnerPortalModule {}
