import {
	Controller,
	Get,
	Header,
	NotFoundException,
	Param,
	ParseUUIDPipe,
	Req,
	UseGuards,
} from '@nestjs/common';
import {
	ApiCookieAuth,
	ApiForbiddenResponse,
	ApiNotFoundResponse,
	ApiOkResponse,
	ApiOperation,
	ApiServiceUnavailableResponse,
	ApiTags,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { OrganizationStatus } from '@nexcoderw/gym-db';

import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto.js';
import type { OwnerRequest } from '../owner-auth/owner-request.js';
import { OwnerSessionGuard } from '../owner-auth/owner-session.guard.js';
import { OwnerDashboardResponseDto } from './dto/owner-dashboard-response.dto.js';

@ApiTags('Organization Portal')
@Controller('owner/organizations')
@UseGuards(OwnerSessionGuard)
@ApiCookieAuth('owner-session')
export class OwnerPortalController {
	@Get(':organizationId/dashboard')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'Read the owner dashboard identity for one active organization',
		description:
			'Requires the current live ACTIVE membership, exact organization-scoped owner role, and ACTIVE organization. A valid global session alone grants no tenant access.',
	})
	@ApiOkResponse({ type: OwnerDashboardResponseDto })
	@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
	@ApiForbiddenResponse({ type: ApiErrorResponseDto })
	@ApiNotFoundResponse({ type: ApiErrorResponseDto })
	@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
	dashboard(
		@Param('organizationId', new ParseUUIDPipe()) organizationId: string,
		@Req() request: OwnerRequest,
	): OwnerDashboardResponseDto {
		const access = request.ownerPrincipal?.organizations.find(
			(organization) =>
				organization.organizationId === organizationId && organization.roles.includes('owner'),
		);
		if (access === undefined) {
			throw new NotFoundException({
				code: 'OWNER_ORGANIZATION_NOT_FOUND',
				message: 'Organization access was not found.',
			});
		}
		if (
			access.status !== OrganizationStatus.ACTIVE &&
			access.status !== OrganizationStatus.PENDING
		) {
			throw new NotFoundException({
				code: 'OWNER_ORGANIZATION_UNAVAILABLE',
				message: 'Organization operations are unavailable.',
			});
		}
		return {
			organizationId: access.organizationId,
			organizationName: access.name,
			organizationSlug: access.slug,
			membershipId: access.membershipId,
			organizationStatus: access.status,
			operationalAccess:
				access.status === OrganizationStatus.ACTIVE ? 'available' : 'pending_activation',
			roles: [...access.roles],
		};
	}
}
