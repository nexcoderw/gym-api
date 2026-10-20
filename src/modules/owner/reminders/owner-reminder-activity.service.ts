import { createHash, randomUUID } from 'node:crypto';

import {
	ConflictException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import {
	OrganizationMemberReminderChannel as ReminderChannel,
	OrganizationMemberReminderKind as ReminderKind,
	OrganizationMemberReminderStatus as ReminderStatus,
	PrismaService,
} from '@nexcoderw/gym-db';

import { memberToday } from '../members/owner-member-mapping.js';
import {
	ReminderActivityQueryDto,
	type ReminderActivityItemDto,
	type ReminderActivityResponseDto,
	QueuedReminderResponseDto,
	UpcomingReminderQueryDto,
	type UpcomingReminderResponseDto,
} from './dto/reminder-activity.dto.js';

const VISIBLE_STATUSES = [
	ReminderStatus.ACCEPTED,
	ReminderStatus.DELIVERED,
	ReminderStatus.BOUNCED,
	ReminderStatus.FAILED,
	ReminderStatus.UNCERTAIN,
] as const;

/** Read-only owner activity; provider identifiers and recipient addresses remain private. */
@Injectable()
export class OwnerReminderActivityService {
	constructor(private readonly prisma: PrismaService) {}

	async upcoming(
		organizationId: string,
		query: UpcomingReminderQueryDto,
		now = new Date(),
	): Promise<UpcomingReminderResponseDto> {
		const today = memberToday(now);
		const end = addDays(today, 14);
		if (query.cursor !== undefined) {
			const cursor = await this.prisma.organizationMemberSubscription
				.findFirst({ where: { id: query.cursor, organizationId }, select: { id: true } })
				.catch((error: unknown) => { throw reminderUnavailable(error); });
			if (cursor === null) throw new NotFoundException('Reminder page is no longer available.');
		}
		const rows = await this.prisma.organizationMemberSubscription
			.findMany({
				where: {
					organizationId,
					cancelledAt: null,
					startDate: { lte: new Date(`${today}T00:00:00.000Z`) },
					endDate: {
						gte: new Date(`${today}T00:00:00.000Z`),
						lte: new Date(`${end}T00:00:00.000Z`),
					},
					member: { is: { archivedAt: null } },
				},
				select: {
					id: true,
					memberId: true,
					planName: true,
					endDate: true,
					member: {
						select: {
							name: true,
							email: true,
							reminderEmailOptedOutAt: true,
							reminderEmailSuppressedAt: true,
						},
					},
					reminderDeliveries: {
						where: { kind: ReminderKind.MANUAL, channel: ReminderChannel.EMAIL },
						select: { status: true },
						take: 1,
					},
				},
				orderBy: [{ endDate: 'asc' }, { id: 'asc' }],
				...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
				take: query.limit + 1,
			})
			.catch((error: unknown) => { throw reminderUnavailable(error); });
		const hasMore = rows.length > query.limit;
		return {
			items: rows.slice(0, query.limit).map((row) => ({
				subscriptionId: row.id,
				memberId: row.memberId,
				memberName: row.member.name,
				planName: row.planName,
				endDate: row.endDate.toISOString().slice(0, 10),
				daysRemaining: daysBetween(today, row.endDate.toISOString().slice(0, 10)),
				canSend:
					row.member.email !== null &&
					row.member.email.trim() !== '' &&
					row.member.reminderEmailOptedOutAt === null &&
					row.member.reminderEmailSuppressedAt === null &&
					row.reminderDeliveries.length === 0,
				manualStatus: row.reminderDeliveries[0]?.status ?? null,
			})),
			nextCursor: hasMore ? rows[query.limit - 1]?.id ?? null : null,
		};
	}

	async queueManual(
		organizationId: string,
		subscriptionId: string,
		now = new Date(),
	): Promise<QueuedReminderResponseDto> {
		const today = memberToday(now);
		const row = await this.prisma.organizationMemberSubscription
			.findFirst({
				where: { id: subscriptionId, organizationId },
				select: {
					id: true,
					memberId: true,
					startDate: true,
					endDate: true,
					cancelledAt: true,
					member: {
						select: {
							email: true,
							archivedAt: true,
							reminderEmailOptedOutAt: true,
							reminderEmailSuppressedAt: true,
						},
					},
				},
			})
			.catch((error: unknown) => { throw reminderUnavailable(error); });
		if (row === null) throw new NotFoundException('Membership registration not found.');
		const email = row.member.email?.trim();
		if (
			row.cancelledAt !== null ||
			row.member.archivedAt !== null ||
			row.member.reminderEmailOptedOutAt !== null ||
			row.member.reminderEmailSuppressedAt !== null ||
			email === undefined ||
			email === '' ||
			row.startDate.toISOString().slice(0, 10) > today ||
			row.endDate.toISOString().slice(0, 10) < today ||
			row.endDate.toISOString().slice(0, 10) > addDays(today, 14)
		) {
			throw new ConflictException('This membership is not eligible for an email reminder.');
		}
		const id = randomUUID();
		const providerIdempotencyKey = createHash('sha256')
			.update(['member-reminder-v1', organizationId, subscriptionId, ReminderKind.MANUAL, ReminderChannel.EMAIL].join('\x1f'))
			.digest('hex');
		const created = await this.prisma.organizationMemberReminderDelivery
			.createMany({
				data: [{
					id,
					organizationId,
					memberId: row.memberId,
					memberSubscriptionId: subscriptionId,
					kind: ReminderKind.MANUAL,
					channel: ReminderChannel.EMAIL,
					dueDate: new Date(`${today}T00:00:00.000Z`),
					recipientEmail: email,
					nextAttemptAt: now,
					providerIdempotencyKey,
				}],
				skipDuplicates: true,
			})
			.catch((error: unknown) => { throw reminderUnavailable(error); });
		if (created.count !== 1) {
			throw new ConflictException('A manual reminder already exists for this membership.');
		}
		return { id, status: ReminderStatus.QUEUED };
	}

	async list(
		organizationId: string,
		query: ReminderActivityQueryDto,
	): Promise<ReminderActivityResponseDto> {
		const rows = await this.prisma.organizationMemberReminderDelivery
			.findMany({
				where: { organizationId, status: { in: [...VISIBLE_STATUSES] } },
				select: {
					id: true,
					memberId: true,
					kind: true,
					status: true,
					dueDate: true,
					acceptedAt: true,
					deliveredAt: true,
					member: { select: { name: true } },
					subscription: { select: { planName: true, endDate: true } },
				},
				orderBy: [{ dueDate: 'desc' }, { id: 'desc' }],
				take: query.limit,
			})
			.catch((error: unknown) => {
				throw new ServiceUnavailableException(
					{
						code: 'REMINDER_ACTIVITY_UNAVAILABLE',
						message: 'Reminder activity is temporarily unavailable.',
					},
					{ cause: error },
				);
			});
		return {
			items: rows.map((row): ReminderActivityItemDto => ({
				id: row.id,
				memberId: row.memberId,
				memberName: row.member.name,
				planName: row.subscription.planName,
				kind: row.kind,
				status: row.status,
				dueDate: row.dueDate.toISOString().slice(0, 10),
				endDate: row.subscription.endDate.toISOString().slice(0, 10),
				acceptedAt: row.acceptedAt?.toISOString() ?? null,
				deliveredAt: row.deliveredAt?.toISOString() ?? null,
			})),
		};
	}
}

function addDays(day: string, count: number): string {
	const value = new Date(`${day}T00:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() + count);
	return value.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
	return Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000);
}

function reminderUnavailable(cause: unknown): ServiceUnavailableException {
	return new ServiceUnavailableException({
		code: 'REMINDER_ACTIVITY_UNAVAILABLE',
		message: 'Reminder activity is temporarily unavailable.',
	}, { cause });
}
