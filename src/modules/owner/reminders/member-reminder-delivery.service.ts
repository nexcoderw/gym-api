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
				messageSubject: null,
				messageBody: null,
			},
		});
		const candidates = await this.prisma.organizationMemberReminderDelivery.findMany({
			where: {
				kind: ReminderKind.MANUAL,
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
			const endDate = row.subscription.endDate.toISOString().slice(0, 10);
			const eligible =
				row.kind === ReminderKind.MANUAL &&
				row.organization.status === OrganizationStatus.ACTIVE &&
				row.recipientEmail !== null &&
				row.member.email?.toLowerCase() === row.recipientEmail.toLowerCase() &&
				row.dueDate.toISOString().slice(0, 10) <= today &&
				row.member.archivedAt === null &&
				row.member.reminderEmailOptedOutAt === null &&
				row.member.reminderEmailSuppressedAt === null &&
				row.subscription.cancelledAt === null &&
				row.subscription.startDate.toISOString().slice(0, 10) <= today &&
				endDate >= today &&
				endDate <= addDays(today, 14) &&
				row.messageSubject !== null &&
				row.messageBody !== null;
			if (
				!eligible ||
				row.recipientEmail === null ||
				row.messageSubject === null ||
				row.messageBody === null
			) {
				await this.finalize(row, lease, {
					status: ReminderStatus.SKIPPED,
					lastErrorCode: 'DELIVERY_INELIGIBLE',
					messageSubject: null,
					messageBody: null,
				});
				skipped += 1;
				continue;
			}
			let outcome: MemberReminderProviderOutcome;
			try {
				outcome = await this.email.send({
					recipient: row.recipientEmail,
					organizationName: row.organization.name,
					subject: row.messageSubject,
					body: row.messageBody,
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
					messageSubject: null,
					messageBody: null,
				});
				accepted += 1;
			} else if (outcome.kind === 'uncertain') {
				await this.finalize(row, lease, {
					status: ReminderStatus.UNCERTAIN,
					lastErrorCode: outcome.code,
					messageSubject: null,
					messageBody: null,
				});
				uncertain += 1;
			} else {
				const retry = outcome.retryable && row.attemptCount < MAX_ATTEMPTS;
				await this.finalize(row, lease, {
					status: ReminderStatus.FAILED,
					lastErrorCode: outcome.code,
					nextAttemptAt: retry ? new Date(now.getTime() + 60_000 * 2 ** row.attemptCount) : null,
					...(retry ? {} : { messageSubject: null, messageBody: null }),
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
