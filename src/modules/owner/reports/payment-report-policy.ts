import { BadRequestException } from '@nestjs/common';
import { OrganizationPaymentStatus } from '@nexcoderw/gym-db';

import { listDateRange } from '../list-date-range.js';

export interface PaymentReportStatusTotal {
	readonly status: OrganizationPaymentStatus;
	readonly count: number;
	readonly amountRwf: bigint;
}

export interface PaymentReportTotals {
	readonly paymentCount: number;
	readonly settledPaymentCount: number;
	readonly grossRwf: string;
	readonly refundedRwf: string;
	readonly netRwf: string;
}

/** Both dates are mandatory; the upper UTC bound excludes midnight after the final Kigali day. */
export function paymentReportDateRange(fromDate: string, toDate: string): { gte: Date; lt: Date } {
	if (fromDate === '' || toDate === '') {
		throw new BadRequestException('Both report dates are required.');
	}
	const range = listDateRange(fromDate, toDate);
	if (range.gte === undefined || range.lt === undefined) {
		throw new BadRequestException('Both report dates are required.');
	}
	return { gte: range.gte, lt: range.lt };
}

/**
 * A report includes every payment row, but only settled rows contribute to gross.
 * Confirmed refunds linked to those rows reduce net regardless of when the refund was recorded.
 */
export function paymentReportTotals(
	statusTotals: readonly PaymentReportStatusTotal[],
	confirmedRefundRwf: bigint,
): PaymentReportTotals {
	let paymentCount = 0;
	let settledPaymentCount = 0;
	let grossRwf = 0n;

	for (const item of statusTotals) {
		if (!Number.isSafeInteger(item.count) || item.count < 0 || item.amountRwf < 0n) {
			throw new Error('Invalid payment report aggregate.');
		}
		paymentCount += item.count;
		if (
			item.status === OrganizationPaymentStatus.CONFIRMED ||
			item.status === OrganizationPaymentStatus.PARTIALLY_REFUNDED ||
			item.status === OrganizationPaymentStatus.REFUNDED
		) {
			settledPaymentCount += item.count;
			grossRwf += item.amountRwf;
		}
	}

	if (
		!Number.isSafeInteger(paymentCount) ||
		confirmedRefundRwf < 0n ||
		confirmedRefundRwf > grossRwf
	) {
		throw new Error('Invalid payment report aggregate.');
	}

	return {
		paymentCount,
		settledPaymentCount,
		grossRwf: grossRwf.toString(),
		refundedRwf: confirmedRefundRwf.toString(),
		netRwf: (grossRwf - confirmedRefundRwf).toString(),
	};
}
