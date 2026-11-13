export interface MemberEmailReminderState {
	readonly isSynthetic: boolean | null;
	readonly email: string | null;
	readonly reminderEmailOptedOutAt: Date | null;
	readonly reminderEmailSuppressedAt: Date | null;
}

/** Block synthetic, opted-out, suppressed, missing, or mismatched email recipients. */
export function memberMayReceiveEmailReminder(
	member: MemberEmailReminderState,
	recipient?: string | null,
): boolean {
	const email = member.email?.trim();
	return (
		member.isSynthetic === false &&
		member.reminderEmailOptedOutAt === null &&
		member.reminderEmailSuppressedAt === null &&
		email !== undefined &&
		email.length > 0 &&
		(recipient === undefined ||
			(recipient !== null &&
				recipient.trim().length > 0 &&
				email.toLowerCase() === recipient.trim().toLowerCase()))
	);
}
