import { Module } from '@nestjs/common';

import { OwnerAuthModule } from '../auth/owner-auth.module.js';
import { OwnerPaymentsController } from './owner-payments.controller.js';
import { OwnerPaymentsService } from './owner-payments.service.js';

@Module({
	imports: [OwnerAuthModule],
	controllers: [OwnerPaymentsController],
	providers: [OwnerPaymentsService],
})
export class OwnerPaymentsModule {}
