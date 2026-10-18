import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { OrganizationStatus } from '@nexcoderw/gym-db';

import type { OwnerRequest } from '../auth/owner-request.js';

export interface OwnerMemberContext {
	readonly organizationId: string;
	readonly actorUserId: string;
}

export function ownerMemberContext(request: OwnerRequest): OwnerMemberContext {
	const principal = request.ownerPrincipal;
	if (principal === undefined) throw new UnauthorizedException();
	const organization = principal.organizations[0];
	if (
		principal.organizations.length !== 1 ||
		organization?.status !== OrganizationStatus.ACTIVE ||
		!organization.roles.includes('owner')
	) {
		throw new ForbiddenException({
			code: 'MEMBER_ACCESS_DENIED',
			message: 'Active gym owner access is required.',
		});
	}
	return { organizationId: organization.organizationId, actorUserId: principal.userId };
}
