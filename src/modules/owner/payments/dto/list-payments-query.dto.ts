import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationPaymentMethod, OrganizationPaymentStatus } from '@nexcoderw/gym-db';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

export enum PaymentOrder {
	NEWEST = 'NEWEST',
	OLDEST = 'OLDEST',
	AMOUNT_HIGH = 'AMOUNT_HIGH',
	AMOUNT_LOW = 'AMOUNT_LOW',
}

export class ListPaymentsQueryDto {
	@ApiPropertyOptional({ default: 24, minimum: 1, maximum: 24 })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' && /^[1-9][0-9]*$/u.test(value) ? Number(value) : value,
	)
	@IsInt()
	@Min(1)
	@Max(24)
	limit = 24;

	@ApiPropertyOptional({ format: 'uuid' })
	@IsOptional()
	@IsUUID('loose')
	cursor?: string;

	@ApiPropertyOptional({ enum: OrganizationPaymentStatus })
	@IsOptional()
	@IsEnum(OrganizationPaymentStatus)
	status?: OrganizationPaymentStatus;

	@ApiPropertyOptional({ enum: OrganizationPaymentMethod })
	@IsOptional()
	@IsEnum(OrganizationPaymentMethod)
	method?: OrganizationPaymentMethod;

	@ApiPropertyOptional({ format: 'uuid' })
	@IsOptional()
	@IsUUID('loose')
	memberId?: string;

	@ApiPropertyOptional({ enum: PaymentOrder, default: PaymentOrder.NEWEST })
	@IsEnum(PaymentOrder)
	order: PaymentOrder = PaymentOrder.NEWEST;

	@ApiPropertyOptional({ example: '2026-01-01', description: 'Payment date in Africa/Kigali.' })
	@IsOptional()
	@Matches(/^\d{4}-\d{2}-\d{2}$/u)
	fromDate?: string;

	@ApiPropertyOptional({
		example: '2026-10-19',
		description: 'Inclusive payment date in Africa/Kigali.',
	})
	@IsOptional()
	@Matches(/^\d{4}-\d{2}-\d{2}$/u)
	toDate?: string;
}
