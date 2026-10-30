import { Controller, ForbiddenException, Get, Header, Req, UseGuards } from '@nestjs/common';
import {
	ApiCookieAuth,
	ApiForbiddenResponse,
	ApiOkResponse,
	ApiOperation,
	ApiServiceUnavailableResponse,
	ApiTags,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { OrganizationStatus } from '@nexcoderw/gym-db';

import { ApiErrorResponseDto } from '../../../common/dto/api-error-response.dto.js';
import { OwnerOriginCsrfGuard } from '../auth/owner-origin-csrf.guard.js';
import type { OwnerRequest } from '../auth/owner-request.js';
import { OwnerSessionGuard } from '../auth/owner-session.guard.js';
import { OwnerCapabilitiesResponseDto } from './dto/owner-capabilities-response.dto.js';
import { OWNER_ENTITLEMENT_ERROR } from './owner-entitlement.constants.js';
import { OwnerEntitlementService } from './owner-entitlement.service.js';

@ApiTags('Owner capabilities')
@Controller('owner/capabilities')
@UseGuards(OwnerOriginCsrfGuard, OwnerSessionGuard)
@ApiCookieAuth('owner-session')
export class OwnerCapabilitiesController {
	constructor(private readonly entitlements: OwnerEntitlementService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'Read effective capabilities for the current organization',
		description:
			'Returns a live, fail-closed capability snapshot for presentation. Every protected owner operation still performs independent authorization.',
	})
	@ApiOkResponse({ type: OwnerCapabilitiesResponseDto })
	@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
	@ApiForbiddenResponse({ type: ApiErrorResponseDto })
	@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
	async getCapabilities(@Req() request: OwnerRequest): Promise<OwnerCapabilitiesResponseDto> {
		const principal = request.ownerPrincipal;
		const organization = principal?.organizations[0];
		if (
			principal?.organizations.length !== 1 ||
			organization?.status !== OrganizationStatus.ACTIVE ||
			!organization.roles.includes('owner')
		) {
			throw new ForbiddenException(OWNER_ENTITLEMENT_ERROR.organizationScopeRequired);
		}

		const evaluatedAt = new Date();
		const capabilities = await this.entitlements.listEnabled(
			{ organizationId: organization.organizationId },
			evaluatedAt,
		);
		return {
			organizationId: organization.organizationId,
			capabilities: [...capabilities],
			evaluatedAt: evaluatedAt.toISOString(),
		};
	}
}
