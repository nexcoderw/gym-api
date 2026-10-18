import {
	BadRequestException,
	ConflictException,
	HttpException,
	NotFoundException,
	PreconditionFailedException,
	ServiceUnavailableException,
} from '@nestjs/common';

export function membershipPlanNotFound(): NotFoundException {
	return new NotFoundException({
		code: 'MEMBERSHIP_PLAN_NOT_FOUND',
		message: 'Membership plan not found.',
	});
}

export function staleMembershipPlan(): PreconditionFailedException {
	return new PreconditionFailedException({
		code: 'MEMBERSHIP_PLAN_STALE',
		message: 'The membership plan changed; read it again before retrying.',
	});
}

/** Maps persistence failures without exposing provider messages, SQL or constraint metadata. */
export function membershipPlanFailure(error: unknown): HttpException {
	if (error instanceof HttpException) return error;
	if (typeof error === 'object' && error !== null && 'code' in error) {
		if (error.code === 'P2002') {
			return new ConflictException({
				code: 'MEMBERSHIP_PLAN_NAME_CONFLICT',
				message: 'A membership plan with this name already exists.',
			});
		}
		if (error.code === 'P2025') return membershipPlanNotFound();
		if (error.code === 'P2034') return staleMembershipPlan();
		if (error.code === 'P2000' || error.code === 'P2004') {
			return new BadRequestException({
				code: 'MEMBERSHIP_PLAN_INTEGRITY_REJECTED',
				message: 'The membership plan does not satisfy persistence constraints.',
			});
		}
	}
	return new ServiceUnavailableException(
		{
			code: 'MEMBERSHIP_PLAN_PERSISTENCE_UNAVAILABLE',
			message: 'Membership plan persistence is temporarily unavailable.',
		},
		{ cause: error },
	);
}
