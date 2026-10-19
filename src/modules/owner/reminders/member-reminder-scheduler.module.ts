import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from '@nexcoderw/gym-db';

import {
	validateMemberReminderSchedulerEnvironment,
	type MemberReminderSchedulerEnvironment,
} from '../../../config/member-reminder-scheduler.environment.js';
import { MemberReminderSchedulerService } from './member-reminder-scheduler.service.js';

/** Isolated run-once process: no HTTP controllers, sender adapter or application startup hook. */
@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			ignoreEnvFile: true,
			cache: true,
			validate: validateMemberReminderSchedulerEnvironment,
		}),
		DatabaseModule.forRootAsync({
			inject: [ConfigService],
			useFactory: (config: ConfigService<MemberReminderSchedulerEnvironment, true>) => ({
				databaseUrl: config.get('DATABASE_URL', { infer: true }),
				poolMax: config.get('DATABASE_POOL_MAX', { infer: true }),
				connectionTimeoutMilliseconds: config.get('DATABASE_CONNECTION_TIMEOUT_MS', {
					infer: true,
				}),
			}),
		}),
	],
	providers: [MemberReminderSchedulerService],
})
export class MemberReminderSchedulerModule {}
