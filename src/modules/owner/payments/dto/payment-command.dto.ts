import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min, MinLength, NotContains } from 'class-validator';

export class VoidPaymentDto {
	@ApiProperty({ minLength: 3, maxLength: 500 })
	@IsString()
	@MinLength(3)
	@MaxLength(500)
	@NotContains('\u0000')
	reason!: string;
}

export class CreatePaymentRefundDto extends VoidPaymentDto {
	@ApiProperty({ minimum: 1, maximum: 1_000_000_000, description: 'Whole Rwandan francs.' })
	@IsInt()
	@Min(1)
	@Max(1_000_000_000)
	amount!: number;
}
