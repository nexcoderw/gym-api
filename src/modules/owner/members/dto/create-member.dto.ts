import { Transform, Type } from 'class-transformer';
import {
	IsDefined,
	IsEmail,
	IsString,
	MaxLength,
	MinLength,
	NotContains,
	ValidateIf,
	ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RegisterMemberSubscriptionDto } from './register-member-subscription.dto.js';

export class MemberProfileDto {
	@ApiProperty({ example: 'Example Member', minLength: 1, maxLength: 160 })
	@IsString()
	@MinLength(1)
	@MaxLength(160)
	@NotContains('\u0000')
	name!: string;

	@ApiProperty({ example: '+250 700 000 001', maxLength: 40 })
	@IsString()
	@MinLength(1)
	@MaxLength(40)
	phoneNumber!: string;

	@ApiPropertyOptional({ example: 'member@example.com', nullable: true, maxLength: 254 })
	@Transform(({ value }: { value: unknown }) => {
		if (typeof value !== 'string') return value;
		return value.trim() === '' ? null : value.trim().toLocaleLowerCase('en-US');
	})
	@ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
	@IsEmail()
	@MaxLength(254)
	email?: string | null;
}

export class CreateMemberDto extends MemberProfileDto {
	@ApiProperty({
		type: RegisterMemberSubscriptionDto,
		description: 'The first plan registration; both records are created atomically.',
	})
	@IsDefined()
	@ValidateNested()
	@Type(() => RegisterMemberSubscriptionDto)
	subscription!: RegisterMemberSubscriptionDto;
}
