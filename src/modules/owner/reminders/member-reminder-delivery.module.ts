import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from '@nexcoderw/gym-db';

import {
	validateMemberReminderWorkerEnvironment,
	type MemberReminderWorkerEnvironment,
} from '../../../config/member-reminder-worker.environment.js';
import { ResendMemberReminderEmailService } from '../../../infrastructure/email/resend-member-reminder-email.service.js';
import { MemberReminderDeliveryService } from './member-reminder-delivery.service.js';

/** Isolated run-once sender: never starts with the API or scheduler process. */
@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			ignoreEnvFile: true,
			cache: true,
			validate: validateMemberReminderWorkerEnvironment,
		}),
		DatabaseModule.forRootAsync({
			inject: [ConfigService],
			useFactory: (config: ConfigService<MemberReminderWorkerEnvironment, true>) => ({
				databaseUrl: config.get('DATABASE_URL', { infer: true }),
				poolMax: config.get('DATABASE_POOL_MAX', { infer: true }),
				connectionTimeoutMilliseconds: config.get('DATABASE_CONNECTION_TIMEOUT_MS', {
					infer: true,
				}),
			}),
		}),
	],
	providers: [MemberReminderDeliveryService, ResendMemberReminderEmailService],
})
export class MemberReminderDeliveryModule {}
