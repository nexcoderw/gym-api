import { jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@nexcoderw/gym-db';

import { OwnerReminderActivityService } from '../../src/modules/owner/reminders/owner-reminder-activity.service.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const SUBSCRIPTION_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-20T08:00:00.000Z');
const MESSAGE = { subject: 'Your membership ends soon', body: 'Hello, please renew.' };

const eligible = {
	id: SUBSCRIPTION_ID,
	memberId: MEMBER_ID,
	planName: 'Gold',
	startDate: new Date('2026-10-01T00:00:00.000Z'),
	endDate: new Date('2026-11-03T00:00:00.000Z'),
	cancelledAt: null,
	member: {
		name: 'Example Member',
		email: 'member@example.com',
		archivedAt: null,
		reminderEmailOptedOutAt: null,
		reminderEmailSuppressedAt: null,
	},
	reminderDeliveries: [],
};

describe('owner upcoming reminders', () => {
	const findMany = jest.fn<(input: unknown) => Promise<unknown[]>>();
	const findFirst = jest.fn<(input: unknown) => Promise<unknown>>();
	const createMany = jest.fn<(input: unknown) => Promise<{ count: number }>>();
	const service = new OwnerReminderActivityService({
		organizationMemberSubscription: { findMany, findFirst },
		organizationMemberReminderDelivery: { createMany },
	} as unknown as PrismaService);

	beforeEach(() => jest.resetAllMocks());

	it('returns a tenant-scoped 14-day page without addresses', async () => {
		findMany.mockResolvedValueOnce([eligible]);
		const result = await service.upcoming(ORGANIZATION_ID, { limit: 24 }, NOW);
		expect(findMany.mock.calls[0]?.[0]).toMatchObject({
			where: {
				organizationId: ORGANIZATION_ID,
				cancelledAt: null,
				endDate: {
					gte: new Date('2026-10-20T00:00:00.000Z'),
					lte: new Date('2026-11-03T00:00:00.000Z'),
				},
			},
			take: 25,
		});
		expect(result.items[0]).toMatchObject({
			memberId: MEMBER_ID,
			daysRemaining: 14,
			canSend: true,
			manualStatus: null,
		});
		expect(JSON.stringify(result)).not.toContain('member@example.com');
	});

	it('rejects a cursor belonging to another gym', async () => {
		findFirst.mockResolvedValueOnce(null);
		await expect(
			service.upcoming(ORGANIZATION_ID, { limit: 24, cursor: SUBSCRIPTION_ID }, NOW),
		).rejects.toBeInstanceOf(NotFoundException);
		expect(findMany).not.toHaveBeenCalled();
	});

	it('queues at most one manual reminder without consuming automatic occasions', async () => {
		findFirst.mockResolvedValue(eligible);
		createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
		const result = await service.queueManual(ORGANIZATION_ID, SUBSCRIPTION_ID, MESSAGE, NOW);
		expect(result.status).toBe('QUEUED');
		expect(createMany.mock.calls[0]?.[0]).toMatchObject({
			skipDuplicates: true,
			data: [
				{
					organizationId: ORGANIZATION_ID,
					memberId: MEMBER_ID,
					memberSubscriptionId: SUBSCRIPTION_ID,
					kind: 'MANUAL',
					dueDate: new Date('2026-10-20T00:00:00.000Z'),
					messageSubject: MESSAGE.subject,
					messageBody: MESSAGE.body,
				},
			],
		});
		await expect(
			service.queueManual(ORGANIZATION_ID, SUBSCRIPTION_ID, MESSAGE, NOW),
		).rejects.toBeInstanceOf(ConflictException);
	});

	it('refuses opt-outs, missing email, cancelled and late memberships', async () => {
		for (const row of [
			{ ...eligible, member: { ...eligible.member, reminderEmailOptedOutAt: NOW } },
			{ ...eligible, member: { ...eligible.member, email: null } },
			{ ...eligible, cancelledAt: NOW },
			{ ...eligible, endDate: new Date('2026-11-04T00:00:00.000Z') },
		]) {
			findFirst.mockResolvedValueOnce(row);
			await expect(
				service.queueManual(ORGANIZATION_ID, SUBSCRIPTION_ID, MESSAGE, NOW),
			).rejects.toBeInstanceOf(ConflictException);
		}
		expect(createMany).not.toHaveBeenCalled();
	});
});
