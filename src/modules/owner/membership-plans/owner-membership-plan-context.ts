import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { OrganizationStatus } from '@nexcoderw/gym-db';

import { OWNER_AUTH_ERROR } from '../auth/owner-auth.constants.js';
import type { OwnerOrganizationAccess } from '../auth/owner-auth.types.js';
import type { OwnerRequest } from '../auth/owner-request.js';

/** Resolves one authorized tenant after OwnerSessionGuard has constrained production subdomains. */
export function ownerMembershipPlanOrganization(
	request: Pick<OwnerRequest, 'ownerPrincipal'>,
): OwnerOrganizationAccess {
	const principal = request.ownerPrincipal;
	if (principal === undefined) throw new UnauthorizedException(OWNER_AUTH_ERROR.invalidSession);
	if (principal.organizations.length !== 1) {
		throw new ForbiddenException({
			code: 'OWNER_ORGANIZATION_CONTEXT_REQUIRED',
			message: 'A single organization context is required.',
		});
	}
	const organization = principal.organizations[0];
	if (organization === undefined || !organization.roles.includes('owner')) {
		throw new ForbiddenException({
			code: 'MEMBERSHIP_PLAN_ACCESS_DENIED',
			message: 'Membership plan access is not permitted.',
		});
	}
	if (organization.status !== OrganizationStatus.ACTIVE) {
		throw new ForbiddenException({
			code: 'OWNER_ORGANIZATION_INACTIVE',
			message: 'Membership plans are unavailable until the organization is active.',
		});
	}
	return organization;
}
