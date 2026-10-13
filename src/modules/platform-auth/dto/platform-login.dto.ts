import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlatformLoginDto {
	@ApiProperty({ example: 'admin@example.com', maxLength: 254 })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim().toLowerCase() : value,
	)
	@IsEmail()
	@MaxLength(254)
	email!: string;

	@ApiProperty({ example: 'correct horse battery staple', minLength: 12, maxLength: 1024 })
	@IsString()
	@MinLength(12)
	@MaxLength(1024)
	password!: string;
}
