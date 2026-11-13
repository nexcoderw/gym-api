import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Header,
	Headers,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Post,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiCookieAuth,
	ApiCreatedResponse,
	ApiForbiddenResponse,
	ApiHeader,
	ApiNotFoundResponse,
	ApiOkResponse,
	ApiOperation,
	ApiQuery,
	ApiServiceUnavailableResponse,
	ApiTags,
	ApiTooManyRequestsResponse,
	ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';

import { ApiErrorResponseDto } from '../../../common/dto/api-error-response.dto.js';
import { OwnerOriginCsrfGuard } from '../auth/owner-origin-csrf.guard.js';
import type { OwnerRequest } from '../auth/owner-request.js';
import { OwnerSessionGuard } from '../auth/owner-session.guard.js';
import { RequireOwnerCsrf } from '../auth/owner-csrf.decorator.js';
import { OwnerEntitlementGuard } from '../entitlements/owner-entitlement.guard.js';
import { OWNER_OPERATION_ENTITLEMENTS } from '../entitlements/owner-operation-entitlements.js';
import { RequireOwnerEntitlements } from '../entitlements/require-owner-entitlements.decorator.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto.js';
import { CreatePaymentRefundDto, VoidPaymentDto } from './dto/payment-command.dto.js';
import { PaymentListResponseDto, PaymentResponseDto } from './dto/payment-response.dto.js';
import { RegisterPaymentDto } from './dto/register-payment.dto.js';
import { ownerPaymentContext } from './owner-payment-context.js';
import { OwnerPaymentsService } from './owner-payments.service.js';

@ApiTags('Owner payments')
@ApiCookieAuth('owner-session')
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto })
@ApiNotFoundResponse({ type: ApiErrorResponseDto })
@ApiConflictResponse({ type: ApiErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
@UseGuards(OwnerOriginCsrfGuard, OwnerSessionGuard, OwnerEntitlementGuard)
@Controller('owner/payments')
export class OwnerPaymentsController {
	constructor(private readonly payments: OwnerPaymentsService) {}

	@Get()
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.paymentsList)
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'List gym payments',
		description:
			'Requires organization.payments.read. Returns a tenant-scoped ledger with bounded pagination and optional member, receipt or reference search. membershipPlanIds is a comma-separated list of up to 24 plan UUIDs; a payment is included when any allocation matches a selected plan.',
	})
	@ApiQuery({
		name: 'membershipPlanIds',
		required: false,
		type: String,
		description: 'Comma-separated membership plan UUIDs; payments matching any selected plan.',
	})
	@ApiOkResponse({ type: PaymentListResponseDto })
	list(
		@Query() query: ListPaymentsQueryDto,
		@Req() request: OwnerRequest,
	): Promise<PaymentListResponseDto> {
		return this.payments.list(ownerPaymentContext(request), query);
	}

	@Post()
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.paymentsCreate)
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({
		name: 'Idempotency-Key',
		required: true,
		description: 'A UUID reused only for identical retries of this payment command.',
	})
	@ApiOperation({
		summary: 'Record a member payment',
		description:
			'Requires organization.payments.create. Allocates a whole-RWF payment to a registration from the authenticated gym.',
	})
	@ApiCreatedResponse({ type: PaymentResponseDto })
	create(
		@Body() input: CreatePaymentDto,
		@Headers('idempotency-key') key: string | undefined,
		@Req() request: OwnerRequest,
	): Promise<PaymentResponseDto> {
		return this.payments.create(ownerPaymentContext(request), input, paymentIdempotencyKey(key));
	}

	@Post('registrations')
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.paymentRegistrationCreate)
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({
		name: 'Idempotency-Key',
		required: true,
		description:
			'A UUID reused only for identical retries of the complete registration and payment.',
	})
	@ApiOperation({
		summary: 'Register a member and record the plan payment',
		description:
			'Requires organization.payments.create, organization.members.create and organization.member-subscriptions.manage. Atomically creates the registration workflow using server-authoritative plan terms.',
	})
	@ApiCreatedResponse({ type: PaymentResponseDto })
	registerPayment(
		@Body() input: RegisterPaymentDto,
		@Headers('idempotency-key') key: string | undefined,
		@Req() request: OwnerRequest,
	): Promise<PaymentResponseDto> {
		return this.payments.registerPayment(
			ownerPaymentContext(request),
			input,
			paymentIdempotencyKey(key),
		);
	}

	@Get(':paymentId')
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.paymentsGet)
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'Read a gym payment',
		description:
			'Requires organization.payments.read. Returns payment, allocation and refund evidence only from the authenticated gym.',
	})
	@ApiOkResponse({ type: PaymentResponseDto })
	get(
		@Param('paymentId', new ParseUUIDPipe()) paymentId: string,
		@Req() request: OwnerRequest,
	): Promise<PaymentResponseDto> {
		return this.payments.get(ownerPaymentContext(request), paymentId);
	}

	@Post(':paymentId/voids')
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.paymentsVoid)
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({ name: 'Idempotency-Key', required: true })
	@ApiOperation({
		summary: 'Void an incorrect payment',
		description:
			'Requires organization.payments.void. Preserves the original payment and appends audit evidence.',
	})
	@ApiOkResponse({ type: PaymentResponseDto })
	void(
		@Param('paymentId', new ParseUUIDPipe()) paymentId: string,
		@Body() input: VoidPaymentDto,
		@Headers('idempotency-key') key: string | undefined,
		@Req() request: OwnerRequest,
	): Promise<PaymentResponseDto> {
		return this.payments.void(
			ownerPaymentContext(request),
			paymentId,
			input,
			paymentIdempotencyKey(key),
		);
	}

	@Post(':paymentId/refunds')
	@RequireOwnerEntitlements(...OWNER_OPERATION_ENTITLEMENTS.paymentsRefund)
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({ name: 'Idempotency-Key', required: true })
	@ApiOperation({
		summary: 'Record a cash refund',
		description:
			'Requires organization.payments.refund. Records a partial or full cash refund without deleting payment evidence.',
	})
	@ApiOkResponse({ type: PaymentResponseDto })
	refund(
		@Param('paymentId', new ParseUUIDPipe()) paymentId: string,
		@Body() input: CreatePaymentRefundDto,
		@Headers('idempotency-key') key: string | undefined,
		@Req() request: OwnerRequest,
	): Promise<PaymentResponseDto> {
		return this.payments.refund(
			ownerPaymentContext(request),
			paymentId,
			input,
			paymentIdempotencyKey(key),
		);
	}
}

function paymentIdempotencyKey(value: string | undefined): string {
	if (value === undefined || !isUUID(value)) {
		throw new BadRequestException({
			code: 'PAYMENT_IDEMPOTENCY_REQUIRED',
			message: 'Supply a UUID Idempotency-Key header for this payment command.',
		});
	}
	return value.toLowerCase();
}
