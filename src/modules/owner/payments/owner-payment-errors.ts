import {
	BadRequestException,
	ConflictException,
	HttpException,
	Logger,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';

import { databaseErrorCode, databaseSqlState } from '../../../common/errors/database-error-code.js';

const PAYMENT_CONSTRAINTS = new Set([
	'payments_receipt_format_check',
	'payments_amount_range_check',
	'payments_fingerprint_check',
	'payments_provider_reference_check',
	'payments_note_nonblank_check',
	'payments_occurred_at_check',
	'payments_timestamp_order_check',
	'payments_lifecycle_check',
	'organization_payment_history_guard',
	'organization_payment_lifecycle_guard',
	'organization_payment_status_guard',
	'payment_allocations_amount_range_check',
	'payment_allocation_history_guard',
	'payment_allocation_balance_guard',
	'payment_refunds_amount_range_check',
	'payment_refunds_reason_nonblank_check',
	'payment_refunds_provider_reference_check',
	'payment_refunds_fingerprint_check',
	'payment_refunds_timestamp_order_check',
	'payment_refunds_lifecycle_check',
	'payment_refund_history_guard',
	'payment_refund_lifecycle_guard',
	'payment_refund_balance_guard',
	'payment_audit_request_id_nonblank_check',
	'payment_audit_fingerprint_check',
	'payment_audit_timestamp_order_check',
	'payment_audit_action_check',
	'payment_audit_history_guard',
]);

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

		if (
			target.some(
				(field) => field === 'name' || field === 'phone_number' || field === 'phoneNumber',
			)
		) {
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
		Logger.warn(
			`Payment database constraint rejected: ${paymentConstraintName(error)}`,
			'PaymentIntegrity',
		);

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

	return Array.isArray(target)
		? target.filter((value): value is string => typeof value === 'string')
		: [];
}

/**
 * Only allow known schema constraint names in operational diagnostics.
 * Never log raw database error messages, SQL, or request contents.
 */
function paymentConstraintName(error: unknown): string {
	if (typeof error !== 'object' || error === null || !('meta' in error)) {
		return 'unknown';
	}

	const meta = error.meta;

	if (typeof meta !== 'object' || meta === null || !('driverAdapterError' in meta)) {
		return 'unknown';
	}

	const adapter = meta.driverAdapterError;

	if (typeof adapter !== 'object' || adapter === null || !('cause' in adapter)) {
		return 'unknown';
	}

	const cause = adapter.cause;

	if (typeof cause !== 'object' || cause === null) {
		return 'unknown';
	}

	for (const field of ['constraint', 'constraintName', 'constraint_name']) {
		if (!(field in cause)) continue;

		const value = cause[field];

		if (typeof value === 'string' && PAYMENT_CONSTRAINTS.has(value)) {
			return value;
		}
	}

	return 'unknown';
}
