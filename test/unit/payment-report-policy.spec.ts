import { BadRequestException } from '@nestjs/common';
import { OrganizationPaymentStatus } from '@nexcoderw/gym-db';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PaymentReportQueryDto } from '../../src/modules/owner/reports/dto/payment-report.dto.js';
import {
	paymentReportDateRange,
	paymentReportTotals,
} from '../../src/modules/owner/reports/payment-report-policy.js';

describe('owner payment report contract', () => {
	it('requires both date fields and rejects unknown query fields', () => {
		const missing = plainToInstance(PaymentReportQueryDto, { fromDate: '2026-01-01' });
		expect(validateSync(missing).some((error) => error.property === 'toDate')).toBe(true);

		const unknown = plainToInstance(PaymentReportQueryDto, {
			fromDate: '2026-01-01',
			toDate: '2026-01-31',
			organizationId: 'another-gym',
		});
		expect(
			validateSync(unknown, { whitelist: true, forbidNonWhitelisted: true }).some(
				(error) => error.property === 'organizationId',
			),
		).toBe(true);
	});

	it('uses inclusive Kigali dates and rejects impossible or reversed ranges', () => {
		expect(paymentReportDateRange('2026-01-01', '2026-01-31')).toEqual({
			gte: new Date('2025-12-31T22:00:00.000Z'),
			lt: new Date('2026-01-31T22:00:00.000Z'),
		});
		expect(() => paymentReportDateRange('', '2026-01-31')).toThrow(BadRequestException);
		expect(() => paymentReportDateRange('2026-02-30', '2026-03-01')).toThrow(BadRequestException);
		expect(() => paymentReportDateRange('2026-02-01', '2026-01-31')).toThrow(BadRequestException);
	});
});

describe('owner payment report totals', () => {
	it('counts all rows but recognizes only settled money and confirmed refunds', () => {
		expect(
			paymentReportTotals(
				[
					{ status: OrganizationPaymentStatus.CONFIRMED, count: 2, amountRwf: 30_000n },
					{ status: OrganizationPaymentStatus.PARTIALLY_REFUNDED, count: 1, amountRwf: 20_000n },
					{ status: OrganizationPaymentStatus.REFUNDED, count: 1, amountRwf: 10_000n },
					{ status: OrganizationPaymentStatus.PENDING, count: 1, amountRwf: 15_000n },
					{ status: OrganizationPaymentStatus.FAILED, count: 1, amountRwf: 8_000n },
					{ status: OrganizationPaymentStatus.VOIDED, count: 1, amountRwf: 5_000n },
				],
				15_000n,
			),
		).toEqual({
			paymentCount: 7,
			settledPaymentCount: 4,
			grossRwf: '60000',
			refundedRwf: '15000',
			netRwf: '45000',
		});
	});

	it('retains exact whole-RWF totals beyond JavaScript safe integers', () => {
		expect(
			paymentReportTotals(
				[
					{
						status: OrganizationPaymentStatus.CONFIRMED,
						count: 1,
						amountRwf: 9_007_199_254_740_993n,
					},
				],
				1n,
			).netRwf,
		).toBe('9007199254740992');
	});

	it('rejects aggregates that would claim negative net revenue', () => {
		expect(() => paymentReportTotals([], 1n)).toThrow('Invalid payment report aggregate.');
	});
});
