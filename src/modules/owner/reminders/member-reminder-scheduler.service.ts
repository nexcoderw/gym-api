import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
	OrganizationMemberReminderChannel as ReminderChannel,
	OrganizationMemberReminderKind as ReminderKind,
	OrganizationStatus,
	PrismaService,
	type Prisma,
} from '@nexcoderw/gym-db';

import { memberToday } from '../members/owner-member-mapping.js';
import { dueEmailReminder } from './member-reminder-policy.js';

const BATCH_SIZE = 100;
const MAX_BATCHES_PER_KIND = 20;
const EMAIL = ReminderChannel.EMAIL;

export interface ReminderScheduleResult {
	readonly scanned: number;
	readonly reserved: number;
	readonly capped: boolean;
}

export class MemberReminderSchedulerPrerequisiteError extends Error {
	constructor() {
		super('Member reminder scheduler database prerequisites are unavailable.');
	}
}

/** Explicit run-once system job. It reserves deliveries; it never calls an email provider. */
@Injectable()
export class MemberReminderSchedulerService {
	constructor(private readonly prisma: PrismaService) {}

	async runOnce(now = new Date()): Promise<ReminderScheduleResult> {
		await this.assertDatabase();
		const today = memberToday(now);
		const dueDate = dayAtOffset(today, 0);
		let scanned = 0;
		let reserved = 0;
		let capped = false;

		for (const [kind, daysUntilExpiry] of [
			[ReminderKind.THREE_DAYS_BEFORE, 3],
			[ReminderKind.EXPIRY_DAY, 0],
		] as const) {
			const expiryDate = dayAtOffset(today, daysUntilExpiry);
			for (let batchNumber = 0; batchNumber < MAX_BATCHES_PER_KIND; batchNumber += 1) {
				// The absence predicate makes each subsequent batch advance without a persisted cursor.
				// The database unique key also protects concurrent scheduler instances.
				const candidates = await this.prisma.organizationMemberSubscription.findMany({
					where: {
						endDate: expiryDate,
						startDate: { lte: dueDate },
						cancelledAt: null,
						organization: { is: { status: OrganizationStatus.ACTIVE } },
						member: {
							is: {
								archivedAt: null,
								email: { not: null },
								reminderEmailOptedOutAt: null,
								reminderEmailSuppressedAt: null,
							},
						},
						reminderDeliveries: { none: { kind, channel: EMAIL } },
					},
					select: {
						id: true,
						organizationId: true,
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
					orderBy: { id: 'asc' },
					take: BATCH_SIZE,
				});
				if (candidates.length === 0) break;
				scanned += candidates.length;
				const data: Prisma.OrganizationMemberReminderDeliveryCreateManyInput[] = [];
				for (const candidate of candidates) {
					const email = candidate.member.email;
					if (
						email === null ||
						dueEmailReminder(
							{
								email,
								memberArchivedAt: candidate.member.archivedAt,
								emailOptedOutAt: candidate.member.reminderEmailOptedOutAt,
								emailSuppressedAt: candidate.member.reminderEmailSuppressedAt,
								subscriptionCancelledAt: candidate.cancelledAt,
								startDate: dateOnly(candidate.startDate),
								endDate: dateOnly(candidate.endDate),
							},
							today,
						) !== kind
					) {
						continue;
					}
					data.push({
						id: randomUUID(),
						organizationId: candidate.organizationId,
						memberId: candidate.memberId,
						memberSubscriptionId: candidate.id,
						kind,
						channel: EMAIL,
						dueDate,
						recipientEmail: email.trim(),
						nextAttemptAt: now,
						providerIdempotencyKey: providerKey(candidate.organizationId, candidate.id, kind),
					});
				}
				if (data.length > 0) {
					const result = await this.prisma.organizationMemberReminderDelivery.createMany({
						data,
						skipDuplicates: true,
					});
					reserved += result.count;
				}
				if (candidates.length < BATCH_SIZE) break;
				if (batchNumber === MAX_BATCHES_PER_KIND - 1) capped = true;
			}
		}
		return { scanned, reserved, capped };
	}

	private async assertDatabase(): Promise<void> {
		const rows = await this.prisma.$queryRaw<{ ready: boolean }[]>`
			SELECT (
				COALESCE(has_table_privilege(current_user,
					to_regclass('public.organization_member_reminder_deliveries'), 'SELECT'), false)
				AND COALESCE(has_table_privilege(current_user,
					to_regclass('public.organization_member_reminder_deliveries'), 'INSERT'), false)
				AND EXISTS (SELECT 1 FROM pg_catalog.pg_index
					WHERE indexrelid = to_regclass('public.member_reminder_deliveries_once_per_kind_key')
					AND indisvalid AND indisunique)
				AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
					WHERE conrelid = to_regclass('public.organization_member_reminder_deliveries')
					AND conname = 'member_reminder_deliveries_recipient_check' AND convalidated)
			) AS ready
		`;
		if (rows[0]?.ready !== true) throw new MemberReminderSchedulerPrerequisiteError();
	}
}

function dayAtOffset(today: string, offset: number): Date {
	const date = new Date(`${today}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + offset);
	return date;
}

function dateOnly(value: Date): string {
	return value.toISOString().slice(0, 10);
}

function providerKey(organizationId: string, subscriptionId: string, kind: ReminderKind): string {
	return createHash('sha256')
		.update(['member-reminder-v1', organizationId, subscriptionId, kind, EMAIL].join('\x1f'))
		.digest('hex');
}
