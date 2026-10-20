import { createHash, randomUUID } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import {
	OrganizationPaymentAuditAction,
	OrganizationPaymentMethod,
	OrganizationPaymentRefundStatus,
	OrganizationPaymentStatus,
	TenantTransactionService,
	type Prisma,
} from '@nexcoderw/gym-db';

import { databaseErrorCode } from '../../../common/errors/database-error-code.js';
import { listDateRange } from '../list-date-range.js';
import { memberName, memberPhone } from '../members/member-normalization.js';
import { memberPeriod } from '../members/member-period.js';
import { registerMemberPlan } from '../members/member-plan-registration.js';
import type { CreatePaymentDto } from './dto/create-payment.dto.js';
import type { RegisterPaymentDto } from './dto/register-payment.dto.js';
import { PaymentOrder, type ListPaymentsQueryDto } from './dto/list-payments-query.dto.js';
import type { CreatePaymentRefundDto, VoidPaymentDto } from './dto/payment-command.dto.js';
import type { PaymentListResponseDto, PaymentResponseDto } from './dto/payment-response.dto.js';
import type { OwnerPaymentContext } from './owner-payment-context.js';
import { paymentConflict, paymentFailure, paymentNotFound } from './owner-payment-errors.js';
import { PAYMENT_SELECT, paymentResponse, type PaymentRow } from './owner-payment-mapping.js';

@Injectable()
export class OwnerPaymentsService {
	constructor(private readonly tenants: TenantTransactionService) {}

	async list(
		context: OwnerPaymentContext,
		query: ListPaymentsQueryDto,
	): Promise<PaymentListResponseDto> {
		try {
			return await this.tenants.run(context, async (transaction) => {
				const where = paymentWhere(context.organizationId, query);

				if (query.cursor !== undefined) {
					const cursor = await transaction.organizationPayment.findFirst({
						where: { ...where, id: query.cursor },
						select: { id: true },
					});

					if (cursor === null) throw invalidCursor();
				}

				const rows = await transaction.organizationPayment.findMany({
					where,
					select: PAYMENT_SELECT,
					orderBy: paymentOrder(query.order),
					take: query.limit + 1,
					...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
				});

				const page = rows.slice(0, query.limit);

				return {
					items: page.map(paymentResponse),
					nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
				};
			});
		} catch (error: unknown) {
			throw paymentFailure(error);
		}
	}

	async get(context: OwnerPaymentContext, paymentId: string): Promise<PaymentResponseDto> {
		try {
			return await this.tenants.run(context, async (transaction) => {
				const payment = await findPayment(transaction, context.organizationId, paymentId);

				if (payment === null) throw paymentNotFound();

				return paymentResponse(payment);
			});
		} catch (error: unknown) {
			throw paymentFailure(error);
		}
	}

	async create(
		context: OwnerPaymentContext,
		input: CreatePaymentDto,
		idempotencyKey: string,
	): Promise<PaymentResponseDto> {
		const occurredAt = paymentDate(input.occurredAt);
		const providerReference = paymentProviderReference(input.method, input.providerReference);
		const note = input.note?.trim();

		const fingerprint = requestFingerprint([
			'record',
			input.memberId,
			input.subscriptionId,
			input.amount,
			input.method,
			occurredAt.toISOString(),
			providerReference,
			note ?? null,
		]);

		try {
			return await this.tenants.run(context, async (transaction) => {
				const replay = await paymentReplay(
					transaction,
					context.organizationId,
					idempotencyKey,
					fingerprint,
				);

				if (replay !== null) return paymentResponse(replay);

				return paymentResponse(
					await recordPayment(transaction, context, {
						memberId: input.memberId,
						subscriptionId: input.subscriptionId,
						amount: input.amount,
						method: input.method,
						providerReference,
						note,
						occurredAt,
						idempotencyKey,
						fingerprint,
					}),
				);
			});
		} catch (error: unknown) {
			if (databaseErrorCode(error) === 'P2002') {
				const replay = await this.replayPayment(context, idempotencyKey, fingerprint);

				if (replay !== null) return replay;
			}

			throw paymentFailure(error);
		}
	}

	/** Creates the profile, registration and payment in one tenant transaction. */
	async registerPayment(
		context: OwnerPaymentContext,
		input: RegisterPaymentDto,
		idempotencyKey: string,
	): Promise<PaymentResponseDto> {
		if ((input.memberId === undefined) === (input.member === undefined)) {
			throw new BadRequestException({
				code: 'PAYMENT_MEMBER_REQUIRED',
				message: 'Choose an existing member or enter a new member, but not both.',
			});
		}

		memberPeriod(
			input.subscription.startDate,
			input.subscription.periodUnit,
			input.subscription.periodCount,
		);

		const requestedOccurredAt = paymentDate(input.occurredAt);
		const providerReference = paymentProviderReference(input.method, input.providerReference);
		const note = input.note?.trim();

		const profile =
			input.member === undefined
				? null
				: {
						...memberName(input.member.name),
						phoneNumber: memberPhone(input.member.phoneNumber),
						email: input.member.email ?? null,
					};

		const fingerprint = requestFingerprint([
			'register-payment',
			input.memberId ?? null,
			profile?.normalizedName ?? null,
			profile?.phoneNumber ?? null,
			profile?.email ?? null,
			input.subscription.membershipPlanId,
			input.subscription.startDate,
			input.subscription.periodUnit,
			input.subscription.periodCount,
			input.method,
			requestedOccurredAt.toISOString(),
			providerReference,
			note ?? null,
		]);

		try {
			return await this.tenants.run(
				context,
				async (transaction) => {
					const replay = await paymentReplay(
						transaction,
						context.organizationId,
						idempotencyKey,
						fingerprint,
					);

					if (replay !== null) return paymentResponse(replay);

					let memberId: string;

					if (profile === null) {
						if (input.memberId === undefined) {
							throw new BadRequestException({ code: 'PAYMENT_MEMBER_REQUIRED' });
						}

						memberId = input.memberId;
					} else {
						const member = await transaction.organizationMember.create({
							data: { organizationId: context.organizationId, ...profile },
							select: { id: true },
						});

						memberId = member.id;
					}

					const subscription = await registerMemberPlan(
						transaction,
						context,
						memberId,
						input.subscription,
						idempotencyKey,
						fingerprint,
					);

					if (subscription.price < 1) {
						throw paymentConflict(
							'PAYMENT_FREE_PLAN',
							'A free membership plan cannot be recorded as a payment.',
						);
					}

					return paymentResponse(
						await recordPayment(transaction, context, {
							memberId,
							subscriptionId: subscription.id,
							amount: subscription.price,
							method: input.method,
							providerReference,
							note,

							// The requested timestamp remains part of the immutable
							// idempotency fingerprint. The actual registration payment
							// uses the database clock to satisfy financial constraints.
							occurredAt: requestedOccurredAt,
							useDatabaseOccurredAt: true,

							idempotencyKey,
							fingerprint,
						}),
					);
				},
				{ maxWait: 5_000, timeout: 20_000 },
			);
		} catch (error: unknown) {
			if (databaseErrorCode(error) === 'P2002') {
				const replay = await this.replayPayment(context, idempotencyKey, fingerprint);

				if (replay !== null) return replay;
			}

			throw paymentFailure(error);
		}
	}

	async void(
		context: OwnerPaymentContext,
		paymentId: string,
		input: VoidPaymentDto,
		idempotencyKey: string,
	): Promise<PaymentResponseDto> {
		const reason = input.reason.trim();
		const fingerprint = requestFingerprint(['void', paymentId, reason]);

		return this.command(context, idempotencyKey, fingerprint, async (transaction) => {
			const locked = await lockPayment(transaction, context.organizationId, paymentId);

			if (
				locked.status !== OrganizationPaymentStatus.PENDING &&
				locked.status !== OrganizationPaymentStatus.CONFIRMED
			) {
				throw paymentConflict(
					'PAYMENT_CANNOT_BE_VOIDED',
					'Only pending or confirmed payments can be voided.',
				);
			}

			const refund = await transaction.organizationPaymentRefund.findFirst({
				where: { organizationId: context.organizationId, paymentId },
				select: { id: true },
			});

			if (refund !== null) {
				throw paymentConflict(
					'PAYMENT_HAS_REFUNDS',
					'A payment with a refund record cannot be voided.',
				);
			}

			const now = new Date();

			const payment = await transaction.organizationPayment.update({
				where: { organizationId_id: { organizationId: context.organizationId, id: paymentId } },
				data: {
					status: OrganizationPaymentStatus.VOIDED,
					voidedAt: now,
					voidedByUserId: context.actorUserId,
					voidReason: reason,
				},
				select: PAYMENT_SELECT,
			});

			await createAudit(transaction, context, {
				paymentId,
				action: OrganizationPaymentAuditAction.PAYMENT_VOIDED,
				idempotencyKey,
				fingerprint,
				previousStatus: locked.status,
				resultingStatus: OrganizationPaymentStatus.VOIDED,
				now,
			});

			return payment;
		});
	}

	async refund(
		context: OwnerPaymentContext,
		paymentId: string,
		input: CreatePaymentRefundDto,
		idempotencyKey: string,
	): Promise<PaymentResponseDto> {
		const reason = input.reason.trim();
		const fingerprint = requestFingerprint(['refund', paymentId, input.amount, reason]);

		return this.command(context, idempotencyKey, fingerprint, async (transaction) => {
			const locked = await lockPayment(transaction, context.organizationId, paymentId);

			if (locked.method !== OrganizationPaymentMethod.CASH) {
				throw paymentConflict(
					'PAYMENT_REFUND_METHOD_UNAVAILABLE',
					'External refunds require a verified provider workflow that is not enabled.',
				);
			}

			if (
				locked.status !== OrganizationPaymentStatus.CONFIRMED &&
				locked.status !== OrganizationPaymentStatus.PARTIALLY_REFUNDED
			) {
				throw paymentConflict(
					'PAYMENT_CANNOT_BE_REFUNDED',
					'Only confirmed cash payments can be refunded.',
				);
			}

			const refunded = await transaction.organizationPaymentRefund.aggregate({
				where: {
					organizationId: context.organizationId,
					paymentId,
					status: OrganizationPaymentRefundStatus.CONFIRMED,
				},
				_sum: { amountRwf: true },
			});

			const total = (refunded._sum.amountRwf ?? 0n) + BigInt(input.amount);

			if (total > locked.amountRwf) {
				throw paymentConflict(
					'PAYMENT_REFUND_EXCEEDS_BALANCE',
					'The refund exceeds the remaining payment amount.',
				);
			}

			const now = new Date();

			const status =
				total === locked.amountRwf
					? OrganizationPaymentStatus.REFUNDED
					: OrganizationPaymentStatus.PARTIALLY_REFUNDED;

			const refund = await transaction.organizationPaymentRefund.create({
				data: {
					organizationId: context.organizationId,
					paymentId,
					memberId: locked.memberId,
					amountRwf: input.amount,
					status: OrganizationPaymentRefundStatus.CONFIRMED,
					reason,
					idempotencyKey,
					requestFingerprint: fingerprint,
					requestedByUserId: context.actorUserId,
					confirmedAt: now,
				},
				select: { id: true },
			});

			const payment = await transaction.organizationPayment.update({
				where: { organizationId_id: { organizationId: context.organizationId, id: paymentId } },
				data: { status },
				select: PAYMENT_SELECT,
			});

			await createAudit(transaction, context, {
				paymentId,
				refundId: refund.id,
				action: OrganizationPaymentAuditAction.REFUND_RECORDED,
				idempotencyKey,
				fingerprint,
				previousStatus: locked.status,
				resultingStatus: status,
				now,
			});

			return payment;
		});
	}

	private async command(
		context: OwnerPaymentContext,
		idempotencyKey: string,
		fingerprint: string,
		operation: (transaction: Prisma.TransactionClient) => Promise<PaymentRow>,
	): Promise<PaymentResponseDto> {
		try {
			const row = await this.tenants.run(context, async (transaction) => {
				const replay = await auditReplay(
					transaction,
					context.organizationId,
					idempotencyKey,
					fingerprint,
				);

				return replay ?? operation(transaction);
			});

			return paymentResponse(row);
		} catch (error: unknown) {
			if (databaseErrorCode(error) === 'P2002') {
				try {
					const replay = await this.tenants.run(context, (transaction) =>
						auditReplay(transaction, context.organizationId, idempotencyKey, fingerprint),
					);

					if (replay !== null) return paymentResponse(replay);
				} catch (replayError: unknown) {
					throw paymentFailure(replayError);
				}
			}

			throw paymentFailure(error);
		}
	}

	private async replayPayment(
		context: OwnerPaymentContext,
		idempotencyKey: string,
		fingerprint: string,
	): Promise<PaymentResponseDto | null> {
		try {
			return await this.tenants.run(context, async (transaction) => {
				const replay = await paymentReplay(
					transaction,
					context.organizationId,
					idempotencyKey,
					fingerprint,
				);

				return replay === null ? null : paymentResponse(replay);
			});
		} catch (error: unknown) {
			throw paymentFailure(error);
		}
	}
}

async function recordPayment(
	transaction: Prisma.TransactionClient,
	context: OwnerPaymentContext,
	input: {
		memberId: string;
		subscriptionId: string;
		amount: number;
		method: OrganizationPaymentMethod;
		providerReference: string | null;
		note: string | undefined;
		occurredAt: Date;
		useDatabaseOccurredAt?: boolean;
		idempotencyKey: string;
		fingerprint: string;
	},
): Promise<PaymentRow> {
	const subscription = await lockSubscription(
		transaction,
		context.organizationId,
		input.memberId,
		input.subscriptionId,
	);

	const allocated = await transaction.organizationPaymentAllocation.aggregate({
		where: {
			organizationId: context.organizationId,
			memberSubscriptionId: input.subscriptionId,
			payment: {
				status: { notIn: [OrganizationPaymentStatus.FAILED, OrganizationPaymentStatus.VOIDED] },
			},
		},
		_sum: { amountRwf: true },
	});

	if ((allocated._sum.amountRwf ?? 0n) + BigInt(input.amount) > subscription.price_rwf) {
		throw paymentConflict(
			'PAYMENT_EXCEEDS_BALANCE',
			'This amount is greater than the remaining registration balance.',
		);
	}

	// Use the database clock for financial event timestamps.
	// This avoids mixing the API server clock with PostgreSQL-generated values.
	const timestamps = await transaction.$queryRaw<{ recordedAt: Date }[]>`
		SELECT clock_timestamp() AS "recordedAt"
	`;

	const now = timestamps[0]?.recordedAt;

	if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
		throw new Error('The database did not provide a valid timestamp.');
	}

	const status =
		input.method === OrganizationPaymentMethod.CASH
			? OrganizationPaymentStatus.CONFIRMED
			: OrganizationPaymentStatus.PENDING;

	const paymentId = randomUUID();

	const payment = await transaction.organizationPayment.create({
		data: {
			id: paymentId,
			organizationId: context.organizationId,
			memberId: input.memberId,
			receiptNumber: receiptNumber(paymentId, now),
			amountRwf: input.amount,
			method: input.method,
			status,
			providerReference: input.providerReference,
			note: input.note,
			occurredAt: input.useDatabaseOccurredAt ? now : input.occurredAt,
			confirmedAt: status === OrganizationPaymentStatus.CONFIRMED ? now : null,
			createdAt: now,
			updatedAt: now,
			idempotencyKey: input.idempotencyKey,
			requestFingerprint: input.fingerprint,
			recordedByUserId: context.actorUserId,
			allocations: {
				create: {
					memberSubscriptionId: input.subscriptionId,
					amountRwf: input.amount,
				},
			},
		},
		select: PAYMENT_SELECT,
	});

	await transaction.organizationPaymentAuditEvent.create({
		data: {
			organizationId: context.organizationId,
			paymentId: payment.id,
			actorUserId: context.actorUserId,
			action: OrganizationPaymentAuditAction.PAYMENT_RECORDED,
			requestId: context.requestId,
			idempotencyKey: input.idempotencyKey,
			requestFingerprint: input.fingerprint,
			resultingStatus: status,
			occurredAt: now,
		},
	});

	return payment;
}

function paymentWhere(
	organizationId: string,
	query: ListPaymentsQueryDto,
): Prisma.OrganizationPaymentWhereInput {
	const dateRange = listDateRange(query.fromDate, query.toDate);
	return {
		organizationId,
		...(query.search === undefined
			? {}
			: {
					OR: [
						{ member: { is: { name: { contains: query.search, mode: 'insensitive' } } } },
						{ receiptNumber: { contains: query.search, mode: 'insensitive' } },
						{ providerReference: { contains: query.search, mode: 'insensitive' } },
					],
				}),
		...(query.status === undefined ? {} : { status: query.status }),
		...(query.method === undefined ? {} : { method: query.method }),
		...(query.memberId === undefined ? {} : { memberId: query.memberId }),
		...(Object.keys(dateRange).length ? { occurredAt: dateRange } : {}),
	};
}

function paymentOrder(order: PaymentOrder): Prisma.OrganizationPaymentOrderByWithRelationInput[] {
	if (order === PaymentOrder.OLDEST) return [{ occurredAt: 'asc' }, { id: 'asc' }];
	if (order === PaymentOrder.AMOUNT_HIGH) return [{ amountRwf: 'desc' }, { id: 'asc' }];
	if (order === PaymentOrder.AMOUNT_LOW) return [{ amountRwf: 'asc' }, { id: 'asc' }];

	return [{ occurredAt: 'desc' }, { id: 'asc' }];
}

async function findPayment(
	transaction: Prisma.TransactionClient,
	organizationId: string,
	paymentId: string,
): Promise<PaymentRow | null> {
	return transaction.organizationPayment.findFirst({
		where: { organizationId, id: paymentId },
		select: PAYMENT_SELECT,
	});
}

async function paymentReplay(
	transaction: Prisma.TransactionClient,
	organizationId: string,
	idempotencyKey: string,
	fingerprint: string,
): Promise<PaymentRow | null> {
	const row = await transaction.organizationPayment.findFirst({
		where: { organizationId, idempotencyKey },
		select: { ...PAYMENT_SELECT, requestFingerprint: true },
	});

	if (row === null) return null;

	if (row.requestFingerprint !== fingerprint) {
		throw paymentConflict(
			'PAYMENT_IDEMPOTENCY_CONFLICT',
			'This idempotency key was already used for a different payment command.',
		);
	}

	return row;
}

async function auditReplay(
	transaction: Prisma.TransactionClient,
	organizationId: string,
	idempotencyKey: string,
	fingerprint: string,
): Promise<PaymentRow | null> {
	const row = await transaction.organizationPaymentAuditEvent.findFirst({
		where: { organizationId, idempotencyKey },
		select: { requestFingerprint: true, payment: { select: PAYMENT_SELECT } },
	});

	if (row === null) return null;

	if (row.requestFingerprint !== fingerprint) {
		throw paymentConflict(
			'PAYMENT_IDEMPOTENCY_CONFLICT',
			'This idempotency key was already used for a different payment command.',
		);
	}

	return row.payment;
}

async function lockSubscription(
	transaction: Prisma.TransactionClient,
	organizationId: string,
	memberId: string,
	subscriptionId: string,
): Promise<{ id: string; price_rwf: bigint }> {
	const rows = await transaction.$queryRaw<{ id: string; price_rwf: bigint }[]>`
		SELECT id, price_rwf FROM public.organization_member_subscriptions
		WHERE organization_id = ${organizationId}::uuid
			AND member_id = ${memberId}::uuid
			AND id = ${subscriptionId}::uuid
			AND cancelled_at IS NULL
		FOR UPDATE
	`;

	const row = rows[0];

	if (row === undefined) throw paymentNotFound();

	return row;
}

async function lockPayment(
	transaction: Prisma.TransactionClient,
	organizationId: string,
	paymentId: string,
): Promise<{
	id: string;
	memberId: string;
	amountRwf: bigint;
	method: OrganizationPaymentMethod;
	status: OrganizationPaymentStatus;
}> {
	const rows = await transaction.$queryRaw<{ id: string }[]>`
		SELECT id FROM public.organization_payments
		WHERE organization_id = ${organizationId}::uuid AND id = ${paymentId}::uuid
		FOR UPDATE
	`;

	if (rows.length !== 1) throw paymentNotFound();

	const payment = await transaction.organizationPayment.findFirst({
		where: { organizationId, id: paymentId },
		select: { id: true, memberId: true, amountRwf: true, method: true, status: true },
	});

	if (payment === null) throw paymentNotFound();

	return payment;
}

async function createAudit(
	transaction: Prisma.TransactionClient,
	context: OwnerPaymentContext,
	input: {
		paymentId: string;
		refundId?: string;
		action: OrganizationPaymentAuditAction;
		idempotencyKey: string;
		fingerprint: string;
		previousStatus: OrganizationPaymentStatus;
		resultingStatus: OrganizationPaymentStatus;
		now: Date;
	},
): Promise<void> {
	await transaction.organizationPaymentAuditEvent.create({
		data: {
			organizationId: context.organizationId,
			paymentId: input.paymentId,
			refundId: input.refundId,
			actorUserId: context.actorUserId,
			action: input.action,
			requestId: context.requestId,
			idempotencyKey: input.idempotencyKey,
			requestFingerprint: input.fingerprint,
			previousStatus: input.previousStatus,
			resultingStatus: input.resultingStatus,
			occurredAt: input.now,
		},
	});
}

function paymentDate(value: string): Date {
	const date = new Date(value);

	if (!Number.isFinite(date.getTime())) {
		throw new BadRequestException({
			code: 'PAYMENT_DATE_INVALID',
			message: 'Supply a valid payment date.',
		});
	}

	const earliest = Date.UTC(2000, 0, 1);

	// Allow bounded browser/API clock skew while preventing arbitrarily future-dated payments.
	if (date.getTime() < earliest || date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
		throw new BadRequestException({
			code: 'PAYMENT_DATE_OUT_OF_RANGE',
			message: 'Payment date must be between 2000-01-01 and one day from now.',
		});
	}

	return date;
}

function paymentProviderReference(
	method: OrganizationPaymentMethod,
	value: string | undefined,
): string | null {
	const reference = value?.trim() ?? null;

	if (method === OrganizationPaymentMethod.CASH && reference !== null) {
		throw new BadRequestException({
			code: 'PAYMENT_PROVIDER_REFERENCE_FORBIDDEN',
			message: 'Cash payments do not use a provider reference.',
		});
	}

	if (method !== OrganizationPaymentMethod.CASH && reference === null) {
		throw new BadRequestException({
			code: 'PAYMENT_PROVIDER_REFERENCE_REQUIRED',
			message: 'A provider reference is required for non-cash payments.',
		});
	}

	return reference;
}

function requestFingerprint(input: readonly (string | number | null)[]): string {
	return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function receiptNumber(id: string, now: Date): string {
	return `PAY-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${id.slice(0, 8).toUpperCase()}`;
}

function invalidCursor(): BadRequestException {
	return new BadRequestException({
		code: 'PAYMENT_CURSOR_INVALID',
		message: 'Restart pagination with a cursor from the same gym and filter.',
	});
}
