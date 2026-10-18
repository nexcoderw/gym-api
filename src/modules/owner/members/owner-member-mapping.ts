import type { Prisma } from '@nexcoderw/gym-db';

import {
	MemberSubscriptionStatus,
	type MemberResponseDto,
	type MemberSubscriptionResponseDto,
} from './dto/member-response.dto.js';
import { MemberPeriodUnit } from './member-period.js';

export const MEMBER_SELECT = {
	id: true, name: true, email: true, phoneNumber: true,
	createdAt: true, updatedAt: true, archivedAt: true,
} satisfies Prisma.OrganizationMemberSelect;

export const SUBSCRIPTION_SELECT = {
	id: true, memberId: true, membershipPlanId: true, planName: true, priceRwf: true,
	periodUnit: true, periodCount: true, startDate: true, endDate: true,
	createdAt: true, cancelledAt: true,
} satisfies Prisma.OrganizationMemberSubscriptionSelect;

type MemberRow = Prisma.OrganizationMemberGetPayload<{ select: typeof MEMBER_SELECT }>;
type SubscriptionRow = Prisma.OrganizationMemberSubscriptionGetPayload<{ select: typeof SUBSCRIPTION_SELECT }>;

export function memberResponse(row: MemberRow): MemberResponseDto {
	return {
		id: row.id, name: row.name, email: row.email, phoneNumber: row.phoneNumber,
		status: row.archivedAt === null ? 'ACTIVE' : 'ARCHIVED',
		createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
		archivedAt: row.archivedAt?.toISOString() ?? null,
	};
}

/** Kigali calendar day; current gym scheduling uses Africa/Kigali (UTC+02, no DST). */
export function memberToday(now = new Date()): string {
	return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function memberSubscriptionResponse(row: SubscriptionRow, today = memberToday()): MemberSubscriptionResponseDto {
	const startDate = row.startDate.toISOString().slice(0, 10);
	const endDate = row.endDate.toISOString().slice(0, 10);
	const units: Record<SubscriptionRow['periodUnit'], MemberPeriodUnit> = {
		DAYS: MemberPeriodUnit.DAYS, WEEKS: MemberPeriodUnit.WEEKS,
		MONTHS: MemberPeriodUnit.MONTHS, YEARS: MemberPeriodUnit.YEARS,
	};
	return {
		id: row.id, memberId: row.memberId, membershipPlanId: row.membershipPlanId,
		planName: row.planName, price: Number(row.priceRwf), currency: 'RWF',
		periodUnit: units[row.periodUnit], periodCount: row.periodCount,
		startDate, endDate,
		status: row.cancelledAt !== null ? MemberSubscriptionStatus.CANCELLED
			: startDate > today ? MemberSubscriptionStatus.SCHEDULED
				: endDate < today ? MemberSubscriptionStatus.EXPIRED : MemberSubscriptionStatus.ACTIVE,
		createdAt: row.createdAt.toISOString(), cancelledAt: row.cancelledAt?.toISOString() ?? null,
	};
}
