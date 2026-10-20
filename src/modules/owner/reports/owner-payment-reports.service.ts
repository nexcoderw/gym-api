import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { OrganizationPaymentRefundStatus, TenantTransactionService } from '@nexcoderw/gym-db';

import type { OwnerPaymentContext } from '../payments/owner-payment-context.js';
import type { PaymentReportQueryDto, PaymentReportSummaryDto } from './dto/payment-report.dto.js';
import { paymentReportDateRange, paymentReportTotals } from './payment-report-policy.js';

@Injectable()
export class OwnerPaymentReportsService {
	constructor(private readonly tenants: TenantTransactionService) {}

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
