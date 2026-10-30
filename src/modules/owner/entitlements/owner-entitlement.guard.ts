import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationStatus, type OrganizationEntitlementKey } from '@nexcoderw/gym-db';

import type { OwnerRequest } from '../auth/owner-request.js';
import {
	OWNER_ENTITLEMENT_ERROR,
	OWNER_ENTITLEMENTS_METADATA,
} from './owner-entitlement.constants.js';
import { OwnerEntitlementService } from './owner-entitlement.service.js';

@Injectable()
export class OwnerEntitlementGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly entitlements: OwnerEntitlementService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const required = this.reflector.getAllAndOverride<
			readonly OrganizationEntitlementKey[] | undefined
		>(OWNER_ENTITLEMENTS_METADATA, [context.getHandler(), context.getClass()]);
		if (required === undefined || required.length === 0) {
			throw new ForbiddenException(OWNER_ENTITLEMENT_ERROR.declarationRequired);
		}

		const request = context.switchToHttp().getRequest<OwnerRequest>();
		const principal = request.ownerPrincipal;
		const organization = principal?.organizations[0];
		if (
			principal?.organizations.length !== 1 ||
			organization?.status !== OrganizationStatus.ACTIVE
		) {
			throw new ForbiddenException(OWNER_ENTITLEMENT_ERROR.organizationScopeRequired);
		}

		if (
			!(await this.entitlements.hasAllEnabled(
				{ organizationId: organization.organizationId },
				required,
			))
		) {
			throw new ForbiddenException(OWNER_ENTITLEMENT_ERROR.featureDisabled);
		}
		return true;
	}
}
