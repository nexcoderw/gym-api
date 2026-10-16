import {
	ConflictException,
	HttpException,
	ServiceUnavailableException,
	UnauthorizedException,
} from '@nestjs/common';

export function invalidOwnerEnrollment(): UnauthorizedException {
	return new UnauthorizedException({
		code: 'OWNER_ENROLLMENT_INVALID',
		message: 'This enrollment request is invalid or unavailable.',
	});
}

export function ownerEnrollmentConflict(message: string): ConflictException {
	return new ConflictException({ code: 'OWNER_ENROLLMENT_CONFLICT', message });
}

export function ownerEnrollmentFailure(error: unknown): HttpException {
	if (error instanceof HttpException) return error;
	if (typeof error === 'object' && error !== null && 'code' in error) {
		if (error.code === 'P2002') {
			return ownerEnrollmentConflict('The invited identity changed. Start again.');
		}
	}
	return new ServiceUnavailableException(
		{
			code: 'OWNER_ENROLLMENT_UNAVAILABLE',
			message: 'Owner enrollment is temporarily unavailable.',
		},
		{ cause: error },
	);
}
