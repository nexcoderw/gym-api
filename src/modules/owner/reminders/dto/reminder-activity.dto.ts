import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
	OrganizationMemberReminderKind as ReminderKind,
	OrganizationMemberReminderStatus as ReminderStatus,
} from '@nexcoderw/gym-db';
import { IsInt, Max, Min } from 'class-validator';

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
