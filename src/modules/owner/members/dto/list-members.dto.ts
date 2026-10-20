import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

export enum MemberOrder {
	NEWEST = 'NEWEST',
	OLDEST = 'OLDEST',
	NAME_ASC = 'NAME_ASC',
	NAME_DESC = 'NAME_DESC',
}

export enum MemberStatusFilter {
	ACTIVE = 'ACTIVE',
	ARCHIVED = 'ARCHIVED',
}

export class MemberPageQueryDto {
	@ApiPropertyOptional({ default: 24, minimum: 1, maximum: 24 })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' && /^[1-9][0-9]*$/u.test(value) ? Number(value) : value,
	)
	@IsInt()
	@Min(1)
	@Max(24)
	limit = 24;

	@ApiPropertyOptional({ format: 'uuid' })
	@IsOptional()
	@IsUUID('loose')
	cursor?: string;
}

export class ListMembersQueryDto extends MemberPageQueryDto {
	@ApiPropertyOptional({ enum: MemberStatusFilter, default: MemberStatusFilter.ACTIVE })
	@IsEnum(MemberStatusFilter)
	status: MemberStatusFilter = MemberStatusFilter.ACTIVE;

	@ApiPropertyOptional({ enum: MemberOrder, default: MemberOrder.NEWEST })
	@IsEnum(MemberOrder)
	order: MemberOrder = MemberOrder.NEWEST;

	@ApiPropertyOptional({
		example: '2026-01-01',
		description: 'Member registration date in Africa/Kigali.',
	})
	@IsOptional()
	@Matches(/^\d{4}-\d{2}-\d{2}$/u)
	fromDate?: string;

	@ApiPropertyOptional({
		example: '2026-10-19',
		description: 'Inclusive member registration date in Africa/Kigali.',
	})
	@IsOptional()
	@Matches(/^\d{4}-\d{2}-\d{2}$/u)
	toDate?: string;
}
