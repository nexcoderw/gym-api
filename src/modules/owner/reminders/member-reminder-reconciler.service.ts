import { Injectable } from '@nestjs/common';
import {
	OrganizationMemberEmailSuppressionReason as SuppressionReason,
	OrganizationMemberReminderChannel as ReminderChannel,
	OrganizationMemberReminderStatus as ReminderStatus,
	PrismaService,
} from '@nexcoderw/gym-db';

import {
	ResendMemberReminderStatusService,
	type ReminderProviderStatus,
} from '../../../infrastructure/email/resend-member-reminder-status.service.js';

const BATCH_SIZE = 25;
const POLL_INTERVAL_MS = 5 * 60_000;
const PROVIDER_RETENTION_MS = 30 * 24 * 60 * 60_000;

export interface ReminderReconciliationResult {
	readonly checked: number;
	readonly delivered: number;
	readonly bounced: number;
	readonly complained: number;
	readonly failed: number;
	readonly unavailable: number;
}

/** Explicit run-once status reconciliation, with no webhook or outbound email side effect. */
@Injectable()
export class MemberReminderReconcilerService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly provider: ResendMemberReminderStatusService,
	) {}

	async runOnce(now = new Date()): Promise<ReminderReconciliationResult> {
		await this.assertDatabase();
		const rows = await this.prisma.organizationMemberReminderDelivery.findMany({
			where: {
				channel: ReminderChannel.EMAIL,
				status: ReminderStatus.ACCEPTED,
				providerMessageId: { not: null },
				acceptedAt: { gte: new Date(now.getTime() - PROVIDER_RETENTION_MS) },
				updatedAt: { lte: new Date(now.getTime() - POLL_INTERVAL_MS) },
			},
			select: {
				id: true,
				organizationId: true,
				memberId: true,
				recipientEmail: true,
				providerMessageId: true,
			},
			orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
			take: BATCH_SIZE,
		});
		const result = {
			checked: 0,
			delivered: 0,
			bounced: 0,
			complained: 0,
			failed: 0,
			unavailable: 0,
		};
		for (const row of rows) {
			if (row.providerMessageId === null || row.recipientEmail === null) continue;
			result.checked += 1;
			const state = await this.provider.get(row.providerMessageId, row.recipientEmail);
			if (state.kind === 'unavailable') result.unavailable += 1;
			const changed = await this.record(
				{
					id: row.id,
					organizationId: row.organizationId,
					memberId: row.memberId,
					recipientEmail: row.recipientEmail,
					providerMessageId: row.providerMessageId,
				},
				state,
				now,
			);
			if (changed && state.kind !== 'pending' && state.kind !== 'unavailable') {
				result[state.kind] += 1;
			}
		}
		return result;
	}

	private async record(
		row: {
			readonly id: string;
			readonly organizationId: string;
			readonly memberId: string;
			readonly recipientEmail: string;
			readonly providerMessageId: string;
		},
		state: ReminderProviderStatus,
		now: Date,
	): Promise<boolean> {
		return this.prisma.$transaction(async (transaction) => {
			const result = await transaction.organizationMemberReminderDelivery.updateMany({
				where: {
					id: row.id,
					organizationId: row.organizationId,
					status: ReminderStatus.ACCEPTED,
					providerMessageId: row.providerMessageId,
				},
				data: {
					updatedAt: now,
					...(state.kind === 'delivered'
						? { status: ReminderStatus.DELIVERED, deliveredAt: now, lastErrorCode: null }
						: state.kind === 'bounced'
							? { status: ReminderStatus.BOUNCED, lastErrorCode: 'PROVIDER_BOUNCED' }
							: state.kind === 'complained'
								? { status: ReminderStatus.FAILED, lastErrorCode: 'PROVIDER_COMPLAINT' }
								: state.kind === 'failed'
									? { status: ReminderStatus.FAILED, lastErrorCode: 'PROVIDER_DELIVERY_FAILED' }
									: {}),
				},
			});
			if (result.count !== 1) return false;
			if (state.kind === 'bounced' || state.kind === 'complained') {
				await transaction.organizationMember.updateMany({
					where: {
						id: row.memberId,
						organizationId: row.organizationId,
						email: row.recipientEmail,
						reminderEmailSuppressedAt: null,
					},
					data: {
						reminderEmailSuppressedAt: now,
						reminderEmailSuppressionReason:
							state.kind === 'bounced' ? SuppressionReason.BOUNCE : SuppressionReason.COMPLAINT,
					},
				});
			}
			return true;
		});
	}

	private async assertDatabase(): Promise<void> {
		const rows = await this.prisma.$queryRaw<{ ready: boolean }[]>`
			SELECT (
				COALESCE(has_table_privilege(current_user,
					to_regclass('public.organization_member_reminder_deliveries'), 'SELECT'), false)
				AND COALESCE(has_table_privilege(current_user,
					to_regclass('public.organization_member_reminder_deliveries'), 'UPDATE'), false)
				AND COALESCE(has_table_privilege(current_user,
					to_regclass('public.organization_members'), 'UPDATE'), false)
			) AS ready
		`;
		if (rows[0]?.ready !== true) throw new Error('Reminder reconciliation database is not ready.');
	}
}
