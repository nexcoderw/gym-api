import {
	HttpException,
	Injectable,
	PayloadTooLargeException,
	ServiceUnavailableException,
} from '@nestjs/common';
import {
	OrganizationPaymentRefundStatus,
	TenantTransactionService,
	type Prisma,
} from '@nexcoderw/gym-db';

import type { OwnerPaymentContext } from '../payments/owner-payment-context.js';
import type { PaymentReportQueryDto, PaymentReportSummaryDto } from './dto/payment-report.dto.js';
import { renderPaymentReportPdf, type PaymentReportPdfRow } from './payment-report-pdf.js';
import { paymentReportDateRange, paymentReportTotals } from './payment-report-policy.js';

const PDF_BATCH_SIZE = 200;
const PDF_MAX_PAYMENTS = 10_000;
const PDF_PAYMENT_SELECT = {
	id: true,
	receiptNumber: true,
	amountRwf: true,
	method: true,
	status: true,
	occurredAt: true,
	member: { select: { name: true } },
	refunds: {
		where: { status: OrganizationPaymentRefundStatus.CONFIRMED },
		select: { amountRwf: true },
	},
} satisfies Prisma.OrganizationPaymentSelect;

type PdfPayment = Prisma.OrganizationPaymentGetPayload<{ select: typeof PDF_PAYMENT_SELECT }>;

@Injectable()
export class OwnerPaymentReportsService {
	constructor(private readonly tenants: TenantTransactionService) {}

	async pdf(context: OwnerPaymentContext, query: PaymentReportQueryDto): Promise<Buffer> {
		const occurredAt = paymentReportDateRange(query.fromDate, query.toDate);

		try {
			const report = await this.tenants.run(
				context,
				async (transaction) => {
					const organization = await transaction.organization.findUnique({
						where: { id: context.organizationId },
						select: { name: true },
					});
					if (organization === null) {
						throw new ServiceUnavailableException({ code: 'PAYMENT_REPORT_UNAVAILABLE' });
					}

					const payments: PdfPayment[] = [];
					let cursor: string | undefined;
					for (;;) {
						const batch: PdfPayment[] = await transaction.organizationPayment.findMany({
							where: { organizationId: context.organizationId, occurredAt },
							select: PDF_PAYMENT_SELECT,
							orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
							take: PDF_BATCH_SIZE + 1,
							...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
						});
						const page = batch.slice(0, PDF_BATCH_SIZE);
						payments.push(...page);
						if (payments.length > PDF_MAX_PAYMENTS) {
							throw new PayloadTooLargeException({
								code: 'PAYMENT_REPORT_TOO_LARGE',
								message: 'Choose a shorter date range for the PDF export.',
							});
						}
						if (batch.length <= PDF_BATCH_SIZE) break;
						const last = page.at(-1);
						if (last === undefined) break;
						cursor = last.id;
					}

					return { gymName: organization.name, payments };
				},
				{ maxWait: 5_000, timeout: 60_000 },
			);

			const rows = report.payments.map(pdfRow);
			const statusTotals = new Map<
				PdfPayment['status'],
				{ count: number; amountRwf: bigint }
			>();
			let confirmedRefundRwf = 0n;
			for (const row of rows) {
				const group = statusTotals.get(row.status);
				statusTotals.set(row.status, {
					count: (group?.count ?? 0) + 1,
					amountRwf: (group?.amountRwf ?? 0n) + row.amountRwf,
				});
				confirmedRefundRwf += row.refundedRwf;
			}
			const totals = paymentReportTotals(
				Array.from(statusTotals, ([status, group]) => ({ status, ...group })),
				confirmedRefundRwf,
			);
			return await renderPaymentReportPdf({
				gymName: report.gymName,
				fromDate: query.fromDate,
				toDate: query.toDate,
				generatedAt: new Date(),
				totals,
				rows,
			});
		} catch (error: unknown) {
			if (error instanceof HttpException) throw error;
			throw new ServiceUnavailableException(
				{
					code: 'PAYMENT_REPORT_UNAVAILABLE',
					message: 'The payment report is temporarily unavailable.',
				},
				{ cause: error },
			);
		}
	}

	async summary(
		context: OwnerPaymentContext,
		query: PaymentReportQueryDto,
	): Promise<PaymentReportSummaryDto> {
		const occurredAt = paymentReportDateRange(query.fromDate, query.toDate);

		try {
			return await this.tenants.run(context, async (transaction) => {
				const payments = await transaction.organizationPayment.groupBy({
					by: ['status'],
					where: { organizationId: context.organizationId, occurredAt },
					_count: { _all: true },
					_sum: { amountRwf: true },
				});
				const refunds = await transaction.organizationPaymentRefund.aggregate({
					where: {
						organizationId: context.organizationId,
						status: OrganizationPaymentRefundStatus.CONFIRMED,
						payment: { is: { organizationId: context.organizationId, occurredAt } },
					},
					_sum: { amountRwf: true },
				});
				const totals = paymentReportTotals(
					payments.map((payment) => ({
						status: payment.status,
						count: payment._count._all,
						amountRwf: payment._sum.amountRwf ?? 0n,
					})),
					refunds._sum.amountRwf ?? 0n,
				);

				return {
					fromDate: query.fromDate,
					toDate: query.toDate,
					currency: 'RWF' as const,
					...totals,
					generatedAt: new Date().toISOString(),
				};
			});
		} catch (error: unknown) {
			throw new ServiceUnavailableException(
				{
					code: 'PAYMENT_REPORT_UNAVAILABLE',
					message: 'The payment report is temporarily unavailable.',
				},
				{ cause: error },
			);
		}
	}
}

function pdfRow(payment: PdfPayment): PaymentReportPdfRow {
	return {
		receiptNumber: payment.receiptNumber,
		memberName: payment.member.name,
		occurredAt: payment.occurredAt,
		method: payment.method,
		status: payment.status,
		amountRwf: payment.amountRwf,
		refundedRwf: payment.refunds.reduce((sum, refund) => sum + refund.amountRwf, 0n),
	};
}
