import type { Prisma } from '@nexcoderw/gym-db';

import type { PaymentResponseDto } from './dto/payment-response.dto.js';

export const PAYMENT_SELECT = {
	id: true,
	receiptNumber: true,
	memberId: true,
	amountRwf: true,
	method: true,
	status: true,
	providerReference: true,
	note: true,
	occurredAt: true,
	confirmedAt: true,
	voidedAt: true,
	voidReason: true,
	createdAt: true,
	member: { select: { name: true } },
	allocations: {
		select: {
			memberSubscriptionId: true,
			amountRwf: true,
			memberSubscription: { select: { planName: true, startDate: true, endDate: true } },
		},
		orderBy: { createdAt: 'asc' },
	},
	refunds: {
		select: {
			id: true,
			amountRwf: true,
			status: true,
			reason: true,
			providerReference: true,
			createdAt: true,
		},
		orderBy: { createdAt: 'desc' },
	},
} satisfies Prisma.OrganizationPaymentSelect;

export type PaymentRow = Prisma.OrganizationPaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

export function paymentResponse(row: PaymentRow): PaymentResponseDto {
	return {
		id: row.id,
		receiptNumber: row.receiptNumber,
		memberId: row.memberId,
		memberName: row.member.name,
		amount: Number(row.amountRwf),
		currency: 'RWF',
		method: row.method,
		status: row.status,
		providerReference: row.providerReference,
		note: row.note,
		occurredAt: row.occurredAt.toISOString(),
		confirmedAt: row.confirmedAt?.toISOString() ?? null,
		voidedAt: row.voidedAt?.toISOString() ?? null,
		voidReason: row.voidReason,
		createdAt: row.createdAt.toISOString(),
		allocations: row.allocations.map((allocation) => ({
			subscriptionId: allocation.memberSubscriptionId,
			planName: allocation.memberSubscription.planName,
			amount: Number(allocation.amountRwf),
			startDate: allocation.memberSubscription.startDate.toISOString().slice(0, 10),
			endDate: allocation.memberSubscription.endDate.toISOString().slice(0, 10),
		})),
		refunds: row.refunds.map((refund) => ({
			id: refund.id,
			amount: Number(refund.amountRwf),
			status: refund.status,
			reason: refund.reason,
			providerReference: refund.providerReference,
			createdAt: refund.createdAt.toISOString(),
		})),
	};
}
