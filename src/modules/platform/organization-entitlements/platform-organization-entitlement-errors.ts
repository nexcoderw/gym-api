import {
	BadRequestException,
	ConflictException,
	HttpException,
	NotFoundException,
	PreconditionFailedException,
	ServiceUnavailableException,
} from '@nestjs/common';

export function organizationEntitlementNotFound(): NotFoundException {
	return new NotFoundException({
		code: 'ORGANIZATION_NOT_FOUND',
		message: 'Organization not found',
	});
}

export function organizationEntitlementStale(): PreconditionFailedException {
	return new PreconditionFailedException({
		code: 'ORGANIZATION_ENTITLEMENT_STALE',
		message: 'The entitlement changed; read it again before retrying',
	});
}

export function organizationEntitlementArchived(): ConflictException {
	return new ConflictException({
		code: 'ORGANIZATION_ENTITLEMENT_ORGANIZATION_ARCHIVED',
		message: 'Entitlements cannot be changed for an archived organization',
	});
}

export function organizationEntitlementUnchanged(): ConflictException {
	return new ConflictException({
		code: 'ORGANIZATION_ENTITLEMENT_UNCHANGED',
		message: 'The requested entitlement state is already current',
	});
}

export function organizationEntitlementWindowInvalid(): BadRequestException {
	return new BadRequestException({
		code: 'ORGANIZATION_ENTITLEMENT_WINDOW_INVALID',
		message: 'startsAt must be earlier than expiresAt',
	});
}

export function organizationEntitlementChangeRequired(): BadRequestException {
	return new BadRequestException({
		code: 'ORGANIZATION_ENTITLEMENT_CHANGE_REQUIRED',
		message: 'Supply enabled, startsAt or expiresAt',
	});
}

export function organizationEntitlementFeatureInvalid(): BadRequestException {
	return new BadRequestException({
		code: 'ORGANIZATION_ENTITLEMENT_FEATURE_INVALID',
		message: 'The feature key is not in the reviewed entitlement catalog',
	});
}

/** Keeps database and audit details internal while preserving reviewed API errors. */
export function organizationEntitlementFailure(error: unknown): HttpException {
	if (error instanceof HttpException) return error;
	if (typeof error === 'object' && error !== null && 'code' in error) {
		if (error.code === 'P2002' || error.code === 'P2034') {
			return organizationEntitlementStale();
		}
		if (error.code === 'P2000' || error.code === 'P2004') {
			return new BadRequestException({
				code: 'ORGANIZATION_ENTITLEMENT_INTEGRITY_REJECTED',
				message: 'The entitlement does not satisfy persistence constraints',
			});
		}
	}
	return new ServiceUnavailableException(
		{
			code: 'ORGANIZATION_ENTITLEMENT_PERSISTENCE_UNAVAILABLE',
			message: 'Organization entitlement persistence is unavailable',
		},
		{ cause: error },
	);
}
