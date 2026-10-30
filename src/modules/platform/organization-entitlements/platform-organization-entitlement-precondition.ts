import { BadRequestException } from '@nestjs/common';

export function organizationEntitlementPrecondition(value: unknown): number {
	const version = typeof value === 'string' ? /^"(0|[1-9]\d{0,9})"$/u.exec(value)?.[1] : undefined;
	if (version === undefined) throw invalidPrecondition();
	const parsed = Number(version);
	if (!Number.isSafeInteger(parsed)) throw invalidPrecondition();
	return parsed;
}

function invalidPrecondition(): BadRequestException {
	return new BadRequestException({
		code: 'ORGANIZATION_ENTITLEMENT_PRECONDITION_REQUIRED',
		message: 'Supply If-Match with the quoted version from the last entitlement read',
	});
}
