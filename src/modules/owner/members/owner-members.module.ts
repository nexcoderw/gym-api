import { Module } from '@nestjs/common';

import { OwnerAuthModule } from '../auth/owner-auth.module.js';
import { OwnerMembersController } from './owner-members.controller.js';
import { OwnerMembersService } from './owner-members.service.js';

@Module({
	imports: [OwnerAuthModule],
	controllers: [OwnerMembersController],
	providers: [OwnerMembersService],
})
export class OwnerMembersModule {}
