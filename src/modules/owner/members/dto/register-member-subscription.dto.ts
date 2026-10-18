import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

import { MemberPeriodUnit } from '../member-period.js';

export class RegisterMemberSubscriptionDto {
	@ApiProperty({
		format: 'uuid',
		description: 'An active plan belonging to the authenticated gym.',
	})
	@IsUUID()
	membershipPlanId!: string;

	@ApiProperty({
		example: '2026-11-01',
		format: 'date',
		description: 'First included calendar day.',
	})
	@IsString()
	@Matches(/^20\d{2}-\d{2}-\d{2}$/u)
	startDate!: string;

	@ApiProperty({ enum: MemberPeriodUnit, example: MemberPeriodUnit.MONTHS })
	@IsEnum(MemberPeriodUnit)
	periodUnit!: MemberPeriodUnit;

	@ApiProperty({
		example: 1,
		minimum: 1,
		maximum: 3650,
		description: 'Count of units; maximum depends on unit and cannot exceed ten years.',
	})
	@IsInt()
	@Min(1)
	@Max(3650)
	periodCount!: number;
}
