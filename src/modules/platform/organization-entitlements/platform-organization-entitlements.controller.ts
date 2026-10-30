import {
	Body,
	Controller,
	Get,
	Header,
	Headers,
	Param,
	ParseUUIDPipe,
	Patch,
	Req,
	Res,
	UnauthorizedException,
	UseGuards,
} from '@nestjs/common';
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiCookieAuth,
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

import { ApiErrorResponseDto } from '../../../common/dto/api-error-response.dto.js';
import { RequirePlatformCsrf } from '../auth/platform-csrf.decorator.js';
import { PlatformOriginCsrfGuard } from '../auth/platform-origin-csrf.guard.js';
import { PlatformPermissionGuard } from '../auth/platform-permission.guard.js';
import { RequirePlatformPermissions } from '../auth/platform-permissions.decorator.js';
import type { PlatformRequest } from '../auth/platform-request.js';
import { PlatformSessionGuard } from '../auth/platform-session.guard.js';
import {
	OrganizationEntitlementListResponseDto,
	OrganizationEntitlementResponseDto,
} from './dto/organization-entitlement-response.dto.js';
import { UpdateOrganizationEntitlementDto } from './dto/update-organization-entitlement.dto.js';
import { organizationEntitlementPrecondition } from './platform-organization-entitlement-precondition.js';
import { ORGANIZATION_ENTITLEMENT_PERMISSION } from './platform-organization-entitlements.constants.js';
import {
	PlatformOrganizationEntitlementsService,
	type OrganizationEntitlementMutationContext,
} from './platform-organization-entitlements.service.js';

@ApiTags('Platform organization entitlements')
@ApiCookieAuth('platform-session')
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiNotFoundResponse({ type: ApiErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
@UseGuards(PlatformSessionGuard, PlatformOriginCsrfGuard, PlatformPermissionGuard)
@Controller('platform/organizations/:organizationId/entitlements')
export class PlatformOrganizationEntitlementsController {
	constructor(private readonly entitlements: PlatformOrganizationEntitlementsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@RequirePlatformPermissions(ORGANIZATION_ENTITLEMENT_PERMISSION.read)
	@ApiParam({ name: 'organizationId', format: 'uuid' })
	@ApiOperation({
		summary: 'List one organization’s reviewed feature entitlements',
		description:
			'Requires platform.organizations.entitlements.read. Returns every reviewed catalog key; a missing persisted row is represented as disabled with version 0.',
	})
	@ApiOkResponse({ type: OrganizationEntitlementListResponseDto })
	list(
		@Param('organizationId', new ParseUUIDPipe()) organizationId: string,
	): Promise<OrganizationEntitlementListResponseDto> {
		return this.entitlements.list(organizationId);
	}

	@Patch(':featureKey')
	@Header('Cache-Control', 'no-store')
	@RequirePlatformPermissions(ORGANIZATION_ENTITLEMENT_PERMISSION.manage)
	@RequirePlatformCsrf()
	@ApiParam({ name: 'organizationId', format: 'uuid' })
	@ApiParam({ name: 'featureKey', example: 'organization.members.read' })
	@ApiHeader({ name: 'x-platform-csrf-token', required: true })
	@ApiHeader({
		name: 'If-Match',
		required: true,
		example: '"1"',
		description: 'Quoted entitlement version; use "0" only for a missing catalog row.',
	})
	@ApiOperation({
		summary: 'Conditionally change one organization entitlement',
		description:
			'Requires platform.organizations.entitlements.manage, admin Origin and CSRF. The reviewed catalog is allowlisted, If-Match prevents lost updates, and state plus append-only audit evidence commit atomically. Audit persistence failure returns 503 and rolls back the entitlement change.',
	})
	@ApiOkResponse({ type: OrganizationEntitlementResponseDto })
	@ApiConflictResponse({ type: ApiErrorResponseDto })
	@ApiPreconditionFailedResponse({ type: ApiErrorResponseDto })
	async update(
		@Param('organizationId', new ParseUUIDPipe()) organizationId: string,
		@Param('featureKey') featureKey: string,
		@Headers('if-match') precondition: string | undefined,
		@Body() input: UpdateOrganizationEntitlementDto,
		@Req() request: PlatformRequest,
		@Res({ passthrough: true }) response: Response,
	): Promise<OrganizationEntitlementResponseDto> {
		const result = await this.entitlements.update(
			this.context(request),
			organizationId,
			featureKey,
			organizationEntitlementPrecondition(precondition),
			input,
		);
		response.setHeader('ETag', `"${String(result.version)}"`);
		return result;
	}

	private context(request: PlatformRequest): OrganizationEntitlementMutationContext {
		if (request.platformPrincipal === undefined) throw new UnauthorizedException();
		return {
			actorPlatformStaffId: request.platformPrincipal.platformStaffId,
			requestId: request.requestId,
		};
	}
}
