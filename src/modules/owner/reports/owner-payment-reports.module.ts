import { Module } from '@nestjs/common';

import { OwnerAuthModule } from '../auth/owner-auth.module.js';
import { OwnerPaymentReportsController } from './owner-payment-reports.controller.js';
import { OwnerPaymentReportsService } from './owner-payment-reports.service.js';

@Module({
	imports: [OwnerAuthModule],
	controllers: [OwnerPaymentReportsController],
	providers: [OwnerPaymentReportsService],
})
export class OwnerPaymentReportsModule {}
