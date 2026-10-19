import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { MemberReminderDeliveryModule } from '../modules/owner/reminders/member-reminder-delivery.module.js';
import { MemberReminderDeliveryService } from '../modules/owner/reminders/member-reminder-delivery.service.js';

async function main(): Promise<void> {
	const application = await NestFactory.createApplicationContext(MemberReminderDeliveryModule, {
		logger: false,
		abortOnError: false,
	});
	try {
		const result = await application.get(MemberReminderDeliveryService).runOnce();
		process.stdout.write(
			`${JSON.stringify({ code: 'MEMBER_REMINDER_DELIVERY_RUN', ...result })}\n`,
		);
	} finally {
		await application.close();
	}
}

void main().catch(() => {
	// Provider and database failures can contain credentials or recipient data.
	process.stderr.write('{"code":"MEMBER_REMINDER_DELIVERY_FAILED"}\n');
	process.exitCode = 1;
});
