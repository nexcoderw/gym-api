import { jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '@nexcoderw/gym-db';

import { validateMemberReminderSchedulerEnvironment } from '../../src/config/member-reminder-scheduler.environment.js';
import {
	MemberReminderSchedulerPrerequisiteError,
	MemberReminderSchedulerService,
} from '../../src/modules/owner/reminders/member-reminder-scheduler.service.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const SUBSCRIPTION_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-18T22:05:00.000Z'); // 00:05 on 19 October in Kigali.

interface CandidateRow {
	id: string;
	organizationId: string;
	memberId: string;
	startDate: Date;
	endDate: Date;
	cancelledAt: Date | null;
	member: {
		email: string | null;
		archivedAt: Date | null;
		reminderEmailOptedOutAt: Date | null;
		reminderEmailSuppressedAt: Date | null;
	};
}

interface ReservationInput {
	data: {
		id: string;
		providerIdempotencyKey: string;
		organizationId: string;
		memberId: string;
		memberSubscriptionId: string;
	}[];
	skipDuplicates: boolean;
}

const candidate: CandidateRow = {
	id: SUBSCRIPTION_ID,
	organizationId: ORGANIZATION_ID,
	memberId: MEMBER_ID,
	startDate: new Date('2026-10-01T00:00:00.000Z'),
	endDate: new Date('2026-10-22T00:00:00.000Z'),
	cancelledAt: null,
	member: {
		email: 'member@example.com',
		archivedAt: null,
		reminderEmailOptedOutAt: null,
		reminderEmailSuppressedAt: null,
	},
};

describe('member reminder scheduler', () => {
	let module: TestingModule | undefined;
	let service: MemberReminderSchedulerService;
	const findMany = jest.fn<(input: unknown) => Promise<CandidateRow[]>>();
	const createMany = jest.fn<(input: ReservationInput) => Promise<{ count: number }>>();
	const preflight = jest.fn<(input: unknown) => Promise<{ ready: boolean }[]>>();

	beforeEach(async () => {
		jest.resetAllMocks();
		findMany.mockResolvedValueOnce([candidate]).mockResolvedValueOnce([]);
		createMany.mockResolvedValue({ count: 1 });
		preflight.mockResolvedValue([{ ready: true }]);
		module = await Test.createTestingModule({
			providers: [
				MemberReminderSchedulerService,
				{
					provide: PrismaService,
					useValue: {
						$queryRaw: preflight,
						organizationMemberSubscription: { findMany },
						organizationMemberReminderDelivery: { createMany },
					},
				},
			],
		}).compile();
		service = module.get(MemberReminderSchedulerService);
	});

	afterEach(async () => module?.close());

	it('reserves only the due tenant-bound email occasion with a stable provider key', async () => {
		expect(await service.runOnce(NOW)).toEqual({ scanned: 1, reserved: 1, capped: false });
		expect(findMany.mock.calls[0]?.[0]).toMatchObject({
			where: {
				endDate: new Date('2026-10-22T00:00:00.000Z'),
				startDate: { lte: new Date('2026-10-19T00:00:00.000Z') },
				cancelledAt: null,
				organization: { is: { status: 'ACTIVE' } },
				reminderDeliveries: { none: { kind: 'THREE_DAYS_BEFORE', channel: 'EMAIL' } },
			},
		});
		const firstCall = createMany.mock.calls[0]?.[0];
		expect(firstCall).toMatchObject({
			skipDuplicates: true,
			data: [
				{
					organizationId: ORGANIZATION_ID,
					memberId: MEMBER_ID,
					memberSubscriptionId: SUBSCRIPTION_ID,
					kind: 'THREE_DAYS_BEFORE',
					channel: 'EMAIL',
					dueDate: new Date('2026-10-19T00:00:00.000Z'),
					recipientEmail: 'member@example.com',
				},
			],
		});
		expect(firstCall?.data[0]?.providerIdempotencyKey).toMatch(/^[0-9a-f]{64}$/u);
		expect(firstCall?.data[0]?.id).toMatch(/^[0-9a-f-]{36}$/u);
		findMany.mockResolvedValueOnce([candidate]).mockResolvedValueOnce([]);
		createMany.mockResolvedValueOnce({ count: 0 });
		expect(await service.runOnce(NOW)).toEqual({ scanned: 1, reserved: 0, capped: false });
		expect(createMany.mock.calls[1]?.[0].data[0]?.providerIdempotencyKey).toBe(
			firstCall?.data[0]?.providerIdempotencyKey,
		);
	});

	it('rechecks opt-out after selection and does not reserve a delivery', async () => {
		findMany.mockReset();
		findMany
			.mockResolvedValueOnce([
				{
					...candidate,
					member: { ...candidate.member, reminderEmailOptedOutAt: NOW },
				},
			])
			.mockResolvedValueOnce([]);
		expect(await service.runOnce(NOW)).toEqual({ scanned: 1, reserved: 0, capped: false });
		expect(createMany).not.toHaveBeenCalled();
	});

	it('reserves the separate expiry-day occasion', async () => {
		findMany.mockReset();
		findMany
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ ...candidate, endDate: new Date('2026-10-19T00:00:00.000Z') }]);
		expect(await service.runOnce(NOW)).toEqual({ scanned: 1, reserved: 1, capped: false });
		expect(createMany.mock.calls[0]?.[0]).toMatchObject({
			data: [{ kind: 'EXPIRY_DAY', dueDate: new Date('2026-10-19T00:00:00.000Z') }],
		});
	});

	it('does not report a successful reservation when persistence fails', async () => {
		createMany.mockRejectedValueOnce(new Error('private database failure'));
		await expect(service.runOnce(NOW)).rejects.toThrow('private database failure');
	});

	it('fails before scanning when the outbox or runtime grants are missing', async () => {
		preflight.mockResolvedValueOnce([{ ready: false }]);
		await expect(service.runOnce(NOW)).rejects.toBeInstanceOf(
			MemberReminderSchedulerPrerequisiteError,
		);
		expect(findMany).not.toHaveBeenCalled();
		expect(createMany).not.toHaveBeenCalled();
	});
});

describe('member reminder scheduler environment', () => {
	const settings = {
		NODE_ENV: 'test',
		DATABASE_URL: 'postgresql://gym_app:fictional@localhost:5432/gym_test',
		MEMBER_REMINDER_SCHEDULER_ENABLED: 'true',
	};

	it('requires an explicit gate and a restricted database role', () => {
		expect(() => validateMemberReminderSchedulerEnvironment({ ...settings })).not.toThrow();
		expect(() =>
			validateMemberReminderSchedulerEnvironment({
				...settings,
				MEMBER_REMINDER_SCHEDULER_ENABLED: 'false',
			}),
		).toThrow('explicitly enabled');
		expect(() =>
			validateMemberReminderSchedulerEnvironment({
				...settings,
				DATABASE_URL: 'postgresql://gym_migrator:fictional@localhost:5432/gym_test',
			}),
		).toThrow('restricted');
	});

	it('requires database TLS in production', () => {
		expect(() =>
			validateMemberReminderSchedulerEnvironment({ ...settings, NODE_ENV: 'production' }),
		).toThrow('TLS');
	});
});
