import {
	BadRequestException,
	ConflictException,
	HttpException,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';

import { databaseErrorCode, databaseSqlState } from '../../../common/errors/database-error-code.js';

export function paymentNotFound(): NotFoundException {
	return new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment was not found.' });
}

export function paymentConflict(code: string, message: string): ConflictException {
	return new ConflictException({ code, message });
}

export function paymentFailure(error: unknown): HttpException {
	if (error instanceof HttpException) return error;
	const code = databaseErrorCode(error);
	if (code === 'P2025' || code === 'P2003') return paymentNotFound();
	if (code === 'P2002') {
		const target = databaseUniqueTarget(error);
		if (target.some((field) => field === 'name' || field === 'phone_number' || field === 'phoneNumber')) {
			return paymentConflict(
				'MEMBER_UNIQUE_CONFLICT',
				'A member with this name or phone number already exists. Choose that member instead.',
			);
		}
		return paymentConflict(
			'PAYMENT_UNIQUE_CONFLICT',
			'This payment command or provider reference was already recorded.',
		);
	}
	if (databaseSqlState(error) === '23514') {
		return new BadRequestException({
			code: 'PAYMENT_INTEGRITY_REJECTED',
			message: 'The payment does not satisfy the required amount, state, or audit constraints.',
		});
	}
	if (code === 'P2034') {
		return paymentConflict(
			'PAYMENT_CONCURRENT_CHANGE',
			'The payment changed concurrently. Reload before retrying with the same idempotency key.',
		);
	}
	if (databaseSqlState(error) === '23P01') {
		return paymentConflict(
			'PAYMENT_MEMBER_PERIOD_OVERLAP',
			'This member already has a registration covering these dates.',
		);
	}
	return new ServiceUnavailableException(
		{
			code: 'PAYMENT_PERSISTENCE_UNAVAILABLE',
			message: 'Payment management is temporarily unavailable.',
		},
		{ cause: error },
	);
}

function databaseUniqueTarget(error: unknown): string[] {
	if (typeof error !== 'object' || error === null || !('meta' in error)) return [];
	const meta = error.meta;
	if (typeof meta !== 'object' || meta === null || !('target' in meta)) return [];
	const target = meta.target;
	return Array.isArray(target) ? target.filter((value): value is string => typeof value === 'string') : [];
}
