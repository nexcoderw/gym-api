import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Header,
	Headers,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiCookieAuth,
	ApiCreatedResponse,
	ApiForbiddenResponse,
	ApiHeader,
	ApiNoContentResponse,
	ApiNotFoundResponse,
	ApiOkResponse,
	ApiOperation,
	ApiPreconditionFailedResponse,
	ApiServiceUnavailableResponse,
	ApiTags,
	ApiTooManyRequestsResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import type { Response } from 'express';

import { ApiErrorResponseDto } from '../../../common/dto/api-error-response.dto.js';
import { RequireOwnerCsrf } from '../auth/owner-csrf.decorator.js';
import { OwnerOriginCsrfGuard } from '../auth/owner-origin-csrf.guard.js';
import type { OwnerRequest } from '../auth/owner-request.js';
import { OwnerSessionGuard } from '../auth/owner-session.guard.js';
import { CreateMemberDto } from './dto/create-member.dto.js';
import { ListMembersQueryDto, MemberPageQueryDto } from './dto/list-members.dto.js';
import {
	MemberListResponseDto,
	MemberRegistrationResponseDto,
	MemberResponseDto,
	MemberSubscriptionListResponseDto,
	MemberSubscriptionResponseDto,
} from './dto/member-response.dto.js';
import { RegisterMemberSubscriptionDto } from './dto/register-member-subscription.dto.js';
import { UpdateMemberDto } from './dto/update-member.dto.js';
import { ownerMemberContext } from './owner-member-context.js';
import { memberPrecondition } from './owner-member-errors.js';
import { OwnerMembersService } from './owner-members.service.js';

@ApiTags('Owner members')
@ApiCookieAuth('owner-session')
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiNotFoundResponse({ type: ApiErrorResponseDto })
@ApiConflictResponse({ type: ApiErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
@UseGuards(OwnerOriginCsrfGuard, OwnerSessionGuard)
@Controller('owner/members')
export class OwnerMembersController {
	constructor(private readonly members: OwnerMembersService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'List gym members',
		description:
			'Active gym owners only. Tenant-scoped bounded cursor or numbered pagination and optional name, phone or email search; archived profiles are excluded by default. Numbered pages contain at most 20 members and include the matching total.',
	})
	@ApiOkResponse({ type: MemberListResponseDto })
	list(
		@Query() query: ListMembersQueryDto,
		@Req() request: OwnerRequest,
	): Promise<MemberListResponseDto> {
		return this.members.list(ownerMemberContext(request), query);
	}

	@Post()
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({
		name: 'Idempotency-Key',
		required: true,
		description: 'A UUID reused only for identical retries of this command.',
	})
	@ApiOperation({
		summary: 'Register a member with a plan',
		description:
			'Atomically creates a gym member and their first plan registration. Name and phone are independently unique within this gym; email is optional. Plan must belong to this gym and be active. End date and historical price/name are server controlled. No provider payment is confirmed by this command.',
	})
	@ApiCreatedResponse({ type: MemberRegistrationResponseDto })
	create(
		@Body() input: CreateMemberDto,
		@Headers('idempotency-key') key: string | undefined,
		@Req() request: OwnerRequest,
	): Promise<MemberRegistrationResponseDto> {
		return this.members.create(ownerMemberContext(request), input, idempotencyKey(key));
	}

	@Get(':memberId')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'Read a gym member',
		description:
			'Returns only a member belonging to the authenticated gym. Includes a quoted updatedAt ETag for profile changes.',
	})
	@ApiOkResponse({ type: MemberResponseDto, headers: { ETag: { schema: { type: 'string' } } } })
	async get(
		@Param('memberId', new ParseUUIDPipe()) memberId: string,
		@Req() request: OwnerRequest,
		@Res({ passthrough: true }) response: Response,
	): Promise<MemberResponseDto> {
		const member = await this.members.get(ownerMemberContext(request), memberId);
		response.setHeader('ETag', `"${member.updatedAt}"`);
		return member;
	}

	@Patch(':memberId')
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({ name: 'If-Match', required: true })
	@ApiOperation({
		summary: 'Update a member profile',
		description:
			'Only contact/name fields are mutable. Requires the current quoted updatedAt ETag. Archived members cannot be edited.',
	})
	@ApiPreconditionFailedResponse({ type: ApiErrorResponseDto })
	@ApiOkResponse({ type: MemberResponseDto })
	update(
		@Param('memberId', new ParseUUIDPipe()) memberId: string,
		@Body() input: UpdateMemberDto,
		@Headers('if-match') expected: string | undefined,
		@Req() request: OwnerRequest,
	): Promise<MemberResponseDto> {
		return this.members.update(
			ownerMemberContext(request),
			memberId,
			input,
			memberPrecondition(expected),
		);
	}

	@Delete(':memberId')
	@Header('Cache-Control', 'no-store')
	@HttpCode(204)
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({ name: 'If-Match', required: true })
	@ApiOperation({
		summary: 'Archive a member',
		description:
			'Retains history and reserved name/phone uniqueness. Current and future registrations must be cancelled first. Requires the current quoted updatedAt ETag.',
	})
	@ApiPreconditionFailedResponse({ type: ApiErrorResponseDto })
	@ApiNoContentResponse()
	archive(
		@Param('memberId', new ParseUUIDPipe()) memberId: string,
		@Headers('if-match') expected: string | undefined,
		@Req() request: OwnerRequest,
	): Promise<void> {
		return this.members.archive(
			ownerMemberContext(request),
			memberId,
			memberPrecondition(expected),
		);
	}

	@Get(':memberId/subscriptions')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'List a member’s plan registrations',
		description:
			'Bounded tenant-scoped history, including cancelled and expired registrations. Status is derived using the current Kigali calendar date; end date is inclusive.',
	})
	@ApiOkResponse({ type: MemberSubscriptionListResponseDto })
	subscriptions(
		@Param('memberId', new ParseUUIDPipe()) memberId: string,
		@Query() query: MemberPageQueryDto,
		@Req() request: OwnerRequest,
	): Promise<MemberSubscriptionListResponseDto> {
		return this.members.subscriptions(ownerMemberContext(request), memberId, query);
	}

	@Post(':memberId/subscriptions')
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({ name: 'Idempotency-Key', required: true })
	@ApiOperation({
		summary: 'Register or renew a member’s plan',
		description:
			'Uses an active plan from the same gym, retaining its name and whole-RWF price as snapshots. Rejects overlapping uncancelled date ranges. DAYS/WEEKS use calendar days; MONTHS/YEARS clamp the next anniversary to the last available day, then subtract one day for the inclusive end.',
	})
	@ApiCreatedResponse({ type: MemberSubscriptionResponseDto })
	renew(
		@Param('memberId', new ParseUUIDPipe()) memberId: string,
		@Body() input: RegisterMemberSubscriptionDto,
		@Headers('idempotency-key') key: string | undefined,
		@Req() request: OwnerRequest,
	): Promise<MemberSubscriptionResponseDto> {
		return this.members.renew(ownerMemberContext(request), memberId, input, idempotencyKey(key));
	}

	@Post(':memberId/subscriptions/:subscriptionId/cancellations')
	@Header('Cache-Control', 'no-store')
	@HttpCode(200)
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiOperation({
		summary: 'Cancel a member’s registration',
		description:
			'Idempotent cancellation, preserving the original dates, plan terms and first cancellation actor. Does not process a refund.',
	})
	@ApiOkResponse({ type: MemberSubscriptionResponseDto })
	cancel(
		@Param('memberId', new ParseUUIDPipe()) memberId: string,
		@Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
		@Req() request: OwnerRequest,
	): Promise<MemberSubscriptionResponseDto> {
		return this.members.cancel(ownerMemberContext(request), memberId, subscriptionId);
	}
}

function idempotencyKey(value: string | undefined): string {
	if (value === undefined || !isUUID(value)) {
		throw new BadRequestException({
			code: 'MEMBER_IDEMPOTENCY_REQUIRED',
			message: 'Supply a UUID Idempotency-Key header for registration.',
		});
	}
	return value.toLowerCase();
}
