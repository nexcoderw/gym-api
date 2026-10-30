import { ApiProperty } from '@nestjs/swagger';
import { ORGANIZATION_ENTITLEMENT, type OrganizationEntitlementKey } from '@nexcoderw/gym-db';

export class OwnerCapabilitiesResponseDto {
	@ApiProperty({ format: 'uuid' })
	organizationId!: string;

	@ApiProperty({
		enum: Object.values(ORGANIZATION_ENTITLEMENT),
		isArray: true,
		description: 'Capabilities that are enabled and inside their effective window now.',
	})
	capabilities!: OrganizationEntitlementKey[];

	@ApiProperty({ format: 'date-time' })
	evaluatedAt!: string;
}
