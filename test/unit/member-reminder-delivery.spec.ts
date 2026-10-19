import { jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import {
	OrganizationMemberReminderKind as ReminderKind,
	OrganizationMemberReminderStatus as ReminderStatus,
	OrganizationStatus,
	PrismaService,
} from '@nexcoderw/gym-db';

import { validateMemberReminderWorkerEnvironment } from '../../src/config/member-reminder-worker.environment.js';
import { ResendMemberReminderEmailService } from '../../src/infrastructure/email/resend-member-reminder-email.service.js';
import { MemberReminderDeliveryService } from '../../src/modules/owner/reminders/member-reminder-delivery.service.js';

const NOW = new Date('2026-10-18T22:05:00.000Z');
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const ID = '44444444-4444-4444-8444-444444444444';
const MESSAGE_ID = '55555555-5555-4555-8555-555555555555';

const row = {
	id: ID,
	organizationId: ORGANIZATION_ID,
	status: ReminderStatus.PROCESSING,
	leaseExpiresAt: new Date(NOW.getTime() + 30_000),
	attemptCount: 1,
	kind: ReminderKind.THREE_DAYS_BEFORE,
	dueDate: new Date('2026-10-19T00:00:00.000Z'),
	recipientEmail: 'member@example.com',
	providerIdempotencyKey: 'a'.repeat(64),
	organization: { name: 'Soho Gym', status: OrganizationStatus.ACTIVE },
	member: {
		email: 'member@example.com',
		archivedAt: null,
		reminderEmailOptedOutAt: null,
		reminderEmailSuppressedAt: null,
	},
	subscription: {
		planName: 'Monthly fitness',
		startDate: new Date('2026-10-01T00:00:00.000Z'),
		endDate: new Date('2026-10-22T00:00:00.000Z'),
		cancelledAt: null,
	},
};

describe('member reminder delivery', () => {
	let module: TestingModule | undefined;
	let service: MemberReminderDeliveryService;
	const updateMany = jest.fn<(input: unknown) => Promise<{ count: number }>>();
	const findMany = jest.fn<(input: unknown) => Promise<unknown[]>>();
	const findFirst = jest.fn<(input: unknown) => Promise<unknown>>();
	const preflight = jest.fn<(input: unknown) => Promise<{ ready: boolean }[]>>();
	const send = jest.fn<(input: unknown) => Promise<unknown>>();

	beforeEach(async () => {
		jest.resetAllMocks();
		updateMany.mockResolvedValue({ count: 1 });
		findMany.mockResolvedValue([
			{ id: ID, organizationId: ORGANIZATION_ID, status: ReminderStatus.QUEUED, attemptCount: 0 },
		]);
		findFirst.mockResolvedValue(row);
		preflight.mockResolvedValue([{ ready: true }]);
		send.mockResolvedValue({ kind: 'accepted', messageId: MESSAGE_ID });
		module = await Test.createTestingModule({
			providers: [
				MemberReminderDeliveryService,
				{
					provide: PrismaService,
					useValue: {
						$queryRaw: preflight,
						organizationMemberReminderDelivery: { updateMany, findMany, findFirst },
					},
				},
				{ provide: ResendMemberReminderEmailService, useValue: { send } },
			],
		}).compile();
		service = module.get(MemberReminderDeliveryService);
	});

	afterEach(async () => {
		await module?.close();
	});

	it('claims once and records provider acceptance, not inbox delivery', async () => {
		expect(await service.runOnce(NOW)).toEqual({
			claimed: 1,
			accepted: 1,
			skipped: 0,
			uncertain: 0,
		});
		expect(send).toHaveBeenCalledWith({
			recipient: 'member@example.com',
			organizationName: 'Soho Gym',
			planName: 'Monthly fitness',
			endDate: '2026-10-22',
			kind: ReminderKind.THREE_DAYS_BEFORE,
			idempotencyKey: 'a'.repeat(64),
		});
		expect(updateMany.mock.calls[2]?.[0]).toMatchObject({
			where: { id: ID, organizationId: ORGANIZATION_ID, status: ReminderStatus.PROCESSING },
			data: { status: ReminderStatus.ACCEPTED, providerMessageId: MESSAGE_ID },
		});
	});

	it('never sends when another worker already claimed the row', async () => {
		updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
		expect(await service.runOnce(NOW)).toEqual({
			claimed: 0,
			accepted: 0,
			skipped: 0,
			uncertain: 0,
		});
		expect(send).not.toHaveBeenCalled();
	});

	it.each([
		{ label: 'opted out', change: { member: { ...row.member, reminderEmailOptedOutAt: NOW } } },
		{ label: 'cancelled', change: { subscription: { ...row.subscription, cancelledAt: NOW } } },
		{
			label: 'suspended gym',
			change: { organization: { ...row.organization, status: OrganizationStatus.SUSPENDED } },
		},
		{
			label: 'recipient changed',
			change: { member: { ...row.member, email: 'other@example.com' } },
		},
	])('skips $label immediately before submission', async ({ change }) => {
		findFirst.mockResolvedValueOnce({ ...row, ...change });
		expect(await service.runOnce(NOW)).toEqual({
			claimed: 1,
			accepted: 0,
			skipped: 1,
			uncertain: 0,
		});
		expect(send).not.toHaveBeenCalled();
		expect(updateMany.mock.calls[2]?.[0]).toMatchObject({
			data: { status: ReminderStatus.SKIPPED },
		});
	});

	it('records ambiguous provider outcomes without retrying', async () => {
		send.mockResolvedValueOnce({ kind: 'uncertain', code: 'PROVIDER_OUTCOME_UNKNOWN' });
		expect(await service.runOnce(NOW)).toEqual({
			claimed: 1,
			accepted: 0,
			skipped: 0,
			uncertain: 1,
		});
		expect(updateMany.mock.calls[2]?.[0]).toMatchObject({
			data: { status: ReminderStatus.UNCERTAIN },
		});
		expect(updateMany.mock.calls[2]?.[0]).not.toHaveProperty('data.nextAttemptAt');
	});

	it('retries only a definite rate limit with a bounded delay', async () => {
		send.mockResolvedValueOnce({
			kind: 'rejected',
			code: 'PROVIDER_RATE_LIMITED',
			retryable: true,
		});
		await service.runOnce(NOW);
		expect(updateMany.mock.calls[2]?.[0]).toMatchObject({
			data: {
				status: ReminderStatus.FAILED,
				lastErrorCode: 'PROVIDER_RATE_LIMITED',
				nextAttemptAt: new Date(NOW.getTime() + 120_000),
			},
		});
	});

	it('never retries an accepted submission after uncertain database finalization', async () => {
		updateMany
			.mockResolvedValueOnce({ count: 0 })
			.mockResolvedValueOnce({ count: 1 })
			.mockResolvedValueOnce({ count: 0 });
		await expect(service.runOnce(NOW)).rejects.toThrow('finalization is uncertain');
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('fails closed when runtime UPDATE privilege is absent', async () => {
		preflight.mockResolvedValueOnce([{ ready: false }]);
		await expect(service.runOnce(NOW)).rejects.toThrow('not ready');
		expect(send).not.toHaveBeenCalled();
	});
});

describe('member reminder delivery environment', () => {
	const configuration = {
		NODE_ENV: 'test',
		DATABASE_URL: 'postgresql://gym_app:fictional@localhost:5432/gym_test',
		MEMBER_REMINDER_SCHEDULER_ENABLED: 'true',
		MEMBER_REMINDER_DELIVERY_ENABLED: 'true',
		RESEND_API_KEY: 're_fictional',
		MEMBER_REMINDER_FROM_EMAIL: 'reminders@notify.example.invalid',
	};

	it('requires both gates and a controlled sender', () => {
		expect(
			validateMemberReminderWorkerEnvironment(configuration).MEMBER_REMINDER_DELIVERY_ENABLED,
		).toBe(true);
		expect(() =>
			validateMemberReminderWorkerEnvironment({
				...configuration,
				MEMBER_REMINDER_DELIVERY_ENABLED: 'false',
			}),
		).toThrow();
		expect(() =>
			validateMemberReminderWorkerEnvironment({
				...configuration,
				MEMBER_REMINDER_FROM_EMAIL: 'owner@soho.example.com',
			}),
		).toThrow();
	});
});
