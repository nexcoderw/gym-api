import { jest } from '@jest/globals';
import {
	OrganizationMemberReminderStatus as ReminderStatus,
	OrganizationStatus,
} from '@nexcoderw/gym-db';
import type { PrismaService } from '@nexcoderw/gym-db';

import type { OwnerRequest } from '../../src/modules/owner/auth/owner-request.js';
import { OwnerReminderActivityService } from '../../src/modules/owner/reminders/owner-reminder-activity.service.js';
import { ownerReminderOrganizationId } from '../../src/modules/owner/reminders/owner-reminder-context.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';

describe('owner reminder activity', () => {
	const findMany = jest.fn<(input: unknown) => Promise<unknown[]>>();
	const service = new OwnerReminderActivityService({
		organizationMemberReminderDelivery: { findMany },
	} as unknown as PrismaService);

	beforeEach(() => jest.resetAllMocks());

	it('returns bounded tenant-scoped activity without recipient or provider identifiers', async () => {
		findMany.mockResolvedValueOnce([
			{
				id: '33333333-3333-4333-8333-333333333333',
				memberId: MEMBER_ID,
				kind: 'THREE_DAYS_BEFORE',
				status: ReminderStatus.ACCEPTED,
				dueDate: new Date('2026-10-19T00:00:00.000Z'),
				acceptedAt: new Date('2026-10-19T10:00:00.000Z'),
				deliveredAt: null,
				member: { name: 'Example Member' },
				subscription: { planName: 'Monthly', endDate: new Date('2026-10-22T00:00:00.000Z') },
			},
		]);
		const result = await service.list(ORGANIZATION_ID, { limit: 10 });
		expect(findMany.mock.calls[0]?.[0]).toMatchObject({
			where: {
				organizationId: ORGANIZATION_ID,
				status: {
					in: [
						ReminderStatus.ACCEPTED,
						ReminderStatus.DELIVERED,
						ReminderStatus.BOUNCED,
						ReminderStatus.FAILED,
						ReminderStatus.UNCERTAIN,
					],
				},
			},
			take: 10,
		});
		expect(result.items[0]).toMatchObject({
			memberId: MEMBER_ID,
			memberName: 'Example Member',
			status: ReminderStatus.ACCEPTED,
			endDate: '2026-10-22',
			deliveredAt: null,
		});
		expect(JSON.stringify(result)).not.toMatch(
			/recipientEmail|providerMessageId|member@example.com/u,
		);
	});

	it('requires one active gym owner membership', () => {
		expect(ownerReminderOrganizationId(ownerRequest())).toBe(ORGANIZATION_ID);
		expect(() => ownerReminderOrganizationId({})).toThrow();
		expect(() => ownerReminderOrganizationId(ownerRequest(OrganizationStatus.PENDING))).toThrow();
		expect(() =>
			ownerReminderOrganizationId(ownerRequest(OrganizationStatus.ACTIVE, ['trainer'])),
		).toThrow();
	});
});

function ownerRequest(
	status: OrganizationStatus = OrganizationStatus.ACTIVE,
	roles: readonly string[] = ['owner'],
): Pick<OwnerRequest, 'ownerPrincipal'> {
	return {
		ownerPrincipal: {
			sessionId: '44444444-4444-4444-8444-444444444444',
			userId: '55555555-5555-4555-8555-555555555555',
			displayName: 'Example Owner',
			email: 'owner@example.com',
			assurance: 'AAL1',
			expiresAt: new Date('2030-01-01T00:00:00.000Z'),
			organizations: [
				{
					organizationId: ORGANIZATION_ID,
					name: 'Soho Gym',
					slug: 'soho',
					status,
					membershipId: '66666666-6666-4666-8666-666666666666',
					roles,
				},
			],
		},
	};
}
