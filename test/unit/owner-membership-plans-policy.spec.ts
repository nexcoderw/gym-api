import { OrganizationStatus } from '@nexcoderw/gym-db';

import type { OwnerRequest } from '../../src/modules/owner/auth/owner-request.js';
import { ownerMembershipPlanOrganization } from '../../src/modules/owner/membership-plans/owner-membership-plan-context.js';
import { membershipPlanPrecondition } from '../../src/modules/owner/membership-plans/owner-membership-plan-precondition.js';
import { normalizedMembershipPlanName } from '../../src/modules/owner/membership-plans/owner-membership-plans.service.js';

const UPDATED_AT = '2026-10-18T08:00:00.000Z';

describe('owner membership plan policy', () => {
	it('normalizes equivalent names into one organization-scoped uniqueness key', () => {
		expect(normalizedMembershipPlanName('Monthly FITNESS')).toBe('monthly fitness');
		expect(normalizedMembershipPlanName('Ｍｏｎｔｈｌｙ')).toBe('monthly');
	});

	it('accepts only an exact quoted updatedAt precondition', () => {
		expect(membershipPlanPrecondition(`"${UPDATED_AT}"`)).toEqual(new Date(UPDATED_AT));
		for (const value of [undefined, UPDATED_AT, '"invalid"', `W/"${UPDATED_AT}"`]) {
			expect(() => membershipPlanPrecondition(value)).toThrow();
		}
	});

	it('resolves one active owner organization from the authenticated principal', () => {
		expect(ownerMembershipPlanOrganization(ownerRequest())).toMatchObject({
			organizationId: '11111111-1111-4111-8111-111111111111',
			slug: 'soho',
		});
	});

	it.each([
		ownerRequest(OrganizationStatus.PENDING),
		ownerRequest(OrganizationStatus.ACTIVE, ['trainer']),
		ownerRequest(OrganizationStatus.ACTIVE, ['owner'], 2),
	])('rejects inactive, unauthorized or ambiguous organization context', (request) => {
		expect(() => ownerMembershipPlanOrganization(request)).toThrow();
	});
});

function ownerRequest(
	status = OrganizationStatus.ACTIVE,
	roles: readonly string[] = ['owner'],
	organizationCount = 1,
): Pick<OwnerRequest, 'ownerPrincipal'> {
	return {
		ownerPrincipal: {
			sessionId: '22222222-2222-4222-8222-222222222222',
			userId: '33333333-3333-4333-8333-333333333333',
			displayName: 'Aline Uwase',
			email: 'aline@example.com',
			assurance: 'AAL1',
			expiresAt: new Date('2030-01-01T00:00:00.000Z'),
			organizations: Array.from({ length: organizationCount }, (_, index) => ({
				organizationId:
					index === 0
						? '11111111-1111-4111-8111-111111111111'
						: '44444444-4444-4444-8444-444444444444',
				name: index === 0 ? 'Soho Gym' : 'Power Gym',
				slug: index === 0 ? 'soho' : 'powergym',
				status,
				membershipId:
					index === 0
						? '55555555-5555-4555-8555-555555555555'
						: '66666666-6666-4666-8666-666666666666',
				roles,
			})),
		},
	};
}
