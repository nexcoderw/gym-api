import type { Prisma } from '@nexcoderw/gym-db';

import type { MemberSubscriptionResponseDto } from './dto/member-response.dto.js';
import type { RegisterMemberSubscriptionDto } from './dto/register-member-subscription.dto.js';
import { memberPeriod } from './member-period.js';
import type { OwnerMemberContext } from './owner-member-context.js';
import { memberConflict, memberNotFound } from './owner-member-errors.js';
import { SUBSCRIPTION_SELECT, memberSubscriptionResponse } from './owner-member-mapping.js';

export async function registerMemberPlan(
	transaction: Prisma.TransactionClient,
	context: OwnerMemberContext,
	memberId: string,
	input: RegisterMemberSubscriptionDto,
	key: string,
	fingerprint: string,
): Promise<MemberSubscriptionResponseDto> {
	await lockMember(transaction, context.organizationId, memberId);
	// Lock the active plan while capturing its agreed name and price.
	const plans = await transaction.$queryRaw<{ id: string; name: string; price_rwf: bigint }[]>`
		SELECT id, name, price_rwf FROM public.organization_membership_plans
		WHERE organization_id = ${context.organizationId}::uuid
			AND id = ${input.membershipPlanId}::uuid AND archived_at IS NULL
		FOR SHARE
	`;
	const plan = plans[0];
	if (plan === undefined) throw memberNotFound();
	const dates = memberPeriod(input.startDate, input.periodUnit, input.periodCount);
	const overlapping = await transaction.organizationMemberSubscription.findFirst({
		where: {
			organizationId: context.organizationId,
			memberId,
			cancelledAt: null,
			startDate: { lte: dates.endDate },
			endDate: { gte: dates.startDate },
		},
		select: { id: true },
	});
	if (overlapping !== null) {
		throw memberConflict(
			'MEMBER_PERIOD_OVERLAP',
			'This member already has a registration covering these dates.',
		);
	}
	const row = await transaction.organizationMemberSubscription.create({
		data: {
			organizationId: context.organizationId,
			memberId,
			membershipPlanId: plan.id,
			planName: plan.name,
			priceRwf: plan.price_rwf,
			periodUnit: input.periodUnit,
			periodCount: input.periodCount,
			...dates,
			idempotencyKey: key,
			requestFingerprint: fingerprint,
			createdByUserId: context.actorUserId,
		},
		select: SUBSCRIPTION_SELECT,
	});
	return memberSubscriptionResponse(row);
}

export async function lockMember(
	transaction: Prisma.TransactionClient,
	organizationId: string,
	memberId: string,
): Promise<void> {
	const rows = await transaction.$queryRaw<{ id: string }[]>`
		SELECT id FROM public.organization_members
		WHERE organization_id = ${organizationId}::uuid AND id = ${memberId}::uuid
			AND archived_at IS NULL FOR UPDATE
	`;
	if (rows.length !== 1) throw memberNotFound();
}
