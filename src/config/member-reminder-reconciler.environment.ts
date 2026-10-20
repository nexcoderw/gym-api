import type { MemberReminderDatabaseEnvironment } from './member-reminder-database.environment.js';
import { validateMemberReminderDatabaseEnvironment } from './member-reminder-database.environment.js';

export interface MemberReminderReconcilerEnvironment extends MemberReminderDatabaseEnvironment {
	readonly MEMBER_REMINDER_RECONCILIATION_ENABLED: true;
	readonly RESEND_REMINDER_RECONCILER_API_KEY: string;
	readonly MEMBER_REMINDER_FROM_EMAIL: string;
}

/** Resend currently requires full access for GET /emails; isolate this key from sending. */
export function validateMemberReminderReconcilerEnvironment(
	input: Record<string, unknown>,
): MemberReminderReconcilerEnvironment {
	const database = validateMemberReminderDatabaseEnvironment(input);
	if (input.MEMBER_REMINDER_RECONCILIATION_ENABLED !== 'true') {
		throw new Error('Member reminder reconciliation must be explicitly enabled.');
	}
	const key = input.RESEND_REMINDER_RECONCILER_API_KEY;
	const sender = input.MEMBER_REMINDER_FROM_EMAIL;
	if (typeof key !== 'string' || !/^re_[A-Za-z0-9_-]{1,256}$/u.test(key)) {
		throw new Error('Member reminder reconciliation requires a separate Resend API key.');
	}
	if (
		typeof sender !== 'string' ||
		!/^reminders@notify\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(sender) ||
		(database.NODE_ENV === 'production' && sender !== 'reminders@notify.mucyora.rw')
	) {
		throw new Error('Member reminder reconciliation requires the approved sender.');
	}
	return Object.freeze({
		...database,
		MEMBER_REMINDER_RECONCILIATION_ENABLED: true,
		RESEND_REMINDER_RECONCILER_API_KEY: key,
		MEMBER_REMINDER_FROM_EMAIL: sender,
	});
}
