import { Transform } from 'class-transformer';
import {
	IsBoolean,
	IsISO8601,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	MinLength,
	NotContains,
	ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOrganizationEntitlementDto {
	@ApiPropertyOptional({ description: 'Whether the capability is administratively enabled.' })
	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	@IsOptional()
	@ValidateIf((_object: unknown, value: unknown) => value !== null)
	@IsString()
	@IsISO8601({ strict: true, strictSeparator: true })
	@Matches(/(?:Z|[+-]\d{2}:\d{2})$/u, { message: 'startsAt must include a UTC offset' })
	startsAt?: string | null;

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	@IsOptional()
	@ValidateIf((_object: unknown, value: unknown) => value !== null)
	@IsString()
	@IsISO8601({ strict: true, strictSeparator: true })
	@Matches(/(?:Z|[+-]\d{2}:\d{2})$/u, { message: 'expiresAt must include a UTC offset' })
	expiresAt?: string | null;

	@ApiProperty({ example: 'Enable member management for the approved organization plan.' })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.replace(/^[\s\u0085]+|[\s\u0085]+$/gu, '') : value,
	)
	@IsString()
	@MinLength(10)
	@MaxLength(500)
	@NotContains('\u0000')
	reason!: string;
}
