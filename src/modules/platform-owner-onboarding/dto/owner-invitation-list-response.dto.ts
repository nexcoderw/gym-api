import { ApiProperty } from '@nestjs/swagger';

import { OwnerInvitationResponseDto } from './owner-invitation-response.dto.js';

export class OwnerInvitationListResponseDto {
	@ApiProperty({ type: [OwnerInvitationResponseDto] })
	items!: OwnerInvitationResponseDto[];

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	nextCursor!: string | null;
}
