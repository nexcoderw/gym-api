import { Transform } from 'class-transformer';
import {
	IsInt,
	IsOptional,
	IsString,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
	NotContains,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { MEMBERSHIP_PLAN_PRICE_MAXIMUM_RWF } from '../owner-membership-plans.constants.js';

function trimText(value: unknown): unknown {
	return typeof value === 'string' ? value.replace(/^[\s\u0085]+|[\s\u0085]+$/gu, '') : value;
}

function nullableDescription(value: unknown): unknown {
	const trimmed = trimText(value);
	return trimmed === '' ? null : trimmed;
}

export class CreateMembershipPlanDto {
	@ApiProperty({ example: 'Monthly fitness', minLength: 1, maxLength: 120 })
	@Transform(({ value }: { value: unknown }) => trimText(value))
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	@NotContains('\u0000')
	@Matches(/[^\s\u0085]/u, { message: 'name must contain meaningful text' })
	name!: string;

	@ApiProperty({
		example: 35_000,
		description: 'Exact whole-Rwandan-franc price. Decimal values are not accepted.',
		minimum: 0,
		maximum: MEMBERSHIP_PLAN_PRICE_MAXIMUM_RWF,
	})
	@IsInt()
	@Min(0)
	@Max(MEMBERSHIP_PLAN_PRICE_MAXIMUM_RWF)
	price!: number;

	@ApiPropertyOptional({
		example: 'Gym floor access, group fitness and one assessment.',
		maxLength: 1000,
		nullable: true,
		description: 'Optional description of included activities. Blank text is stored as null.',
	})
	@Transform(({ value }: { value: unknown }) => nullableDescription(value))
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	@NotContains('\u0000')
	description?: string | null;
}
