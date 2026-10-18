import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import {
	MAXIMUM_PASSWORD_CHARACTERS,
	MINIMUM_PASSWORD_CHARACTERS,
} from '../platform-password-policy.js';

export class PlatformLoginDto {
	@ApiProperty({ example: 'admin@example.com', maxLength: 254 })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim().toLowerCase() : value,
	)
	@IsEmail()
	@MaxLength(254)
	email!: string;

	@ApiProperty({
		example: 'correct horse battery staple',
		minLength: MINIMUM_PASSWORD_CHARACTERS,
		maxLength: MAXIMUM_PASSWORD_CHARACTERS,
	})
	@IsString()
	@MinLength(MINIMUM_PASSWORD_CHARACTERS)
	@MaxLength(MAXIMUM_PASSWORD_CHARACTERS)
	password!: string;
}
