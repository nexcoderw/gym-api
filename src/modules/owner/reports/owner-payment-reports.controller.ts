import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import {
	ApiBadRequestResponse,
	ApiCookieAuth,
	ApiForbiddenResponse,
	ApiOkResponse,
	ApiOperation,
	ApiServiceUnavailableResponse,
	ApiTags,
	ApiTooManyRequestsResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../../../common/dto/api-error-response.dto.js';
import { OwnerOriginCsrfGuard } from '../auth/owner-origin-csrf.guard.js';
import type { OwnerRequest } from '../auth/owner-request.js';
import { OwnerSessionGuard } from '../auth/owner-session.guard.js';
import { ownerPaymentContext } from '../payments/owner-payment-context.js';
import { PaymentReportQueryDto, PaymentReportSummaryDto } from './dto/payment-report.dto.js';
import { OwnerPaymentReportsService } from './owner-payment-reports.service.js';

@ApiTags('Owner payment reports')
@ApiCookieAuth('owner-session')
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
@UseGuards(OwnerOriginCsrfGuard, OwnerSessionGuard)
@Controller('owner/reports/payments')
export class OwnerPaymentReportsController {
	constructor(private readonly reports: OwnerPaymentReportsService) {}

	@Get('summary')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'Summarize gym payments in a date range',
		description:
			'Active gym owners only. Dates are inclusive Africa/Kigali payment days. ' +
			'Gross includes settled payments; net subtracts confirmed refunds linked to those payments. ' +
			'Pending, failed and voided payments are counted but contribute no settled value.',
	})
	@ApiOkResponse({ type: PaymentReportSummaryDto })
	summary(
		@Query() query: PaymentReportQueryDto,
		@Req() request: OwnerRequest,
	): Promise<PaymentReportSummaryDto> {
		return this.reports.summary(ownerPaymentContext(request), query);
	}
}
