import { ApiProperty } from '@nestjs/swagger';
import {
	OrganizationPaymentMethod,
	OrganizationPaymentRefundStatus,
	OrganizationPaymentStatus,
} from '@nexcoderw/gym-db';

export class PaymentAllocationResponseDto {
	@ApiProperty({ format: 'uuid' })
	subscriptionId!: string;
	@ApiProperty()
	planName!: string;
	@ApiProperty({ description: 'Whole Rwandan francs.' })
	amount!: number;
	@ApiProperty({ format: 'date' })
	startDate!: string;
	@ApiProperty({ format: 'date' })
	endDate!: string;
}

export class PaymentRefundResponseDto {
	@ApiProperty({ format: 'uuid' })
	id!: string;
	@ApiProperty()
	amount!: number;
	@ApiProperty({ enum: OrganizationPaymentRefundStatus })
	status!: OrganizationPaymentRefundStatus;
	@ApiProperty()
	reason!: string;
	@ApiProperty({ type: String, nullable: true })
	providerReference!: string | null;
	@ApiProperty({ format: 'date-time' })
	createdAt!: string;
}

export class PaymentResponseDto {
	@ApiProperty({ format: 'uuid' })
	id!: string;
	@ApiProperty()
	receiptNumber!: string;
	@ApiProperty({ format: 'uuid' })
	memberId!: string;
	@ApiProperty()
	memberName!: string;
	@ApiProperty()
	amount!: number;
	@ApiProperty({ enum: ['RWF'] })
	currency!: 'RWF';
	@ApiProperty({ enum: OrganizationPaymentMethod })
	method!: OrganizationPaymentMethod;
	@ApiProperty({ enum: OrganizationPaymentStatus })
	status!: OrganizationPaymentStatus;
	@ApiProperty({ type: String, nullable: true })
	providerReference!: string | null;
	@ApiProperty({ type: String, nullable: true })
	note!: string | null;
	@ApiProperty({ format: 'date-time' })
	occurredAt!: string;
	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	confirmedAt!: string | null;
	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	voidedAt!: string | null;
	@ApiProperty({ type: String, nullable: true })
	voidReason!: string | null;
	@ApiProperty({ format: 'date-time' })
	createdAt!: string;
	@ApiProperty({ type: [PaymentAllocationResponseDto] })
	allocations!: PaymentAllocationResponseDto[];
	@ApiProperty({ type: [PaymentRefundResponseDto] })
	refunds!: PaymentRefundResponseDto[];
}

export class PaymentListResponseDto {
	@ApiProperty({ type: [PaymentResponseDto] })
	items!: PaymentResponseDto[];
	@ApiProperty({ type: String, nullable: true, format: 'uuid' })
	nextCursor!: string | null;
}
