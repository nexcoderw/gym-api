import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import {
	MEMBERSHIP_PLAN_PAGE_DEFAULT,
	MEMBERSHIP_PLAN_PAGE_MAXIMUM,
} from '../owner-membership-plans.constants.js';

export enum MembershipPlanStatusFilter {
	ACTIVE = 'ACTIVE',
	ARCHIVED = 'ARCHIVED',
	ALL = 'ALL',
}

export enum MembershipPlanOrder {
	PRICE_ASC = 'PRICE_ASC',
	PRICE_DESC = 'PRICE_DESC',
	NAME_ASC = 'NAME_ASC',
	NEWEST = 'NEWEST',
}

export class ListMembershipPlansQueryDto {
	@ApiPropertyOptional({
		default: MEMBERSHIP_PLAN_PAGE_DEFAULT,
		minimum: 1,
		maximum: MEMBERSHIP_PLAN_PAGE_MAXIMUM,
	})
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' && /^[1-9][0-9]*$/u.test(value) ? Number(value) : value,
	)
	@IsInt()
	@Min(1)
	@Max(MEMBERSHIP_PLAN_PAGE_MAXIMUM)
	limit = MEMBERSHIP_PLAN_PAGE_DEFAULT;

	@ApiPropertyOptional({
		enum: MembershipPlanStatusFilter,
		default: MembershipPlanStatusFilter.ACTIVE,
	})
	@IsOptional()
	@IsEnum(MembershipPlanStatusFilter)
	status: MembershipPlanStatusFilter = MembershipPlanStatusFilter.ACTIVE;

	@ApiPropertyOptional({ enum: MembershipPlanOrder, default: MembershipPlanOrder.PRICE_ASC })
	@IsEnum(MembershipPlanOrder)
	order: MembershipPlanOrder = MembershipPlanOrder.PRICE_ASC;

	@ApiPropertyOptional({ maxLength: 80, description: 'Case-insensitive plan name search.' })
	@IsOptional()
	@IsString()
	@MaxLength(80)
	search?: string;

	@ApiPropertyOptional({
		format: 'uuid',
		description: 'Last emitted plan UUID. Keep the same status filter between pages.',
	})
	@IsOptional()
	@IsUUID('loose')
	cursor?: string;
}
