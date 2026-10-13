import {
	Body,
	Controller,
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
	UnauthorizedException,
	UseGuards,
} from '@nestjs/common';
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiCookieAuth,
	ApiCreatedResponse,
	ApiForbiddenResponse,
	ApiHeader,
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

import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto.js';
import { RequirePlatformCsrf } from '../platform-auth/platform-csrf.decorator.js';
import { PlatformOriginCsrfGuard } from '../platform-auth/platform-origin-csrf.guard.js';
import { PlatformPermissionGuard } from '../platform-auth/platform-permission.guard.js';
import { RequirePlatformPermissions } from '../platform-auth/platform-permissions.decorator.js';
import type { PlatformRequest } from '../platform-auth/platform-request.js';
import { PlatformSessionGuard } from '../platform-auth/platform-session.guard.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { ListOrganizationsQueryDto } from './dto/list-organizations-query.dto.js';
import { OrganizationActionDto } from './dto/organization-action.dto.js';
import { OrganizationListResponseDto } from './dto/organization-list-response.dto.js';
import { OrganizationResponseDto } from './dto/organization-response.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import type { OrganizationMutationContext } from './platform-organization-audit.js';
import { organizationPrecondition } from './platform-organization-preconditions.js';
import { PlatformOrganizationMutationsService } from './platform-organization-mutations.service.js';
import { ORGANIZATION_PERMISSION } from './platform-organizations.constants.js';
import { PlatformOrganizationsService } from './platform-organizations.service.js';

@ApiTags('Platform organizations')
@ApiCookieAuth('platform-session')
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({
	type: ApiErrorResponseDto,
	description: 'Persistence unavailable, or mutations blocked by ORGANIZATION_AUDIT_UNAVAILABLE.',
})
@UseGuards(PlatformSessionGuard, PlatformPermissionGuard)
@Controller('platform/organizations')
export class PlatformOrganizationsController {
	constructor(
		private readonly organizations: PlatformOrganizationsService,
		private readonly mutations: PlatformOrganizationMutationsService,
	) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePlatformPermissions(ORGANIZATION_PERMISSION.read)
	@ApiOperation({
		summary: 'List platform-managed organizations',
		description:
			'Requires platform.organizations.read. Default 20, maximum 50; createdAt descending then UUID ascending. Keep the status filter; missing/deleted cursor returns 400. No tenant authorization or subscription inference.',
	})
	@ApiOkResponse({ type: OrganizationListResponseDto })
	list(@Query() query: ListOrganizationsQueryDto): Promise<OrganizationListResponseDto> {
		return this.organizations.list(query);
	}

	@Get(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePlatformPermissions(ORGANIZATION_PERMISSION.read)
	@ApiParam({ name: 'id', format: 'uuid' })
	@ApiOperation({
		summary: 'Inspect an organization',
		description:
			'Requires platform.organizations.read. Returns safe organization fields and an updatedAt ETag for prepared conditional writes.',
	})
	@ApiOkResponse({
		type: OrganizationResponseDto,
		headers: { ETag: { schema: { type: 'string' } } },
	})
	@ApiNotFoundResponse({ type: ApiErrorResponseDto })
	async get(
		@Param('id', new ParseUUIDPipe()) id: string,
		@Res({ passthrough: true }) response: Response,
	): Promise<OrganizationResponseDto> {
		const organization = await this.organizations.get(id);
		response.setHeader('ETag', `"${organization.updatedAt}"`);
		return organization;
	}

	@Post()
	@Header('Cache-Control', 'no-store')
	@RequirePlatformPermissions(ORGANIZATION_PERMISSION.create)
	@UseGuards(PlatformOriginCsrfGuard)
	@RequirePlatformCsrf()
	@ApiHeader({ name: 'x-platform-csrf-token', required: true })
	@ApiOperation({
		summary: 'Register a pending organization (audit-blocked)',
		description:
			'Requires platform.organizations.create, configured admin Origin and CSRF. Currently returns 503 before organization writes: durable audit persistence is absent. Prepared success is 201/PENDING; ambiguous creation must be reconciled, not blindly retried.',
	})
	@ApiCreatedResponse({
		type: OrganizationResponseDto,
		description: 'Prepared contract; unavailable until durable auditing is reviewed and installed.',
	})
	@ApiConflictResponse({ type: ApiErrorResponseDto })
	create(
		@Body() input: CreateOrganizationDto,
		@Req() request: PlatformRequest,
	): Promise<OrganizationResponseDto> {
		return this.mutations.create(this.context(request), input);
	}

	@Patch(':id')
	@Header('Cache-Control', 'no-store')
	@RequirePlatformPermissions(ORGANIZATION_PERMISSION.update)
	@UseGuards(PlatformOriginCsrfGuard)
	@RequirePlatformCsrf()
	@ApiParam({ name: 'id', format: 'uuid' })
	@ApiHeader({ name: 'x-platform-csrf-token', required: true })
	@ApiHeader({ name: 'If-Match', required: true, example: '"2026-10-13T12:00:00.000Z"' })
	@ApiOperation({
		summary: 'Update organization name (audit-blocked)',
		description:
			'Requires platform.organizations.update, admin Origin and CSRF. Name only; slug/UUID/status are immutable here. Conditional updatedAt conflict returns 412. Currently blocked with 503 before organization writes.',
	})
	@ApiOkResponse({ type: OrganizationResponseDto })
	@ApiNotFoundResponse({ type: ApiErrorResponseDto })
	@ApiPreconditionFailedResponse({ type: ApiErrorResponseDto })
	update(
		@Param('id', new ParseUUIDPipe()) id: string,
		@Body() input: UpdateOrganizationDto,
		@Headers('if-match') precondition: string | undefined,
		@Req() request: PlatformRequest,
	): Promise<OrganizationResponseDto> {
		return this.mutations.update(
			this.context(request),
			id,
			input,
			organizationPrecondition(precondition),
		);
	}

	@Post(':id/activation')
	@HttpCode(HttpStatus.OK)
	@Header('Cache-Control', 'no-store')
	@RequirePlatformPermissions(ORGANIZATION_PERMISSION.activate)
	@UseGuards(PlatformOriginCsrfGuard)
	@RequirePlatformCsrf()
	@ApiParam({ name: 'id', format: 'uuid' })
	@ApiHeader({ name: 'x-platform-csrf-token', required: true })
	@ApiOperation({
		summary: 'Activate an organization (audit-blocked)',
		description:
			'Requires platform.organizations.activate, admin Origin and CSRF. Only PENDING/SUSPENDED to ACTIVE. Repeated activation or ARCHIVED returns 409 with a current precondition; stale timestamp returns 412. No entitlements are granted. Currently blocked with 503.',
	})
	@ApiOkResponse({ type: OrganizationResponseDto })
	@ApiNotFoundResponse({ type: ApiErrorResponseDto })
	@ApiConflictResponse({ type: ApiErrorResponseDto })
	@ApiPreconditionFailedResponse({ type: ApiErrorResponseDto })
	activate(
		@Param('id', new ParseUUIDPipe()) id: string,
		@Body() input: OrganizationActionDto,
		@Req() request: PlatformRequest,
	): Promise<OrganizationResponseDto> {
		return this.mutations.lifecycle(
			this.context(request),
			id,
			'activation',
			organizationPrecondition(`"${input.expectedUpdatedAt}"`),
		);
	}

	@Post(':id/suspension')
	@HttpCode(HttpStatus.OK)
	@Header('Cache-Control', 'no-store')
	@RequirePlatformPermissions(ORGANIZATION_PERMISSION.suspend)
	@UseGuards(PlatformOriginCsrfGuard)
	@RequirePlatformCsrf()
	@ApiParam({ name: 'id', format: 'uuid' })
	@ApiHeader({ name: 'x-platform-csrf-token', required: true })
	@ApiOperation({
		summary: 'Suspend an organization (audit-blocked)',
		description:
			'Requires platform.organizations.suspend, admin Origin and CSRF. Only ACTIVE to SUSPENDED. Repeated suspension or pending/archived state returns 409 with a current precondition; stale timestamp returns 412. Currently blocked with 503.',
	})
	@ApiOkResponse({ type: OrganizationResponseDto })
	@ApiNotFoundResponse({ type: ApiErrorResponseDto })
	@ApiConflictResponse({ type: ApiErrorResponseDto })
	@ApiPreconditionFailedResponse({ type: ApiErrorResponseDto })
	suspend(
		@Param('id', new ParseUUIDPipe()) id: string,
		@Body() input: OrganizationActionDto,
		@Req() request: PlatformRequest,
	): Promise<OrganizationResponseDto> {
		return this.mutations.lifecycle(
			this.context(request),
			id,
			'suspension',
			organizationPrecondition(`"${input.expectedUpdatedAt}"`),
		);
	}

	private context(request: PlatformRequest): OrganizationMutationContext {
		if (request.platformPrincipal === undefined) throw new UnauthorizedException();
		return {
			actorPlatformStaffId: request.platformPrincipal.platformStaffId,
			requestId: request.requestId,
		};
	}
}
