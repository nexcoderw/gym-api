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
import { OwnerEntitlementGuard } from '../entitlements/owner-entitlement.guard.js';
import { OWNER_OPERATION_ENTITLEMENTS } from '../entitlements/owner-operation-entitlements.js';
import { RequireOwnerEntitlements } from '../entitlements/require-owner-entitlements.decorator.js';
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
@UseGuards(OwnerOriginCsrfGuard, OwnerSessionGuard, OwnerEntitlementGuard)
@Controller('owner/members')
export class OwnerMembersController {
	constructor(private readonly members: OwnerMembersService) {}

	@Get()
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.membersList)
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'List gym members',
		description:
			'Requires organization.members.read. Results are tenant scoped with bounded cursor or numbered pagination and optional search; archived profiles are excluded by default.',
	})
	@ApiOkResponse({ type: MemberListResponseDto })
	list(
		@Query() query: ListMembersQueryDto,
		@Req() request: OwnerRequest,
	): Promise<MemberListResponseDto> {
		return this.members.list(ownerMemberContext(request), query);
	}

	@Post()
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.membersCreateWithSubscription)
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
			'Requires organization.members.create and organization.member-subscriptions.manage. Atomically creates a gym member and their first plan registration; plan terms remain server controlled.',
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
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.membersGet)
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'Read a gym member',
		description:
			'Requires organization.members.read. Returns only a member belonging to the authenticated gym and includes an updatedAt ETag.',
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
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.membersUpdate)
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({ name: 'If-Match', required: true })
	@ApiOperation({
		summary: 'Update a member profile',
		description:
			'Requires organization.members.update. Only contact/name fields are mutable and the current updatedAt ETag is required.',
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
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.membersArchive)
	@Header('Cache-Control', 'no-store')
	@HttpCode(204)
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({ name: 'If-Match', required: true })
	@ApiOperation({
		summary: 'Archive a member',
		description:
			'Requires organization.members.archive. Retains history and reserved uniqueness; current and future registrations must be cancelled first.',
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
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.memberSubscriptionsList)
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'List a member’s plan registrations',
		description:
			'Requires organization.member-subscriptions.read. Returns bounded tenant-scoped history including cancelled and expired registrations.',
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
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.memberSubscriptionsCreate)
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({ name: 'Idempotency-Key', required: true })
	@ApiOperation({
		summary: 'Register or renew a member’s plan',
		description:
			'Requires organization.member-subscriptions.manage. Uses an active plan from the same gym, snapshots its terms, and rejects overlapping uncancelled date ranges.',
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
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.memberSubscriptionsCancel)
	@Header('Cache-Control', 'no-store')
	@HttpCode(200)
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiOperation({
		summary: 'Cancel a member’s registration',
		description:
			'Requires organization.member-subscriptions.manage. Cancellation is idempotent and preserves original terms and audit evidence; it does not refund.',
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
