import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
	OrganizationMemberReminderKind as ReminderKind,
	OrganizationMemberReminderStatus as ReminderStatus,
} from '@nexcoderw/gym-db';
import {
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
} from 'class-validator';

export class ReminderActivityQueryDto {
	@ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' && /^[1-9][0-9]*$/u.test(value) ? Number(value) : value,
	)
	@IsInt()
	@Min(1)
	@Max(50)
	limit = 20;
}

export class ReminderActivityItemDto {
	@ApiProperty({ format: 'uuid' })
	id!: string;
	@ApiProperty({ format: 'uuid' })
	memberId!: string;
	@ApiProperty()
	memberName!: string;
	@ApiProperty()
	planName!: string;
	@ApiProperty({ enum: ReminderKind })
	kind!: ReminderKind;
	@ApiProperty({
		enum: [
			ReminderStatus.ACCEPTED,
			ReminderStatus.DELIVERED,
			ReminderStatus.BOUNCED,
			ReminderStatus.FAILED,
			ReminderStatus.UNCERTAIN,
		],
	})
	status!: ReminderStatus;
	@ApiProperty({ format: 'date' })
	dueDate!: string;
	@ApiProperty({ format: 'date' })
	endDate!: string;
	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	acceptedAt!: string | null;
	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	deliveredAt!: string | null;
}

export class ReminderActivityResponseDto {
	@ApiProperty({ type: [ReminderActivityItemDto] })
	items!: ReminderActivityItemDto[];
}

export class UpcomingReminderQueryDto {
	@ApiPropertyOptional({ default: 24, minimum: 1, maximum: 24 })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' && /^[1-9][0-9]*$/u.test(value) ? Number(value) : value,
	)
	@IsInt()
	@Min(1)
	@Max(24)
	limit = 24;
	@ApiPropertyOptional({ format: 'uuid', description: 'Cursor from the previous page.' })
	@IsOptional()
	@IsUUID()
	cursor?: string;
}

export class UpcomingReminderItemDto {
	@ApiProperty({ format: 'uuid' })
	subscriptionId!: string;
	@ApiProperty({ format: 'uuid' })
	memberId!: string;
	@ApiProperty()
	memberName!: string;
	@ApiProperty()
	planName!: string;
	@ApiProperty({ format: 'date' })
	endDate!: string;
	@ApiProperty({ minimum: 0, maximum: 14 })
	daysRemaining!: number;
	@ApiProperty()
	canSend!: boolean;
	@ApiProperty({ enum: ReminderStatus, nullable: true })
	manualStatus!: ReminderStatus | null;
}

export class UpcomingReminderResponseDto {
	@ApiProperty({ type: [UpcomingReminderItemDto] })
	items!: UpcomingReminderItemDto[];
	@ApiProperty({ format: 'uuid', nullable: true })
	nextCursor!: string | null;
}

export class QueuedReminderResponseDto {
	@ApiProperty({ format: 'uuid' })
	id!: string;
	@ApiProperty({ enum: [ReminderStatus.QUEUED] })
	status!: typeof ReminderStatus.QUEUED;
}

export class SendManualReminderDto {
	@ApiProperty({ minLength: 1, maxLength: 120 })
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	@Matches(/^[^\r\n\p{Cc}\p{Cf}]*\S[^\r\n\p{Cc}\p{Cf}]*$/u)
	subject!: string;

	@ApiProperty({ minLength: 1, maxLength: 2000 })
	@IsString()
	@MinLength(1)
	@MaxLength(2000)
	@Matches(/^[\s\S]*\S[\s\S]*$/u)
	body!: string;
}
