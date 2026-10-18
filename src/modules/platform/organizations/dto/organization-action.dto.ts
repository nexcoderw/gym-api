import { IsISO8601, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OrganizationActionDto {
	@ApiProperty({
		format: 'date-time',
		description: 'Exact updatedAt from the last organization read.',
	})
	@IsString()
	@IsISO8601({ strict: true })
	@Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
	expectedUpdatedAt!: string;
}
