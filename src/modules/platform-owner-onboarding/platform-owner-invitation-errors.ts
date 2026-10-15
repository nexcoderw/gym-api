import {
	BadRequestException,
	ConflictException,
	HttpException,
	ServiceUnavailableException,
} from '@nestjs/common';

export function ownerInvitationConcurrentChange(): ConflictException {
	return new ConflictException({
		code: 'OWNER_INVITATION_CONCURRENT_CHANGE',
		message: 'The invitation changed before this operation completed',
	});
}

/** Domain translation keeps Prisma, PostgreSQL and schema details out of public responses. */
export function ownerInvitationFailure(error: unknown): HttpException {
	if (error instanceof HttpException) return error;
	if (typeof error === 'object' && error !== null && 'code' in error) {
		if (error.code === 'P2002') {
			return new ConflictException({
				code: 'OWNER_INVITATION_OUTSTANDING_CONFLICT',
				message: 'An outstanding owner invitation already exists for this email',
			});
		}
		if (error.code === 'P2000' || error.code === 'P2004') {
			return new BadRequestException({
				code: 'OWNER_INVITATION_INTEGRITY_REJECTED',
				message: 'The invitation does not satisfy persistence constraints',
			});
		}
	}
	return new ServiceUnavailableException(
		{
			code: 'OWNER_INVITATION_PERSISTENCE_UNAVAILABLE',
			message: 'Owner invitation persistence is unavailable',
		},
		{ cause: error },
	);
}
