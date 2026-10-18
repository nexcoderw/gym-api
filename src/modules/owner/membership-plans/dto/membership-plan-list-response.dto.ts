import { ApiProperty } from '@nestjs/swagger';

import { MembershipPlanResponseDto } from './membership-plan-response.dto.js';

export class MembershipPlanListResponseDto {
	@ApiProperty({ type: [MembershipPlanResponseDto] })
	items!: MembershipPlanResponseDto[];

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	nextCursor!: string | null;
}
