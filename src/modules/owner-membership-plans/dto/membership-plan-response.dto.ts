import { ApiProperty } from '@nestjs/swagger';

export enum MembershipPlanStatus {
	ACTIVE = 'ACTIVE',
	ARCHIVED = 'ARCHIVED',
}

export class MembershipPlanResponseDto {
	@ApiProperty({ format: 'uuid' })
	id!: string;

	@ApiProperty({ example: 'Monthly fitness', maxLength: 120 })
	name!: string;

	@ApiProperty({ example: 35_000, minimum: 0, format: 'int64' })
	price!: number;

	@ApiProperty({ example: 'RWF', enum: ['RWF'] })
	currency!: 'RWF';

	@ApiProperty({
		type: String,
		example: 'Gym floor access and group fitness.',
		maxLength: 1000,
		nullable: true,
	})
	description!: string | null;

	@ApiProperty({ enum: MembershipPlanStatus })
	status!: MembershipPlanStatus;

	@ApiProperty({ format: 'date-time' })
	createdAt!: string;

	@ApiProperty({ format: 'date-time' })
	updatedAt!: string;

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	archivedAt!: string | null;
}
