import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { MemberReminderReconcilerModule } from '../modules/owner/reminders/member-reminder-reconciler.module.js';
import { MemberReminderReconcilerService } from '../modules/owner/reminders/member-reminder-reconciler.service.js';

async function main(): Promise<void> {
	const application = await NestFactory.createApplicationContext(MemberReminderReconcilerModule, {
		logger: false,
		abortOnError: false,
	});
	try {
		const result = await application.get(MemberReminderReconcilerService).runOnce();
		process.stdout.write(`${JSON.stringify({ code: 'MEMBER_REMINDERS_RECONCILED', ...result })}\n`);
	} finally {
		await application.close();
	}
}

void main().catch(() => {
	process.stderr.write('{"code":"MEMBER_REMINDER_RECONCILIATION_FAILED"}\n');
	process.exitCode = 1;
});
