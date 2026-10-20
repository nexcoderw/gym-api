import {
	Body,
	Controller,
	Get,
	Header,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Post,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import {
	ApiAcceptedResponse,
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiCookieAuth,
	ApiForbiddenResponse,
	ApiHeader,
	ApiNotFoundResponse,
	ApiOkResponse,
	ApiOperation,
	ApiServiceUnavailableResponse,
	ApiTags,
	ApiTooManyRequestsResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../../../common/dto/api-error-response.dto.js';
import { OwnerOriginCsrfGuard } from '../auth/owner-origin-csrf.guard.js';
import { RequireOwnerCsrf } from '../auth/owner-csrf.decorator.js';
import type { OwnerRequest } from '../auth/owner-request.js';
import { OwnerSessionGuard } from '../auth/owner-session.guard.js';
import {
	ReminderActivityQueryDto,
	ReminderActivityResponseDto,
	QueuedReminderResponseDto,
	SendManualReminderDto,
	UpcomingReminderQueryDto,
	UpcomingReminderResponseDto,
} from './dto/reminder-activity.dto.js';
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

	@Get('upcoming')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'List memberships expiring within 14 Kigali calendar days',
		description: 'Tenant-scoped cursor pagination with optional member or plan-name search.',
	})
	@ApiOkResponse({ type: UpcomingReminderResponseDto })
	upcoming(
		@Query() query: UpcomingReminderQueryDto,
		@Req() request: OwnerRequest,
	): Promise<UpcomingReminderResponseDto> {
		return this.activity.upcoming(ownerReminderOrganizationId(request), query);
	}

	@Post('subscriptions/:subscriptionId/deliveries')
	@HttpCode(202)
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiConflictResponse({ type: ApiErrorResponseDto })
	@ApiNotFoundResponse({ type: ApiErrorResponseDto })
	@ApiOperation({
		summary: 'Queue one owner-composed email reminder for an expiring membership',
		description:
			'The owner session determines the gym. Consent and expiry are rechecked before queuing and again before delivery. Repeated requests cannot queue another manual reminder for the same subscription.',
	})
	@ApiAcceptedResponse({ type: QueuedReminderResponseDto })
	queueManual(
		@Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
		@Body() input: SendManualReminderDto,
		@Req() request: OwnerRequest,
	): Promise<QueuedReminderResponseDto> {
		return this.activity.queueManual(ownerReminderOrganizationId(request), subscriptionId, input);
	}
}
