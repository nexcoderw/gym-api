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
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto.js';
import { CreatePaymentRefundDto, VoidPaymentDto } from './dto/payment-command.dto.js';
import { PaymentListResponseDto, PaymentResponseDto } from './dto/payment-response.dto.js';
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
@UseGuards(OwnerOriginCsrfGuard, OwnerSessionGuard)
@Controller('owner/payments')
export class OwnerPaymentsController {
	constructor(private readonly payments: OwnerPaymentsService) {}

	@Get()
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'List gym payments',
		description: 'Tenant-scoped payment ledger with bounded cursor pagination and stable ordering.',
	})
	@ApiOkResponse({ type: PaymentListResponseDto })
	list(
		@Query() query: ListPaymentsQueryDto,
		@Req() request: OwnerRequest,
	): Promise<PaymentListResponseDto> {
		return this.payments.list(ownerPaymentContext(request), query);
	}

	@Post()
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
			'Allocates a whole-RWF payment to a registration from the authenticated gym. Cash is confirmed immediately; external methods remain pending until a verified provider workflow confirms them.',
	})
	@ApiCreatedResponse({ type: PaymentResponseDto })
	create(
		@Body() input: CreatePaymentDto,
		@Headers('idempotency-key') key: string | undefined,
		@Req() request: OwnerRequest,
	): Promise<PaymentResponseDto> {
		return this.payments.create(ownerPaymentContext(request), input, paymentIdempotencyKey(key));
	}

	@Get(':paymentId')
	@Header('Cache-Control', 'no-store')
	@ApiOperation({
		summary: 'Read a gym payment',
		description: 'Returns payment, allocation, and refund evidence only from the authenticated gym.',
	})
	@ApiOkResponse({ type: PaymentResponseDto })
	get(
		@Param('paymentId', new ParseUUIDPipe()) paymentId: string,
		@Req() request: OwnerRequest,
	): Promise<PaymentResponseDto> {
		return this.payments.get(ownerPaymentContext(request), paymentId);
	}

	@Post(':paymentId/voids')
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({ name: 'Idempotency-Key', required: true })
	@ApiOperation({
		summary: 'Void an incorrect payment',
		description:
			'Preserves the original payment and appends audit evidence. Payments with refund history cannot be voided.',
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
	@HttpCode(200)
	@Header('Cache-Control', 'no-store')
	@RequireOwnerCsrf()
	@ApiHeader({ name: 'x-owner-csrf-token', required: true })
	@ApiHeader({ name: 'Idempotency-Key', required: true })
	@ApiOperation({
		summary: 'Record a cash refund',
		description:
			'Records a partial or full cash refund without deleting payment evidence. External refunds stay disabled until a verified provider workflow exists.',
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
