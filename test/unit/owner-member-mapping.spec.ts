import {
	memberJoinedOn,
	memberResponse,
} from '../../src/modules/owner/members/owner-member-mapping.js';

const MEMBER_ROW = {
	id: '11111111-1111-4111-8111-111111111111',
	name: 'Example Member',
	email: null,
	phoneNumber: '+250700000001',
	gender: null,
	joinedOn: null,
	createdAt: new Date('2026-10-18T21:59:00.000Z'),
	updatedAt: new Date('2026-10-18T21:59:00.000Z'),
	archivedAt: null,
};

describe('owner member mapping', () => {
	it('serializes known and unknown joining dates as date-only strings', () => {
		expect(
			memberResponse({ ...MEMBER_ROW, joinedOn: new Date('2026-10-18T00:00:00.000Z') })
				.joinedOn,
		).toBe('2026-10-18');
		expect(memberResponse(MEMBER_ROW).joinedOn).toBeNull();
	});

	it('uses the Africa/Kigali calendar day on both sides of local midnight', () => {
		expect(memberJoinedOn(new Date('2026-10-18T21:59:59.999Z'))).toEqual(
			new Date('2026-10-18T00:00:00.000Z'),
		);
		expect(memberJoinedOn(new Date('2026-10-18T22:00:00.000Z'))).toEqual(
			new Date('2026-10-19T00:00:00.000Z'),
		);
	});
});
