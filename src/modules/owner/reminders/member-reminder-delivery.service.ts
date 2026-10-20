import { Injectable } from '@nestjs/common';
import {
	OrganizationMemberReminderChannel as ReminderChannel,
	OrganizationMemberReminderKind as ReminderKind,
	OrganizationMemberReminderStatus as ReminderStatus,
	OrganizationStatus,
	PrismaService,
	type OrganizationMemberReminderDelivery,
	type Prisma,
} from '@nexcoderw/gym-db';

import {
	ResendMemberReminderEmailService,
	type MemberReminderProviderOutcome,
} from '../../../infrastructure/email/resend-member-reminder-email.service.js';
import { memberToday } from '../members/owner-member-mapping.js';
import { dueEmailReminder } from './member-reminder-policy.js';

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 3;
const LEASE_MS = 30_000;

export interface ReminderDeliveryResult {
	readonly claimed: number;
	readonly accepted: number;
	readonly skipped: number;
	readonly uncertain: number;
}

/** Run-once delivery process. A stale lease becomes UNCERTAIN, never an automatic resend. */
@Injectable()
export class MemberReminderDeliveryService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly email: ResendMemberReminderEmailService,
	) {}

	async runOnce(now = new Date()): Promise<ReminderDeliveryResult> {
		await this.assertDatabase();
		await this.prisma.organizationMemberReminderDelivery.updateMany({
			where: {
				status: ReminderStatus.PROCESSING,
				leaseExpiresAt: { lte: now },
			},
			data: {
				status: ReminderStatus.UNCERTAIN,
				leaseExpiresAt: null,
				lastErrorCode: 'WORKER_LEASE_EXPIRED',
			},
		});
		const candidates = await this.prisma.organizationMemberReminderDelivery.findMany({
			where: {
				channel: ReminderChannel.EMAIL,
				status: { in: [ReminderStatus.QUEUED, ReminderStatus.FAILED] },
				attemptCount: { lt: MAX_ATTEMPTS },
				nextAttemptAt: { lte: now },
			},
			select: { id: true, organizationId: true, status: true, attemptCount: true },
			orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
			take: BATCH_SIZE,
		});
		let claimed = 0;
		let accepted = 0;
		let skipped = 0;
		let uncertain = 0;
		for (const candidate of candidates) {
			const lease = new Date(now.getTime() + LEASE_MS);
			const result = await this.prisma.organizationMemberReminderDelivery.updateMany({
				where: {
					id: candidate.id,
					organizationId: candidate.organizationId,
					status: candidate.status,
					attemptCount: candidate.attemptCount,
					nextAttemptAt: { lte: now },
				},
				data: {
					status: ReminderStatus.PROCESSING,
					attemptCount: { increment: 1 },
					nextAttemptAt: null,
					leaseExpiresAt: lease,
					lastErrorCode: null,
				},
			});
			if (result.count !== 1) continue;
			claimed += 1;
			const row = await this.prisma.organizationMemberReminderDelivery.findFirst({
				where: { id: candidate.id, organizationId: candidate.organizationId },
				include: { member: true, subscription: true, organization: true },
			});
			if (row === null) throw new Error('Claimed reminder disappeared.');
			if (
				row.status !== ReminderStatus.PROCESSING ||
				row.leaseExpiresAt?.getTime() !== lease.getTime()
			) {
				throw new Error('Reminder lease changed before submission.');
			}
			const today = memberToday(now);
			const candidate = {
				email: row.member.email,
				memberArchivedAt: row.member.archivedAt,
				emailOptedOutAt: row.member.reminderEmailOptedOutAt,
				emailSuppressedAt: row.member.reminderEmailSuppressedAt,
				subscriptionCancelledAt: row.subscription.cancelledAt,
				startDate: row.subscription.startDate.toISOString().slice(0, 10),
				endDate: row.subscription.endDate.toISOString().slice(0, 10),
			};
			const eligible =
				row.organization.status === OrganizationStatus.ACTIVE &&
				row.recipientEmail !== null &&
				row.member.email?.toLowerCase() === row.recipientEmail.toLowerCase() &&
				(row.kind === ReminderKind.MANUAL
					? row.dueDate.toISOString().slice(0, 10) <= today
					: row.dueDate.toISOString().slice(0, 10) === today) &&
				(row.kind === ReminderKind.MANUAL
					? candidate.email !== null &&
						candidate.email.trim() !== '' &&
						candidate.memberArchivedAt === null &&
						candidate.emailOptedOutAt === null &&
						candidate.emailSuppressedAt === null &&
						candidate.subscriptionCancelledAt === null &&
						candidate.startDate <= today &&
						candidate.endDate >= today &&
						candidate.endDate <= addDays(today, 14)
					: dueEmailReminder(candidate, today) === row.kind);
			if (!eligible || row.recipientEmail === null) {
				await this.finalize(row, lease, {
					status: ReminderStatus.SKIPPED,
					lastErrorCode: 'DELIVERY_INELIGIBLE',
				});
				skipped += 1;
				continue;
			}
			let outcome: MemberReminderProviderOutcome;
			try {
				outcome = await this.email.send({
					recipient: row.recipientEmail,
					organizationName: row.organization.name,
					planName: row.subscription.planName,
					endDate: row.subscription.endDate.toISOString().slice(0, 10),
					kind: row.kind,
					idempotencyKey: row.providerIdempotencyKey,
				});
			} catch {
				outcome = { kind: 'uncertain', code: 'PROVIDER_OUTCOME_UNKNOWN' };
			}
			if (outcome.kind === 'accepted') {
				await this.finalize(row, lease, {
					status: ReminderStatus.ACCEPTED,
					providerMessageId: outcome.messageId,
					acceptedAt: now,
					lastErrorCode: null,
				});
				accepted += 1;
			} else if (outcome.kind === 'uncertain') {
				await this.finalize(row, lease, {
					status: ReminderStatus.UNCERTAIN,
					lastErrorCode: outcome.code,
				});
				uncertain += 1;
			} else {
				const retry = outcome.retryable && row.attemptCount < MAX_ATTEMPTS;
				await this.finalize(row, lease, {
					status: ReminderStatus.FAILED,
					lastErrorCode: outcome.code,
					nextAttemptAt: retry ? new Date(now.getTime() + 60_000 * 2 ** row.attemptCount) : null,
				});
			}
		}
		return { claimed, accepted, skipped, uncertain };
	}

	private async finalize(
		row: OrganizationMemberReminderDelivery,
		lease: Date,
		data: Prisma.OrganizationMemberReminderDeliveryUpdateManyMutationInput,
	): Promise<void> {
		const result = await this.prisma.organizationMemberReminderDelivery.updateMany({
			where: {
				id: row.id,
				organizationId: row.organizationId,
				status: ReminderStatus.PROCESSING,
				leaseExpiresAt: lease,
			},
			data: { ...data, leaseExpiresAt: null },
		});
		if (result.count !== 1) throw new Error('Reminder delivery finalization is uncertain.');
	}

	private async assertDatabase(): Promise<void> {
		const rows = await this.prisma.$queryRaw<{ ready: boolean }[]>`
			SELECT (
				COALESCE(has_table_privilege(current_user,
					to_regclass('public.organization_member_reminder_deliveries'), 'SELECT'), false)
				AND COALESCE(has_table_privilege(current_user,
					to_regclass('public.organization_member_reminder_deliveries'), 'UPDATE'), false)
			) AS ready
		`;
		if (rows[0]?.ready !== true) throw new Error('Reminder delivery database is not ready.');
	}
}

function addDays(day: string, count: number): string {
	const value = new Date(`${day}T00:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() + count);
	return value.toISOString().slice(0, 10);
}
