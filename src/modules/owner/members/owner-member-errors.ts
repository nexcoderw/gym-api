import {
	BadRequestException,
	ConflictException,
	HttpException,
	NotFoundException,
	PreconditionFailedException,
	ServiceUnavailableException,
} from '@nestjs/common';

import { databaseErrorCode, databaseSqlState } from '../../../common/errors/database-error-code.js';

export function memberNotFound(): NotFoundException {
	return new NotFoundException({ code: 'MEMBER_NOT_FOUND', message: 'Member or registration not found.' });
}

export function memberConflict(code: string, message: string): ConflictException {
	return new ConflictException({ code, message });
}

export function memberPrecondition(value: string | undefined): Date {
	const timestamp = value === undefined ? undefined : /^"(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)"$/u.exec(value)?.[1];
	const date = timestamp === undefined ? null : new Date(timestamp);
	if (date === null || !Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
		throw new BadRequestException({ code: 'MEMBER_PRECONDITION_REQUIRED', message: 'Supply If-Match with the latest quoted updatedAt value.' });
	}
	return date;
}

export function staleMember(): PreconditionFailedException {
	return new PreconditionFailedException({ code: 'MEMBER_STALE', message: 'The member changed. Reload before trying again.' });
}

export function memberFailure(error: unknown): HttpException {
	if (error instanceof HttpException) return error;
	const code = databaseErrorCode(error);
	if (code === 'P2002') {
		return memberConflict('MEMBER_UNIQUE_CONFLICT', 'A member with this name or phone number already exists in this gym.');
	}
	if (code === 'P2025') return memberNotFound();
	if (code === 'P2003') return memberNotFound();
	if (databaseSqlState(error) === '23514') {
		return new BadRequestException({ code: 'MEMBER_INTEGRITY_REJECTED', message: 'The member registration does not satisfy the required contact, date or plan constraints.' });
	}
	if (code === 'P2034') return memberConflict('MEMBER_CONCURRENT_CHANGE', 'The registration changed concurrently. Reload before retrying with the same idempotency key.');
	if (databaseSqlState(error) === '23P01') return memberConflict('MEMBER_PERIOD_OVERLAP', 'This member already has a registration covering these dates.');
	return new ServiceUnavailableException({ code: 'MEMBER_PERSISTENCE_UNAVAILABLE', message: 'Member management is temporarily unavailable.' }, { cause: error });
}
