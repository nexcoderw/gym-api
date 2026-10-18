import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength, NotContains } from 'class-validator';

import {
	MAXIMUM_PASSWORD_CHARACTERS,
	MINIMUM_PASSWORD_CHARACTERS,
} from '../../../platform/auth/platform-password-policy.js';

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const TRIM_PATTERN = /^[\s\u0085]+|[\s\u0085]+$/gu;

export class StartOwnerEnrollmentDto {
	@ApiProperty({ minLength: 43, maxLength: 43, writeOnly: true })
	@IsString()
	@Matches(OPAQUE_TOKEN)
	invitationToken!: string;
}

export class VerifyExistingOwnerDto {
	@ApiProperty({ minLength: 43, maxLength: 43, writeOnly: true })
	@IsString()
	@Matches(OPAQUE_TOKEN)
	challengeToken!: string;

	@ApiProperty({ minLength: MINIMUM_PASSWORD_CHARACTERS, maxLength: MAXIMUM_PASSWORD_CHARACTERS })
	@IsString()
	@MinLength(MINIMUM_PASSWORD_CHARACTERS)
	@MaxLength(MAXIMUM_PASSWORD_CHARACTERS)
	password!: string;
}

export class RegisterInvitedOwnerDto extends VerifyExistingOwnerDto {
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
}

export class AcceptOwnerInvitationDto {
	@ApiProperty({ minLength: 43, maxLength: 43, writeOnly: true })
	@IsString()
	@Matches(OPAQUE_TOKEN)
	challengeToken!: string;
}
