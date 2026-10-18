import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantTransactionService } from '@nexcoderw/gym-db';

import type { CreateMembershipPlanDto } from './dto/create-membership-plan.dto.js';
import {
	MembershipPlanStatusFilter,
	type ListMembershipPlansQueryDto,
} from './dto/list-membership-plans-query.dto.js';
import type { MembershipPlanListResponseDto } from './dto/membership-plan-list-response.dto.js';
import type { MembershipPlanResponseDto } from './dto/membership-plan-response.dto.js';
import type { UpdateMembershipPlanDto } from './dto/update-membership-plan.dto.js';
import {
	membershipPlanFailure,
	membershipPlanNotFound,
	staleMembershipPlan,
} from './owner-membership-plan-errors.js';
import {
	MEMBERSHIP_PLAN_SELECT,
	membershipPlanResponse,
} from './owner-membership-plan-mapping.js';
import { MEMBERSHIP_PLAN_PAGE_MAXIMUM } from './owner-membership-plans.constants.js';

@Injectable()
export class OwnerMembershipPlansService {
	constructor(private readonly tenants: TenantTransactionService) {}

	async list(
		organizationId: string,
		query: ListMembershipPlansQueryDto,
	): Promise<MembershipPlanListResponseDto> {
		if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MEMBERSHIP_PLAN_PAGE_MAXIMUM) {
			throw new BadRequestException({
				code: 'MEMBERSHIP_PLAN_PAGE_INVALID',
				message: `Page size must be between 1 and ${MEMBERSHIP_PLAN_PAGE_MAXIMUM}.`,
			});
		}
		try {
			return await this.tenants.run({ organizationId }, async (transaction) => {
				const lifecycle = membershipPlanLifecycleFilter(query.status);
				const where = { organizationId, ...lifecycle };
				if (query.cursor !== undefined) {
					const cursor = await transaction.organizationMembershipPlan.findFirst({
						where: { ...where, id: query.cursor },
						select: { id: true },
					});
					if (cursor === null) {
						throw new BadRequestException({
							code: 'MEMBERSHIP_PLAN_CURSOR_INVALID',
							message: 'The cursor is unavailable for this filter; restart pagination.',
						});
					}
				}
				const rows = await transaction.organizationMembershipPlan.findMany({
					where,
					orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
					take: query.limit + 1,
					...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
					select: MEMBERSHIP_PLAN_SELECT,
				});
				const page = rows.slice(0, query.limit);
				return {
					items: page.map(membershipPlanResponse),
					nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
				};
			});
		} catch (error: unknown) {
			throw membershipPlanFailure(error);
		}
	}

	async get(organizationId: string, planId: string): Promise<MembershipPlanResponseDto> {
		try {
			return await this.tenants.run({ organizationId }, async (transaction) => {
				const row = await transaction.organizationMembershipPlan.findFirst({
					where: { organizationId, id: planId },
					select: MEMBERSHIP_PLAN_SELECT,
				});
				if (row === null) throw membershipPlanNotFound();
				return membershipPlanResponse(row);
			});
		} catch (error: unknown) {
			throw membershipPlanFailure(error);
		}
	}

	async create(
		organizationId: string,
		input: CreateMembershipPlanDto,
	): Promise<MembershipPlanResponseDto> {
		try {
			return await this.tenants.run({ organizationId }, async (transaction) => {
				const row = await transaction.organizationMembershipPlan.create({
					data: {
						organizationId,
						name: input.name,
						normalizedName: normalizedMembershipPlanName(input.name),
						priceRwf: BigInt(input.price),
						description: input.description ?? null,
					},
					select: MEMBERSHIP_PLAN_SELECT,
				});
				return membershipPlanResponse(row);
			});
		} catch (error: unknown) {
			throw membershipPlanFailure(error);
		}
	}

	async update(
		organizationId: string,
		planId: string,
		input: UpdateMembershipPlanDto,
		expectedUpdatedAt: Date,
	): Promise<MembershipPlanResponseDto> {
		if (input.name === undefined && input.price === undefined && input.description === undefined) {
			throw new BadRequestException({
				code: 'MEMBERSHIP_PLAN_UPDATE_EMPTY',
				message: 'Supply at least one membership plan field to update.',
			});
		}
		try {
			return await this.tenants.run({ organizationId }, async (transaction) => {
				const previous = await transaction.organizationMembershipPlan.findFirst({
					where: { organizationId, id: planId, archivedAt: null },
					select: MEMBERSHIP_PLAN_SELECT,
				});
				if (previous === null) throw membershipPlanNotFound();
				if (previous.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
					throw staleMembershipPlan();
				}
				const updatedAt = monotonicTimestamp(previous.updatedAt);
				const result = await transaction.organizationMembershipPlan.updateMany({
					where: {
						organizationId,
						id: planId,
						archivedAt: null,
						updatedAt: expectedUpdatedAt,
					},
					data: {
						...(input.name === undefined
							? {}
							: {
									name: input.name,
									normalizedName: normalizedMembershipPlanName(input.name),
								}),
						...(input.price === undefined ? {} : { priceRwf: BigInt(input.price) }),
						...(input.description === undefined ? {} : { description: input.description }),
						updatedAt,
					},
				});
				if (result.count !== 1) throw staleMembershipPlan();
				const row = await transaction.organizationMembershipPlan.findFirst({
					where: { organizationId, id: planId },
					select: MEMBERSHIP_PLAN_SELECT,
				});
				if (row === null) throw membershipPlanNotFound();
				return membershipPlanResponse(row);
			});
		} catch (error: unknown) {
			throw membershipPlanFailure(error);
		}
	}

	async archive(organizationId: string, planId: string, expectedUpdatedAt: Date): Promise<void> {
		try {
			await this.tenants.run({ organizationId }, async (transaction) => {
				const previous = await transaction.organizationMembershipPlan.findFirst({
					where: { organizationId, id: planId, archivedAt: null },
					select: { updatedAt: true },
				});
				if (previous === null) throw membershipPlanNotFound();
				if (previous.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
					throw staleMembershipPlan();
				}
				const archivedAt = monotonicTimestamp(previous.updatedAt);
				const result = await transaction.organizationMembershipPlan.updateMany({
					where: {
						organizationId,
						id: planId,
						archivedAt: null,
						updatedAt: expectedUpdatedAt,
					},
					data: { archivedAt, updatedAt: archivedAt },
				});
				if (result.count !== 1) throw staleMembershipPlan();
			});
		} catch (error: unknown) {
			throw membershipPlanFailure(error);
		}
	}
}

function membershipPlanLifecycleFilter(status: MembershipPlanStatusFilter) {
	switch (status) {
		case MembershipPlanStatusFilter.ACTIVE:
			return { archivedAt: null };
		case MembershipPlanStatusFilter.ARCHIVED:
			return { archivedAt: { not: null } };
		case MembershipPlanStatusFilter.ALL:
			return {};
	}
}

export function normalizedMembershipPlanName(name: string): string {
	const normalized = name.normalize('NFKC').toLocaleLowerCase('en-US');
	if (normalized.length > 120) {
		throw new BadRequestException({
			code: 'MEMBERSHIP_PLAN_NAME_INVALID',
			message: 'The normalized membership plan name is too long.',
		});
	}
	return normalized;
}

function monotonicTimestamp(previous: Date): Date {
	return new Date(Math.max(Date.now(), previous.getTime() + 1));
}
