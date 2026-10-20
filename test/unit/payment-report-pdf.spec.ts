import { OrganizationPaymentMethod, OrganizationPaymentStatus } from '@nexcoderw/gym-db';

import { renderPaymentReportPdf } from '../../src/modules/owner/reports/payment-report-pdf.js';

const ROW = {
	receiptNumber: 'PAY-20260101-EXAMPLE',
	memberName: 'Example Member',
	occurredAt: new Date('2026-01-01T09:00:00.000Z'),
	method: OrganizationPaymentMethod.CASH,
	status: OrganizationPaymentStatus.PARTIALLY_REFUNDED,
	amountRwf: 15_000n,
	refundedRwf: 2_000n,
};

const INPUT = {
	gymName: 'Soho Gym',
	fromDate: '2026-01-01',
	toDate: '2026-01-31',
	generatedAt: new Date('2026-02-01T08:00:00.000Z'),
	totals: {
		paymentCount: 1,
		settledPaymentCount: 1,
		grossRwf: '15000',
		refundedRwf: '2000',
		netRwf: '13000',
	},
	rows: [ROW],
};

describe('payment report PDF', () => {
	it('creates a valid PDF for an empty report', async () => {
		const pdf = await renderPaymentReportPdf({
			...INPUT,
			totals: {
				paymentCount: 0,
				settledPaymentCount: 0,
				grossRwf: '0',
				refundedRwf: '0',
				netRwf: '0',
			},
			rows: [],
		});
		expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
		expect(pdf.length).toBeGreaterThan(1_000);
	});

	it('creates multiple report pages without dropping rows', async () => {
		const rows = Array.from({ length: 120 }, (_, index) => ({
			...ROW,
			receiptNumber: `PAY-20260101-${String(index).padStart(4, '0')}`,
		}));
		const pdf = await renderPaymentReportPdf({
			...INPUT,
			totals: {
				paymentCount: rows.length,
				settledPaymentCount: rows.length,
				grossRwf: '1800000',
				refundedRwf: '240000',
				netRwf: '1560000',
			},
			rows,
		});
		expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
		expect((pdf.toString('latin1').match(/\/Type \/Page\b/gu) ?? []).length).toBeGreaterThan(1);
	});
});
