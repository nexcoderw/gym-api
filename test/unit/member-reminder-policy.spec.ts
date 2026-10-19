import {
	dueEmailReminder,
	type MemberReminderCandidate,
} from '../../src/modules/owner/reminders/member-reminder-policy.js';

const candidate: MemberReminderCandidate = {
	email: 'member@example.com',
	memberArchivedAt: null,
	emailOptedOutAt: null,
	emailSuppressedAt: null,
	subscriptionCancelledAt: null,
	startDate: '2026-10-01',
	endDate: '2026-10-31',
};

describe('member email reminder eligibility', () => {
	it('selects only the three-day and inclusive expiry dates', () => {
		expect(dueEmailReminder(candidate, '2026-10-28')).toBe('THREE_DAYS_BEFORE');
		expect(dueEmailReminder(candidate, '2026-10-31')).toBe('EXPIRY_DAY');
		expect(dueEmailReminder(candidate, '2026-10-27')).toBeNull();
		expect(dueEmailReminder(candidate, '2026-11-01')).toBeNull();
	});

	it('handles month and year boundaries as calendar days', () => {
		expect(dueEmailReminder({ ...candidate, endDate: '2027-01-02' }, '2026-12-30')).toBe(
			'THREE_DAYS_BEFORE',
		);
	});

	it.each([
		{ email: null },
		{ email: '   ' },
		{ memberArchivedAt: new Date('2026-10-02') },
		{ emailOptedOutAt: new Date('2026-10-02') },
		{ emailSuppressedAt: new Date('2026-10-02') },
		{ subscriptionCancelledAt: new Date('2026-10-02') },
		{ startDate: '2026-10-29' },
	])('rejects ineligible member or subscription state: %p', (change) => {
		expect(dueEmailReminder({ ...candidate, ...change }, '2026-10-28')).toBeNull();
	});
});
