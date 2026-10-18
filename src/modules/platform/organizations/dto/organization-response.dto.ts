import { ApiProperty } from '@nestjs/swagger';
import { OrganizationStatus } from '@nexcoderw/gym-db';

export class OrganizationResponseDto {
	@ApiProperty({ format: 'uuid' })
	id!: string;

	@ApiProperty({ example: 'Soho Gym', maxLength: 160 })
	name!: string;

	@ApiProperty({ example: 'soho', minLength: 3, maxLength: 63 })
	slug!: string;

	@ApiProperty({ enum: OrganizationStatus })
	status!: OrganizationStatus;

	@ApiProperty({ format: 'date-time' })
	createdAt!: string;

	@ApiProperty({ format: 'date-time' })
	updatedAt!: string;

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	activatedAt!: string | null;

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	suspendedAt!: string | null;

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	archivedAt!: string | null;
}
