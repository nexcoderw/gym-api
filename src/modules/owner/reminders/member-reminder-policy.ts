/** A subscription's end date is inclusive; both reminder dates use the Kigali calendar day. */
export type MemberReminderKind = 'THREE_DAYS_BEFORE' | 'EXPIRY_DAY';

export type MemberReminderCandidate = Readonly<{
	email: string | null;
	memberArchivedAt: Date | null;
	emailOptedOutAt: Date | null;
	emailSuppressedAt: Date | null;
	subscriptionCancelledAt: Date | null;
	startDate: string;
	endDate: string;
}>;

/**
 * Evaluate current eligibility again at delivery time, not only when reserving the outbox row.
 * Missing email, opt-out, suppression, archival and cancellation all fail closed.
 * Calendar-day comparison avoids elapsed-hour errors around local midnight.
 */
export function dueEmailReminder(
	candidate: MemberReminderCandidate,
	today: string,
): MemberReminderKind | null {
	if (
		candidate.email === null ||
		candidate.email.trim() === '' ||
		candidate.memberArchivedAt !== null ||
		candidate.emailOptedOutAt !== null ||
		candidate.emailSuppressedAt !== null ||
		candidate.subscriptionCancelledAt !== null ||
		candidate.startDate > today
	) {
		return null;
	}

	if (candidate.endDate === today) return 'EXPIRY_DAY';
	const threeDaysBefore = new Date(`${candidate.endDate}T00:00:00.000Z`);
	threeDaysBefore.setUTCDate(threeDaysBefore.getUTCDate() - 3);
	return threeDaysBefore.toISOString().slice(0, 10) === today ? 'THREE_DAYS_BEFORE' : null;
}
