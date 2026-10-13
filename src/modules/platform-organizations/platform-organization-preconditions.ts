import { BadRequestException } from '@nestjs/common';

export function organizationPrecondition(value: unknown): Date {
	const timestamp =
		typeof value === 'string'
			? /^"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)"$/u.exec(value)?.[1]
			: undefined;
	if (timestamp === undefined) throw invalidPrecondition();
	const date = new Date(timestamp);
	if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp)
		throw invalidPrecondition();
	return date;
}

function invalidPrecondition(): BadRequestException {
	return new BadRequestException({
		code: 'ORGANIZATION_PRECONDITION_REQUIRED',
		message: 'Supply If-Match with the quoted updatedAt value from the last organization read',
	});
}
