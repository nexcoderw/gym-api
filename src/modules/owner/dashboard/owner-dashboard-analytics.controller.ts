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
import {
	OwnerDashboardAnalyticsQueryDto,
	OwnerDashboardAnalyticsResponseDto,
} from './dto/owner-dashboard-analytics.dto.js';
import { OwnerDashboardAnalyticsService } from './owner-dashboard-analytics.service.js';

@ApiTags('Owner dashboard analytics')
@ApiCookieAuth('owner-session')
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
@UseGuards(OwnerOriginCsrfGuard, OwnerSessionGuard)
@Controller('owner/dashboard/analytics')
export class OwnerDashboardAnalyticsController {
	constructor(private readonly analytics: OwnerDashboardAnalyticsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'Read this gym’s financial and membership dashboard',
		description:
			'Active gym owners only. Defaults to the current Africa/Kigali month through today. ' +
			'Optional dates are inclusive and compared with the preceding equal-length period. ' +
			'Money uses the same settled-payment and confirmed-refund rules as payment reports; ' +
			'plan and method breakdowns show gross settled value before refunds.',
	})
	@ApiOkResponse({ type: OwnerDashboardAnalyticsResponseDto })
	get(
		@Query() query: OwnerDashboardAnalyticsQueryDto,
		@Req() request: OwnerRequest,
	): Promise<OwnerDashboardAnalyticsResponseDto> {
		return this.analytics.get(ownerPaymentContext(request), query);
	}
}
