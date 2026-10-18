import {
	BadRequestException,
	ConflictException,
	HttpException,
	NotFoundException,
	PreconditionFailedException,
	ServiceUnavailableException,
} from '@nestjs/common';

export function organizationNotFound(): NotFoundException {
	return new NotFoundException({
		code: 'ORGANIZATION_NOT_FOUND',
		message: 'Organization not found',
	});
}

export function staleOrganization(): PreconditionFailedException {
	return new PreconditionFailedException({
		code: 'ORGANIZATION_STALE',
		message: 'The organization changed; read it again before retrying',
	});
}

/** Domain-specific translation; raw provider errors never become client-visible messages. */
export function organizationFailure(error: unknown): HttpException {
	if (error instanceof HttpException) return error;
	if (typeof error === 'object' && error !== null && 'code' in error) {
		if (error.code === 'P2002') {
			return new ConflictException({
				code: 'ORGANIZATION_SLUG_CONFLICT',
				message: 'The organization slug is unavailable',
			});
		}
		if (error.code === 'P2025') return organizationNotFound();
		if (error.code === 'P2034') return staleOrganization();
		if (error.code === 'P2000' || error.code === 'P2004') {
			return new BadRequestException({
				code: 'ORGANIZATION_INTEGRITY_REJECTED',
				message: 'The organization data does not satisfy persistence constraints',
			});
		}
	}
	// Keep the cause internal so the exception filter can log its allowlisted machine code.
	// Never copy provider messages or metadata into the public response body.
	return new ServiceUnavailableException(
		{
			code: 'ORGANIZATION_PERSISTENCE_UNAVAILABLE',
			message: 'Organization persistence is unavailable',
		},
		{ cause: error },
	);
}
