import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { MemberReminderSchedulerModule } from '../modules/owner/reminders/member-reminder-scheduler.module.js';
import {
	MemberReminderSchedulerPrerequisiteError,
	MemberReminderSchedulerService,
} from '../modules/owner/reminders/member-reminder-scheduler.service.js';

async function main(): Promise<void> {
	// A deployment scheduler invokes this command periodically; the API never auto-starts it.
	const application = await NestFactory.createApplicationContext(MemberReminderSchedulerModule, {
		logger: false,
		abortOnError: false,
	});
	try {
		const result = await application.get(MemberReminderSchedulerService).runOnce();
		process.stdout.write(`${JSON.stringify({ code: 'MEMBER_REMINDERS_RESERVED', ...result })}\n`);
	} finally {
		await application.close();
	}
}

void main().catch((error: unknown) => {
	// Configuration and database errors may contain credentials or personal data.
	const code =
		error instanceof MemberReminderSchedulerPrerequisiteError
			? 'MEMBER_REMINDER_DATABASE_NOT_READY'
			: 'MEMBER_REMINDER_SCHEDULER_FAILED';
	process.stderr.write(`${JSON.stringify({ code })}\n`);
	process.exitCode = 1;
});
