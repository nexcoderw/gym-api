import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationPaymentMethod } from '@nexcoderw/gym-db';
import { Transform } from 'class-transformer';
import {
	IsEnum,
	IsInt,
	IsISO8601,
	IsOptional,
	IsString,
	IsUUID,
	Max,
	MaxLength,
	Min,
	MinLength,
	NotContains,
} from 'class-validator';

export class CreatePaymentDto {
	@ApiProperty({ format: 'uuid' })
	@IsUUID()
	memberId!: string;

	@ApiProperty({ format: 'uuid', description: 'A registration belonging to this member and gym.' })
	@IsUUID()
	subscriptionId!: string;

	@ApiProperty({ minimum: 1, maximum: 1_000_000_000, description: 'Whole Rwandan francs.' })
	@IsInt()
	@Min(1)
	@Max(1_000_000_000)
	amount!: number;

	@ApiProperty({ enum: OrganizationPaymentMethod })
	@IsEnum(OrganizationPaymentMethod)
	method!: OrganizationPaymentMethod;

	@ApiProperty({
		format: 'date-time',
		description: 'When the gym received or initiated the payment.',
	})
	@IsISO8601({ strict: true, strictSeparator: true })
	occurredAt!: string;

	@ApiPropertyOptional({
		maxLength: 120,
		description: 'Required for externally processed methods.',
	})
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' && value.trim() === '' ? undefined : value,
	)
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	@NotContains('\u0000')
	providerReference?: string;

	@ApiPropertyOptional({ maxLength: 500 })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' && value.trim() === '' ? undefined : value,
	)
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(500)
	@NotContains('\u0000')
	note?: string;
}
