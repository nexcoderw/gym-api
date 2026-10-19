import type { MemberReminderSchedulerEnvironment } from './member-reminder-scheduler.environment.js';
import { validateMemberReminderSchedulerEnvironment } from './member-reminder-scheduler.environment.js';

export interface MemberReminderWorkerEnvironment extends MemberReminderSchedulerEnvironment {
	readonly MEMBER_REMINDER_DELIVERY_ENABLED: true;
	readonly RESEND_API_KEY: string;
	readonly MEMBER_REMINDER_FROM_EMAIL: string;
}

/** A separate opt-in gate prevents a scheduler deployment from enabling delivery accidentally. */
export function validateMemberReminderWorkerEnvironment(
	input: Record<string, unknown>,
): MemberReminderWorkerEnvironment {
	const database = validateMemberReminderSchedulerEnvironment(input);
	if (input.MEMBER_REMINDER_DELIVERY_ENABLED !== 'true') {
		throw new Error('Member reminder delivery must be explicitly enabled.');
	}
	const key = input.RESEND_API_KEY;
	const sender = input.MEMBER_REMINDER_FROM_EMAIL;
	if (typeof key !== 'string' || !/^re_[A-Za-z0-9_-]{1,256}$/u.test(key)) {
		throw new Error('Member reminder delivery requires a valid Resend key.');
	}
	if (
		typeof sender !== 'string' ||
		sender.length > 254 ||
		!/^reminders@notify\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(sender)
	) {
		throw new Error('Member reminder delivery requires a verified reminders@notify sender.');
	}
	if (database.NODE_ENV === 'production' && sender !== 'reminders@notify.mucyora.rw') {
		throw new Error('Production reminders must use the verified Mucyora sender.');
	}
	return Object.freeze({
		...database,
		MEMBER_REMINDER_DELIVERY_ENABLED: true,
		RESEND_API_KEY: key,
		MEMBER_REMINDER_FROM_EMAIL: sender,
	});
}
