import { Injectable } from '@nestjs/common';
import { OrganizationMemberReminderStatus as ReminderStatus, PrismaService } from '@nexcoderw/gym-db';

import {
	ReminderActivityQueryDto,
	type ReminderActivityItemDto,
	type ReminderActivityResponseDto,
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

	async list(
		organizationId: string,
		query: ReminderActivityQueryDto,
	): Promise<ReminderActivityResponseDto> {
		const rows = await this.prisma.organizationMemberReminderDelivery.findMany({
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
