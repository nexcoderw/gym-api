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
import { ReminderActivityQueryDto, ReminderActivityResponseDto } from './dto/reminder-activity.dto.js';
import { OwnerReminderActivityService } from './owner-reminder-activity.service.js';
import { ownerReminderOrganizationId } from './owner-reminder-context.js';

@ApiTags('Owner reminders')
@ApiCookieAuth('owner-session')
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
@UseGuards(OwnerOriginCsrfGuard, OwnerSessionGuard)
@Controller('owner/reminders')
export class OwnerReminderActivityController {
	constructor(private readonly activity: OwnerReminderActivityService) {}

	@Get('activity')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'Read recent gym reminder activity',
		description:
			'Active gym owners only. Returns a bounded, tenant-scoped activity feed. ' +
			'ACCEPTED means submitted to the email provider, not delivered to an inbox. ' +
			'Recipient addresses and provider identifiers are omitted.',
	})
	@ApiOkResponse({ type: ReminderActivityResponseDto })
	list(
		@Query() query: ReminderActivityQueryDto,
		@Req() request: OwnerRequest,
	): Promise<ReminderActivityResponseDto> {
		return this.activity.list(ownerReminderOrganizationId(request), query);
	}
}
