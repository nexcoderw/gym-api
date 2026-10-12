import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorDetailDto {
	@ApiProperty({ example: 'email' })
	field!: string;

	@ApiProperty({ example: 'email must be an email' })
	message!: string;
}

export class ApiErrorDto {
	@ApiProperty({ example: 'VALIDATION_FAILED' })
	code!: string;

	@ApiProperty({ example: 'Request validation failed' })
	message!: string;

	@ApiProperty({ example: '9a14de53-a456-4b8d-9676-106cc5caa2ad' })
	requestId!: string;

	@ApiPropertyOptional({ type: [ApiErrorDetailDto] })
	details?: ApiErrorDetailDto[];
}

export class ApiErrorResponseDto {
	@ApiProperty({ type: ApiErrorDto })
	error!: ApiErrorDto;

	@ApiProperty({ example: '2026-10-12T10:30:00.000Z' })
	timestamp!: string;

	@ApiProperty({ example: '/api/v1/organizations' })
	path!: string;
}
