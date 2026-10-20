import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { TenantTransactionService, type Prisma } from '@nexcoderw/gym-db';

import { databaseErrorCode } from '../../../common/errors/database-error-code.js';
import { listDateRange } from '../list-date-range.js';
import type { CreateMemberDto } from './dto/create-member.dto.js';
import {
	MemberStatusFilter,
	MemberOrder,
	type ListMembersQueryDto,
	type MemberPageQueryDto,
} from './dto/list-members.dto.js';
import type {
	MemberListResponseDto,
	MemberRegistrationResponseDto,
	MemberResponseDto,
	MemberSubscriptionListResponseDto,
	MemberSubscriptionResponseDto,
} from './dto/member-response.dto.js';
import type { RegisterMemberSubscriptionDto } from './dto/register-member-subscription.dto.js';
import type { UpdateMemberDto } from './dto/update-member.dto.js';
import { memberName, memberPhone } from './member-normalization.js';
import { memberPeriod } from './member-period.js';
import { lockMember, registerMemberPlan } from './member-plan-registration.js';
import type { OwnerMemberContext } from './owner-member-context.js';
import {
	memberConflict,
	memberFailure,
	memberNotFound,
	staleMember,
} from './owner-member-errors.js';
import {
	MEMBER_SELECT,
	SUBSCRIPTION_SELECT,
	memberResponse,
	memberSubscriptionResponse,
	memberToday,
} from './owner-member-mapping.js';

@Injectable()
export class OwnerMembersService {
	constructor(private readonly tenants: TenantTransactionService) {}

	async list(
		context: OwnerMemberContext,
		query: ListMembersQueryDto,
	): Promise<MemberListResponseDto> {
		try {
			return await this.tenants.run(context, async (transaction) => {
				const search = query.search?.trim();
				const dateRange = listDateRange(query.fromDate, query.toDate);
				const where: Prisma.OrganizationMemberWhereInput = {
					organizationId: context.organizationId,
					archivedAt: query.status === MemberStatusFilter.ARCHIVED ? { not: null } : null,
					...(search
						? {
								OR: [
									{ name: { contains: search, mode: 'insensitive' } },
									{ phoneNumber: { contains: search } },
									{ email: { contains: search, mode: 'insensitive' } },
								],
							}
						: {}),
					...(Object.keys(dateRange).length ? { createdAt: dateRange } : {}),
				};
				if (query.cursor !== undefined) {
					const cursor = await transaction.organizationMember.findFirst({
						where: { ...where, id: query.cursor },
						select: { id: true },
					});
					if (cursor === null) throw invalidCursor();
				}
				const rows = await transaction.organizationMember.findMany({
					where,
					select: MEMBER_SELECT,
					orderBy: memberOrder(query.order),
					take: query.limit + 1,
					...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
				});
				const page = rows.slice(0, query.limit);
				return {
					items: page.map(memberResponse),
					nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
				};
			});
		} catch (error: unknown) {
			throw memberFailure(error);
		}
	}

	async get(context: OwnerMemberContext, memberId: string): Promise<MemberResponseDto> {
		try {
			return await this.tenants.run(context, async (transaction) => {
				const member = await transaction.organizationMember.findFirst({
					where: { organizationId: context.organizationId, id: memberId },
					select: MEMBER_SELECT,
				});
				if (member === null) throw memberNotFound();
				return memberResponse(member);
			});
		} catch (error: unknown) {
			throw memberFailure(error);
		}
	}

	async create(
		context: OwnerMemberContext,
		input: CreateMemberDto,
		key: string,
	): Promise<MemberRegistrationResponseDto> {
		const profile = {
			...memberName(input.name),
			phoneNumber: memberPhone(input.phoneNumber),
			email: input.email ?? null,
		};
		memberPeriod(
			input.subscription.startDate,
			input.subscription.periodUnit,
			input.subscription.periodCount,
		);
		const fingerprint = requestFingerprint([
			'create',
			profile.name,
			profile.normalizedName,
			profile.phoneNumber,
			profile.email,
			input.subscription.membershipPlanId,
			input.subscription.startDate,
			input.subscription.periodUnit,
			input.subscription.periodCount,
		]);
		return this.registration(context, key, fingerprint, async (transaction) => {
			const member = await transaction.organizationMember.create({
				data: { organizationId: context.organizationId, ...profile },
				select: MEMBER_SELECT,
			});
			const subscription = await registerMemberPlan(
				transaction,
				context,
				member.id,
				input.subscription,
				key,
				fingerprint,
			);
			return { member: memberResponse(member), subscription };
		});
	}

	async renew(
		context: OwnerMemberContext,
		memberId: string,
		input: RegisterMemberSubscriptionDto,
		key: string,
	): Promise<MemberSubscriptionResponseDto> {
		memberPeriod(input.startDate, input.periodUnit, input.periodCount);
		const fingerprint = requestFingerprint([
			'renew',
			memberId,
			input.membershipPlanId,
			input.startDate,
			input.periodUnit,
			input.periodCount,
		]);
		const registration = await this.registration(context, key, fingerprint, async (transaction) => {
			const subscription = await registerMemberPlan(
				transaction,
				context,
				memberId,
				input,
				key,
				fingerprint,
			);
			const member = await transaction.organizationMember.findFirst({
				where: { organizationId: context.organizationId, id: memberId },
				select: MEMBER_SELECT,
			});
			if (member === null) throw memberNotFound();
			return { member: memberResponse(member), subscription };
		});
		return registration.subscription;
	}

	async update(
		context: OwnerMemberContext,
		memberId: string,
		input: UpdateMemberDto,
		expected: Date,
	): Promise<MemberResponseDto> {
		if (input.name === undefined && input.phoneNumber === undefined && input.email === undefined) {
			throw new BadRequestException({
				code: 'MEMBER_UPDATE_EMPTY',
				message: 'Supply at least one profile field.',
			});
		}
		const data = {
			...(input.name === undefined ? {} : memberName(input.name)),
			...(input.phoneNumber === undefined ? {} : { phoneNumber: memberPhone(input.phoneNumber) }),
			...(input.email === undefined ? {} : { email: input.email }),
			updatedAt: new Date(Math.max(Date.now(), expected.getTime() + 1)),
		};
		try {
			return await this.tenants.run(context, async (transaction) => {
				await lockMember(transaction, context.organizationId, memberId);
				const result = await transaction.organizationMember.updateMany({
					where: {
						organizationId: context.organizationId,
						id: memberId,
						archivedAt: null,
						updatedAt: expected,
					},
					data,
				});
				if (result.count !== 1) throw staleMember();
				const member = await transaction.organizationMember.findFirst({
					where: { organizationId: context.organizationId, id: memberId },
					select: MEMBER_SELECT,
				});
				if (member === null) throw memberNotFound();
				return memberResponse(member);
			});
		} catch (error: unknown) {
			throw memberFailure(error);
		}
	}

	async archive(context: OwnerMemberContext, memberId: string, expected: Date): Promise<void> {
		try {
			await this.tenants.run(context, async (transaction) => {
				await lockMember(transaction, context.organizationId, memberId);
				const active = await transaction.organizationMemberSubscription.findFirst({
					where: {
						organizationId: context.organizationId,
						memberId,
						cancelledAt: null,
						endDate: { gte: new Date(`${memberToday()}T00:00:00.000Z`) },
					},
					select: { id: true },
				});
				if (active !== null)
					throw memberConflict(
						'MEMBER_HAS_VALID_REGISTRATION',
						'Cancel current and future registrations before archiving this member.',
					);
				const archivedAt = new Date(Math.max(Date.now(), expected.getTime() + 1));
				const result = await transaction.organizationMember.updateMany({
					where: {
						organizationId: context.organizationId,
						id: memberId,
						archivedAt: null,
						updatedAt: expected,
					},
					data: { archivedAt, updatedAt: archivedAt },
				});
				if (result.count !== 1) throw staleMember();
			});
		} catch (error: unknown) {
			throw memberFailure(error);
		}
	}

	async subscriptions(
		context: OwnerMemberContext,
		memberId: string,
		query: MemberPageQueryDto,
	): Promise<MemberSubscriptionListResponseDto> {
		try {
			return await this.tenants.run(context, async (transaction) => {
				const member = await transaction.organizationMember.findFirst({
					where: { organizationId: context.organizationId, id: memberId },
					select: { id: true },
				});
				if (member === null) throw memberNotFound();
				const where = { organizationId: context.organizationId, memberId };
				if (query.cursor !== undefined) {
					const cursor = await transaction.organizationMemberSubscription.findFirst({
						where: { ...where, id: query.cursor },
						select: { id: true },
					});
					if (cursor === null) throw invalidCursor();
				}
				const rows = await transaction.organizationMemberSubscription.findMany({
					where,
					select: SUBSCRIPTION_SELECT,
					orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
					take: query.limit + 1,
					...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
				});
				const page = rows.slice(0, query.limit);
				const today = memberToday();
				return {
					items: page.map((row) => memberSubscriptionResponse(row, today)),
					nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
				};
			});
		} catch (error: unknown) {
			throw memberFailure(error);
		}
	}

	async cancel(
		context: OwnerMemberContext,
		memberId: string,
		subscriptionId: string,
	): Promise<MemberSubscriptionResponseDto> {
		try {
			return await this.tenants.run(context, async (transaction) => {
				// Cancellation and renewal lock the same member first to serialize overlap decisions.
				await lockMember(transaction, context.organizationId, memberId);
				const where = { organizationId: context.organizationId, memberId, id: subscriptionId };
				await transaction.organizationMemberSubscription.updateMany({
					where: { ...where, cancelledAt: null },
					data: { cancelledAt: new Date(), cancelledByUserId: context.actorUserId },
				});
				const row = await transaction.organizationMemberSubscription.findFirst({
					where,
					select: SUBSCRIPTION_SELECT,
				});
				if (row === null) throw memberNotFound();
				return memberSubscriptionResponse(row);
			});
		} catch (error: unknown) {
			throw memberFailure(error);
		}
	}

	private async registration(
		context: OwnerMemberContext,
		key: string,
		fingerprint: string,
		operation: (transaction: Prisma.TransactionClient) => Promise<MemberRegistrationResponseDto>,
	): Promise<MemberRegistrationResponseDto> {
		try {
			return await this.tenants.run(context, async (transaction) => {
				const replay = await registrationReplay(
					transaction,
					context.organizationId,
					key,
					fingerprint,
				);
				return replay ?? operation(transaction);
			});
		} catch (error: unknown) {
			// Two simultaneous identical requests may race on the unique key. Recover only that key.
			if (databaseErrorCode(error) === 'P2002' || isOverlap(error)) {
				try {
					const replay = await this.tenants.run(context, (transaction) =>
						registrationReplay(transaction, context.organizationId, key, fingerprint),
					);
					if (replay !== null) return replay;
				} catch (replayError: unknown) {
					throw memberFailure(replayError);
				}
			}
			throw memberFailure(error);
		}
	}
}

function memberOrder(order: MemberOrder): Prisma.OrganizationMemberOrderByWithRelationInput[] {
	if (order === MemberOrder.OLDEST) return [{ createdAt: 'asc' }, { id: 'asc' }];
	if (order === MemberOrder.NAME_ASC) return [{ name: 'asc' }, { id: 'asc' }];
	if (order === MemberOrder.NAME_DESC) return [{ name: 'desc' }, { id: 'asc' }];
	return [{ createdAt: 'desc' }, { id: 'asc' }];
}

async function registrationReplay(
	transaction: Prisma.TransactionClient,
	organizationId: string,
	key: string,
	fingerprint: string,
): Promise<MemberRegistrationResponseDto | null> {
	const row = await transaction.organizationMemberSubscription.findFirst({
		where: { organizationId, idempotencyKey: key },
		select: { ...SUBSCRIPTION_SELECT, requestFingerprint: true, member: { select: MEMBER_SELECT } },
	});
	if (row === null) return null;
	if (row.requestFingerprint !== fingerprint)
		throw memberConflict(
			'MEMBER_IDEMPOTENCY_CONFLICT',
			'This idempotency key was already used for a different registration.',
		);
	return { member: memberResponse(row.member), subscription: memberSubscriptionResponse(row) };
}

function requestFingerprint(input: readonly (string | number | null)[]): string {
	return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function invalidCursor(): BadRequestException {
	return new BadRequestException({
		code: 'MEMBER_CURSOR_INVALID',
		message: 'Restart pagination with a cursor from the same gym and filter.',
	});
}

function isOverlap(error: unknown): boolean {
	if (!(error instanceof ConflictException)) return false;
	const response = error.getResponse();
	return (
		typeof response === 'object' && 'code' in response && response.code === 'MEMBER_PERIOD_OVERLAP'
	);
}
