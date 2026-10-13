import { ApiProperty } from '@nestjs/swagger';

import { OrganizationResponseDto } from './organization-response.dto.js';

export class OrganizationListResponseDto {
	@ApiProperty({ type: [OrganizationResponseDto] })
	items!: OrganizationResponseDto[];

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	nextCursor!: string | null;
}
