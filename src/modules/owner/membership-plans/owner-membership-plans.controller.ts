import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	Headers,
	HttpCode,
	HttpStatus,
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
	ApiParam,
	ApiPreconditionFailedResponse,
	ApiServiceUnavailableResponse,
	ApiTags,
	ApiTooManyRequestsResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiErrorResponseDto } from '../../../common/dto/api-error-response.dto.js';
import { OwnerOriginCsrfGuard } from '../auth/owner-origin-csrf.guard.js';
import type { OwnerRequest } from '../auth/owner-request.js';
import { OwnerSessionGuard } from '../auth/owner-session.guard.js';
import { RequireOwnerCsrf } from '../auth/owner-csrf.decorator.js';
import { OwnerEntitlementGuard } from '../entitlements/owner-entitlement.guard.js';
import { OWNER_OPERATION_ENTITLEMENTS } from '../entitlements/owner-operation-entitlements.js';
import { RequireOwnerEntitlements } from '../entitlements/require-owner-entitlements.decorator.js';
import { CreateMembershipPlanDto } from './dto/create-membership-plan.dto.js';
import { ListMembershipPlansQueryDto } from './dto/list-membership-plans-query.dto.js';
import { MembershipPlanListResponseDto } from './dto/membership-plan-list-response.dto.js';
import { MembershipPlanResponseDto } from './dto/membership-plan-response.dto.js';
import { UpdateMembershipPlanDto } from './dto/update-membership-plan.dto.js';
import { ownerMembershipPlanOrganization } from './owner-membership-plan-context.js';
import { membershipPlanPrecondition } from './owner-membership-plan-precondition.js';
import { OwnerMembershipPlansService } from './owner-membership-plans.service.js';

@ApiTags('Owner membership plans')
@ApiCookieAuth('owner-session')
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
@UseGuards(OwnerOriginCsrfGuard, OwnerSessionGuard, OwnerEntitlementGuard)
@Controller('owner/membership-plans')
export class OwnerMembershipPlansController {
	constructor(private readonly plans: OwnerMembershipPlansService) {}

	@Get()
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.membershipPlansList)
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'List membership plans for the authenticated gym',
		description:
			'Requires organization.membership-plans.read and an active owner membership. Results use bounded cursor pagination, optional plan-name search and exclude archived plans by default.',
	})
	@ApiOkResponse({ type: MembershipPlanListResponseDto })
	list(
		@Query() query: ListMembershipPlansQueryDto,
		@Req() request: OwnerRequest,
	): Promise<MembershipPlanListResponseDto> {
		return this.plans.list(ownerMembershipPlanOrganization(request).organizationId, query);
	}

	@Get(':planId')
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.membershipPlansGet)
	@Header('Cache-Control', 'no-store')
	@ApiParam({ name: 'planId', format: 'uuid' })
	@ApiOperation({
		summary: 'Read one membership plan for the authenticated gym',
		description:
			'Requires organization.membership-plans.read. Returns only a plan owned by the authenticated organization; updatedAt is also returned as an ETag.',
	})
	@ApiOkResponse({
		type: MembershipPlanResponseDto,
		headers: { ETag: { schema: { type: 'string' } } },
	})
	@ApiNotFoundResponse({ type: ApiErrorResponseDto })
	async get(
		@Param('planId', new ParseUUIDPipe()) planId: string,
		@Req() request: OwnerRequest,
		@Res({ passthrough: true }) response: Response,
	): Promise<MembershipPlanResponseDto> {
		const plan = await this.plans.get(
			ownerMembershipPlanOrganization(request).organizationId,
			planId,
		);
		response.setHeader('ETag', `"${plan.updatedAt}"`);
		return plan;
	}

	@Post()
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.membershipPlansCreate)
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiOperation({
		summary: 'Create a membership plan for the authenticated gym',
		description:
			'Requires organization.membership-plans.manage. Name and whole-RWF price are required. Organization, currency and lifecycle fields are server-controlled.',
	})
	@ApiCreatedResponse({ type: MembershipPlanResponseDto })
	@ApiConflictResponse({ type: ApiErrorResponseDto })
	create(
		@Body() input: CreateMembershipPlanDto,
		@Req() request: OwnerRequest,
	): Promise<MembershipPlanResponseDto> {
		return this.plans.create(ownerMembershipPlanOrganization(request).organizationId, input);
	}

	@Patch(':planId')
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.membershipPlansUpdate)
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiParam({ name: 'planId', format: 'uuid' })
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({ name: 'If-Match', required: true, example: '"2026-10-18T08:00:00.000Z"' })
	@ApiOperation({
		summary: 'Update an active membership plan',
		description:
			'Requires organization.membership-plans.manage, the latest quoted updatedAt ETag and at least one mutable field. Archived plans cannot be modified.',
	})
	@ApiOkResponse({ type: MembershipPlanResponseDto })
	@ApiNotFoundResponse({ type: ApiErrorResponseDto })
	@ApiConflictResponse({ type: ApiErrorResponseDto })
	@ApiPreconditionFailedResponse({ type: ApiErrorResponseDto })
	update(
		@Param('planId', new ParseUUIDPipe()) planId: string,
		@Body() input: UpdateMembershipPlanDto,
		@Headers('if-match') precondition: string | undefined,
		@Req() request: OwnerRequest,
	): Promise<MembershipPlanResponseDto> {
		return this.plans.update(
			ownerMembershipPlanOrganization(request).organizationId,
			planId,
			input,
			membershipPlanPrecondition(precondition),
		);
	}

	@Delete(':planId')
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.membershipPlansArchive)
	@HttpCode(HttpStatus.NO_CONTENT)
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiParam({ name: 'planId', format: 'uuid' })
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({ name: 'If-Match', required: true, example: '"2026-10-18T08:00:00.000Z"' })
	@ApiOperation({
		summary: 'Archive a membership plan',
		description:
			'Requires organization.membership-plans.manage. Soft-archives the plan using optimistic concurrency while retaining membership history.',
	})
	@ApiNoContentResponse()
	@ApiNotFoundResponse({ type: ApiErrorResponseDto })
	@ApiPreconditionFailedResponse({ type: ApiErrorResponseDto })
	async archive(
		@Param('planId', new ParseUUIDPipe()) planId: string,
		@Headers('if-match') precondition: string | undefined,
		@Req() request: OwnerRequest,
	): Promise<void> {
		await this.plans.archive(
			ownerMembershipPlanOrganization(request).organizationId,
			planId,
			membershipPlanPrecondition(precondition),
		);
	}
}
