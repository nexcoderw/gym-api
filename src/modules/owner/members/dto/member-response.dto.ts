import { ApiProperty } from '@nestjs/swagger';

import { MemberPeriodUnit } from '../member-period.js';

export enum MemberSubscriptionStatus {
	SCHEDULED = 'SCHEDULED',
	ACTIVE = 'ACTIVE',
	EXPIRED = 'EXPIRED',
	CANCELLED = 'CANCELLED',
}

export class MemberResponseDto {
	@ApiProperty({ format: 'uuid' })
	id!: string;
	@ApiProperty()
	name!: string;
	@ApiProperty()
	phoneNumber!: string;
	@ApiProperty({ type: String, nullable: true })
	email!: string | null;
	@ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] })
	status!: 'ACTIVE' | 'ARCHIVED';
	@ApiProperty({ format: 'date-time' })
	createdAt!: string;
	@ApiProperty({ format: 'date-time' })
	updatedAt!: string;
	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	archivedAt!: string | null;
}

export class MemberSubscriptionResponseDto {
	@ApiProperty({ format: 'uuid' })
	id!: string;
	@ApiProperty({ format: 'uuid' })
	memberId!: string;
	@ApiProperty({ format: 'uuid' })
	membershipPlanId!: string;
	@ApiProperty({ description: 'Plan name at the time of registration.' })
	planName!: string;
	@ApiProperty({
		minimum: 0,
		description:
			'Whole-RWF plan price snapshot, not a payment receipt or a multiplied period charge.',
	})
	price!: number;
	@ApiProperty({ enum: ['RWF'] })
	currency!: 'RWF';
	@ApiProperty({ enum: MemberPeriodUnit })
	periodUnit!: MemberPeriodUnit;
	@ApiProperty()
	periodCount!: number;
	@ApiProperty({ format: 'date' })
	startDate!: string;
	@ApiProperty({
		format: 'date',
		description: 'Last included calendar day, calculated by the API.',
	})
	endDate!: string;
	@ApiProperty({ enum: MemberSubscriptionStatus })
	status!: MemberSubscriptionStatus;
	@ApiProperty({ format: 'date-time' })
	createdAt!: string;
	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	cancelledAt!: string | null;
}

export class MemberRegistrationResponseDto {
	@ApiProperty({ type: MemberResponseDto })
	member!: MemberResponseDto;
	@ApiProperty({ type: MemberSubscriptionResponseDto })
	subscription!: MemberSubscriptionResponseDto;
}

export class MemberListResponseDto {
	@ApiProperty({ type: [MemberResponseDto] })
	items!: MemberResponseDto[];
	@ApiProperty({ type: String, nullable: true, format: 'uuid' })
	nextCursor!: string | null;
}

export class MemberSubscriptionListResponseDto {
	@ApiProperty({ type: [MemberSubscriptionResponseDto] })
	items!: MemberSubscriptionResponseDto[];
	@ApiProperty({ type: String, nullable: true, format: 'uuid' })
	nextCursor!: string | null;
}
