import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

import {
	MAXIMUM_PASSWORD_CHARACTERS,
	MINIMUM_PASSWORD_CHARACTERS,
} from '../../../platform/auth/platform-password-policy.js';

export class OwnerLoginDto {
	@ApiProperty({ example: 'owner@example.com', maxLength: 254 })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim().toLowerCase() : value,
	)
	@IsEmail({ allow_utf8_local_part: false, require_tld: true })
	@MaxLength(254)
	email!: string;

	@ApiProperty({ minLength: MINIMUM_PASSWORD_CHARACTERS, maxLength: MAXIMUM_PASSWORD_CHARACTERS })
	@IsString()
	@MinLength(MINIMUM_PASSWORD_CHARACTERS)
	@MaxLength(MAXIMUM_PASSWORD_CHARACTERS)
	password!: string;
}
