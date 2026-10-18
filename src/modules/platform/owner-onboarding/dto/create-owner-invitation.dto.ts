import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength, NotContains } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const TRIM_PATTERN = /^[\s\u0085]+|[\s\u0085]+$/gu;

export class CreateOwnerInvitationDto {
	@ApiProperty({ example: 'Aline Uwase', minLength: 1, maxLength: 160 })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.replace(TRIM_PATTERN, '') : value,
	)
	@IsString()
	@MinLength(1)
	@MaxLength(160)
	@NotContains('\u0000')
	@Matches(/[^\s\u0085]/u, { message: 'displayName must contain meaningful text' })
	displayName!: string;

	@ApiProperty({ example: 'aline@example.com', minLength: 3, maxLength: 254 })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim().toLowerCase() : value,
	)
	@IsString()
	@MinLength(3)
	@MaxLength(254)
	@IsEmail({ allow_utf8_local_part: false, require_tld: true })
	email!: string;
}
