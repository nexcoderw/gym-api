import type { Prisma } from '@nexcoderw/gym-db';

import {
	MembershipPlanStatus,
	type MembershipPlanResponseDto,
} from './dto/membership-plan-response.dto.js';

export const MEMBERSHIP_PLAN_SELECT = Object.freeze({
	id: true,
	name: true,
	priceRwf: true,
	description: true,
	archivedAt: true,
	createdAt: true,
	updatedAt: true,
} satisfies Prisma.OrganizationMembershipPlanSelect);

type MembershipPlanRow = Prisma.OrganizationMembershipPlanGetPayload<{
	select: typeof MEMBERSHIP_PLAN_SELECT;
}>;

export function membershipPlanResponse(row: MembershipPlanRow): MembershipPlanResponseDto {
	return {
		id: row.id,
		name: row.name,
		price: Number(row.priceRwf),
		currency: 'RWF',
		description: row.description,
		status:
			row.archivedAt === null ? MembershipPlanStatus.ACTIVE : MembershipPlanStatus.ARCHIVED,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		archivedAt: row.archivedAt?.toISOString() ?? null,
	};
}
