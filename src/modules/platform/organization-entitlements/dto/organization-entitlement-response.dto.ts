import { ApiProperty } from '@nestjs/swagger';
import type { OrganizationEntitlementKey } from '@nexcoderw/gym-db';

export const ORGANIZATION_ENTITLEMENT_EFFECTIVE_STATUS = [
	'DISABLED',
	'SCHEDULED',
	'ENABLED',
	'EXPIRED',
] as const;

export type OrganizationEntitlementEffectiveStatus =
	(typeof ORGANIZATION_ENTITLEMENT_EFFECTIVE_STATUS)[number];

export class OrganizationEntitlementResponseDto {
	@ApiProperty({ example: 'organization.members.read' })
	featureKey!: OrganizationEntitlementKey;

	@ApiProperty()
	enabled!: boolean;

	@ApiProperty({ enum: ORGANIZATION_ENTITLEMENT_EFFECTIVE_STATUS })
	effectiveStatus!: OrganizationEntitlementEffectiveStatus;

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	startsAt!: string | null;

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	expiresAt!: string | null;

	@ApiProperty({ minimum: 0, description: 'Zero means the catalog key has no persisted row yet.' })
	version!: number;

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	updatedAt!: string | null;
}

export class OrganizationEntitlementListResponseDto {
	@ApiProperty({ format: 'uuid' })
	organizationId!: string;

	@ApiProperty({ type: [OrganizationEntitlementResponseDto] })
	items!: OrganizationEntitlementResponseDto[];
}
