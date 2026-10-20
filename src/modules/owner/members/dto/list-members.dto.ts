import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export enum MemberStatusFilter {
	ACTIVE = 'ACTIVE',
	ARCHIVED = 'ARCHIVED',
}

export class MemberPageQueryDto {
	@ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' && /^[1-9][0-9]*$/u.test(value) ? Number(value) : value,
	)
	@IsInt()
	@Min(1)
	@Max(50)
	limit = 20;

	@ApiPropertyOptional({ format: 'uuid' })
	@IsOptional()
	@IsUUID('loose')
	cursor?: string;
}

export class ListMembersQueryDto extends MemberPageQueryDto {
	@ApiPropertyOptional({ enum: MemberStatusFilter, default: MemberStatusFilter.ACTIVE })
	@IsEnum(MemberStatusFilter)
	status: MemberStatusFilter = MemberStatusFilter.ACTIVE;
}
