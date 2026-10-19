import { jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { OrganizationMemberReminderStatus as ReminderStatus, PrismaService } from '@nexcoderw/gym-db';

import { validateMemberReminderReconcilerEnvironment } from '../../src/config/member-reminder-reconciler.environment.js';
import { ResendMemberReminderStatusService } from '../../src/infrastructure/email/resend-member-reminder-status.service.js';
import { MemberReminderReconcilerService } from '../../src/modules/owner/reminders/member-reminder-reconciler.service.js';

const NOW = new Date('2026-10-19T10:00:00.000Z');
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const ID = '44444444-4444-4444-8444-444444444444';
const MESSAGE_ID = '55555555-5555-4555-8555-555555555555';
const row = {
	id: ID,
	organizationId: ORGANIZATION_ID,
	memberId: MEMBER_ID,
	recipientEmail: 'member@example.com',
	providerMessageId: MESSAGE_ID,
};

interface Transaction {
	organizationMemberReminderDelivery: { updateMany: typeof updateMany };
	organizationMember: { updateMany: typeof suppress };
}

const updateMany = jest.fn<(input: unknown) => Promise<{ count: number }>>();
const suppress = jest.fn<(input: unknown) => Promise<{ count: number }>>();

describe('member reminder reconciler', () => {
	let module: TestingModule | undefined;
	let service: MemberReminderReconcilerService;
	const findMany = jest.fn<(input: unknown) => Promise<unknown[]>>();
	const preflight = jest.fn<(input: unknown) => Promise<{ ready: boolean }[]>>();
	const get = jest.fn<(messageId: string, recipient: string) => Promise<unknown>>();
	const transaction = jest.fn<(
		callback: (client: Transaction) => Promise<boolean>,
	) => Promise<boolean>>();

	beforeEach(async () => {
		jest.resetAllMocks();
		findMany.mockResolvedValue([row]);
		preflight.mockResolvedValue([{ ready: true }]);
		get.mockResolvedValue({ kind: 'delivered' });
		updateMany.mockResolvedValue({ count: 1 });
		suppress.mockResolvedValue({ count: 1 });
		transaction.mockImplementation((callback) =>
			callback({
				organizationMemberReminderDelivery: { updateMany },
				organizationMember: { updateMany: suppress },
			}),
		);
		module = await Test.createTestingModule({
			providers: [
				MemberReminderReconcilerService,
				{
					provide: PrismaService,
					useValue: {
						$queryRaw: preflight,
						$transaction: transaction,
						organizationMemberReminderDelivery: { findMany },
					},
				},
				{ provide: ResendMemberReminderStatusService, useValue: { get } },
			],
		}).compile();
		service = module.get(MemberReminderReconcilerService);
	});

	afterEach(async () => module?.close());

	it('queries a bounded accepted-only batch and records observed delivery', async () => {
		expect(await service.runOnce(NOW)).toEqual({
			checked: 1,
			delivered: 1,
			bounced: 0,
			complained: 0,
			failed: 0,
			unavailable: 0,
		});
		expect(findMany.mock.calls[0]?.[0]).toMatchObject({
			where: { status: ReminderStatus.ACCEPTED, providerMessageId: { not: null } },
			take: 25,
		});
		expect(get).toHaveBeenCalledWith(MESSAGE_ID, 'member@example.com');
		expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
			where: { id: ID, organizationId: ORGANIZATION_ID, status: ReminderStatus.ACCEPTED },
			data: { status: ReminderStatus.DELIVERED, deliveredAt: NOW },
		});
		expect(suppress).not.toHaveBeenCalled();
	});

	it.each([
		{ event: 'bounced', reason: 'BOUNCE', status: ReminderStatus.BOUNCED },
		{ event: 'complained', reason: 'COMPLAINT', status: ReminderStatus.FAILED },
	])('suppresses the same tenant and current email after $event', async ({ event, reason, status }) => {
		get.mockResolvedValueOnce({ kind: event });
		await service.runOnce(NOW);
		expect(updateMany.mock.calls[0]?.[0]).toMatchObject({ data: { status } });
		expect(suppress.mock.calls[0]?.[0]).toMatchObject({
			where: { id: MEMBER_ID, organizationId: ORGANIZATION_ID, email: 'member@example.com' },
			data: { reminderEmailSuppressionReason: reason, reminderEmailSuppressedAt: NOW },
		});
	});

	it('does not suppress when a competing reconciliation already changed the outbox', async () => {
		get.mockResolvedValueOnce({ kind: 'bounced' });
		updateMany.mockResolvedValueOnce({ count: 0 });
		await service.runOnce(NOW);
		expect(suppress).not.toHaveBeenCalled();
	});

	it('keeps ambiguous provider outcomes accepted for later review', async () => {
		get.mockResolvedValueOnce({ kind: 'unavailable' });
		expect(await service.runOnce(NOW)).toMatchObject({ checked: 1, unavailable: 1 });
		expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
			data: { updatedAt: NOW },
		});
		expect(updateMany.mock.calls[0]?.[0]).not.toHaveProperty('data.status');
		expect(suppress).not.toHaveBeenCalled();
	});

	it('fails closed before provider calls when database grants are missing', async () => {
		preflight.mockResolvedValueOnce([{ ready: false }]);
		await expect(service.runOnce(NOW)).rejects.toThrow('not ready');
		expect(get).not.toHaveBeenCalled();
	});
});

describe('member reminder reconciliation environment', () => {
	const configuration = {
		NODE_ENV: 'test',
		DATABASE_URL: 'postgresql://gym_app:fictional@localhost:5432/gym_test',
		MEMBER_REMINDER_SCHEDULER_ENABLED: 'true',
		MEMBER_REMINDER_RECONCILIATION_ENABLED: 'true',
		RESEND_REMINDER_RECONCILER_API_KEY: 're_fictional_full_access',
		MEMBER_REMINDER_FROM_EMAIL: 'reminders@notify.example.invalid',
	};

	it('requires an explicit gate and separate provider key', () => {
		expect(
			validateMemberReminderReconcilerEnvironment(configuration)
				.MEMBER_REMINDER_RECONCILIATION_ENABLED,
		).toBe(true);
		expect(() =>
			validateMemberReminderReconcilerEnvironment({
				...configuration,
				MEMBER_REMINDER_RECONCILIATION_ENABLED: 'false',
			}),
		).toThrow();
		expect(() =>
			validateMemberReminderReconcilerEnvironment({
				...configuration,
				RESEND_REMINDER_RECONCILER_API_KEY: '',
			}),
		).toThrow();
	});
});
