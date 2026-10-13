import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import {
	ApiCookieAuth,
	ApiForbiddenResponse,
	ApiInternalServerErrorResponse,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
	ApiTooManyRequestsResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto.js';
import { PlatformPermissionGuard } from '../platform-auth/platform-permission.guard.js';
import { RequirePlatformPermissions } from '../platform-auth/platform-permissions.decorator.js';
import { PlatformSessionGuard } from '../platform-auth/platform-session.guard.js';
import { PlatformDashboardSummaryDto } from './dto/platform-dashboard-summary.dto.js';
import { PlatformDashboardService } from './platform-dashboard.service.js';

@ApiTags('Platform dashboard')
@ApiCookieAuth('platform-session')
@UseGuards(PlatformSessionGuard, PlatformPermissionGuard)
@Controller('platform/dashboard')
export class PlatformDashboardController {
	constructor(private readonly dashboard: PlatformDashboardService) {}

	@Get('summary')
	@Header('Cache-Control', 'no-store')
	@RequirePlatformPermissions('platform.dashboard.read')
	@ApiOperation({
		summary: 'Read the platform administration dashboard summary',
		description:
			'Requires a valid MFA-authenticated platform session and the live platform.dashboard.read permission. Returns one consistent snapshot of global identity accounts, platform staff assignment statuses, roles, and registered permissions. Counts do not represent gym members, logged-in administrators, or fully authorized users. No gym, subscription, payment, or revenue metrics exist in this response. Tenant identifiers and client-supplied roles grant no access.',
	})
	@ApiOkResponse({
		description: 'Aggregate-only platform statistics. Example counts are fictional.',
		type: PlatformDashboardSummaryDto,
		headers: {
			'Cache-Control': { schema: { type: 'string', example: 'no-store' } },
		},
		example: {
			generatedAt: '2026-10-13T08:00:00.000Z',
			globalUsers: { total: 1 },
			platformStaff: { total: 1, pending: 0, active: 1, suspended: 0, revoked: 0 },
			platformRoles: { total: 1 },
			platformPermissions: { total: 1 },
		},
	})
	@ApiUnauthorizedResponse({
		description: 'The session or administrator eligibility is invalid, expired, or revoked.',
		type: ApiErrorResponseDto,
	})
	@ApiForbiddenResponse({
		description: 'The validated platform session lacks platform.dashboard.read.',
		type: ApiErrorResponseDto,
	})
	@ApiTooManyRequestsResponse({
		description: 'The caller exceeded the existing global request limit.',
		type: ApiErrorResponseDto,
	})
	@ApiInternalServerErrorResponse({
		description: 'A safe internal error; no database details or stack traces are returned.',
		type: ApiErrorResponseDto,
	})
	async getSummary(): Promise<PlatformDashboardSummaryDto> {
		return await this.dashboard.getSummary();
	}
}
