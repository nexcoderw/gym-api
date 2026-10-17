import { Test } from '@nestjs/testing';
import {
	OrganizationOwnerEnrollmentStatus,
	OrganizationOwnerInvitationStatus,
	OrganizationStatus,
	PrismaService,
	UserStatus,
} from '@nexcoderw/gym-db';

import { OwnerTokenService } from '../../src/modules/owner-auth/owner-token.service.js';
import { OwnerAcceptanceService } from '../../src/modules/owner-enrollment/owner-acceptance.service.js';

describe('OwnerAcceptanceService transition ordering', () => {
	const now = new Date('2026-01-01T00:00:00Z');
	const expiresAt = new Date('2026-01-02T00:00:00Z');

	it.each([1, 0])('consumes proof before acceptance with update count %s', async (count) => {
		const writes: string[] = [];
		const transaction = {
			$queryRaw: jest.fn().mockResolvedValue([]),
			organizationOwnerEnrollmentChallenge: {
				findUnique: jest.fn().mockResolvedValue({
					id: 'challenge',
					organizationId: 'organization',
					ownerInvitationId: 'invitation',
					userId: 'user',
					status: OrganizationOwnerEnrollmentStatus.VERIFIED,
					expiresAt,
					user: {
						id: 'user',
						email: 'owner@example.test',
						status: UserStatus.ACTIVE,
						emailVerifiedAt: now,
					},
					ownerInvitation: {
						id: 'invitation',
						invitedEmail: 'owner@example.test',
						status: OrganizationOwnerInvitationStatus.SENT,
						expiresAt,
						tokenDigest: 'digest',
						organization: {
							id: 'organization',
							name: 'Example Gym',
							slug: 'example-gym',
							status: OrganizationStatus.ACTIVE,
						},
					},
				}),
				updateMany: jest.fn().mockImplementation(() => {
					writes.push('consume');
					return Promise.resolve({ count });
				}),
			},
			organizationRole: {
				upsert: jest.fn().mockResolvedValue({
					id: 'role',
					key: 'owner',
					name: 'Owner',
					isSystem: true,
				}),
			},
			organizationMembership: {
				findUnique: jest.fn().mockResolvedValue(null),
				create: jest.fn().mockResolvedValue({ id: 'membership' }),
			},
			organizationMembershipRole: { upsert: jest.fn().mockResolvedValue({}) },
			organizationOwnerInvitation: {
				updateMany: jest.fn().mockImplementation(() => {
					writes.push('accept');
					return Promise.resolve({ count: 1 });
				}),
			},
			organizationOwnerAcceptanceAuditEvent: {
				create: jest.fn().mockImplementation(() => {
					writes.push('audit');
					return Promise.resolve({});
				}),
			},
		};
		const module = await Test.createTestingModule({
			providers: [
				OwnerAcceptanceService,
				{
					provide: PrismaService,
					useValue: {
						$transaction: (operation: (client: typeof transaction) => Promise<unknown>) =>
							operation(transaction),
					},
				},
				{
					provide: OwnerTokenService,
					useValue: { isValid: () => true, enrollmentDigest: () => 'digest' },
				},
			],
		}).compile();
		try {
			const result = module.get(OwnerAcceptanceService).accept(
				{
					sessionId: 'session',
					userId: 'user',
					displayName: 'Example Owner',
					email: 'owner@example.test',
					assurance: 'AAL1',
					expiresAt,
					organizations: [],
				},
				'token',
				'request',
				now,
			);
			if (count === 1) {
				await expect(result).resolves.toMatchObject({ status: 'accepted' });
				expect(writes).toEqual(['consume', 'accept', 'audit']);
			} else {
				await expect(result).rejects.toThrow();
				expect(writes).toEqual(['consume']);
			}
		} finally {
			await module.close();
		}
	});
});
