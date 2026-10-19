import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from '@nexcoderw/gym-db';

import {
	validateMemberReminderReconcilerEnvironment,
	type MemberReminderReconcilerEnvironment,
} from '../../../config/member-reminder-reconciler.environment.js';
import { ResendMemberReminderStatusService } from '../../../infrastructure/email/resend-member-reminder-status.service.js';
import { MemberReminderReconcilerService } from './member-reminder-reconciler.service.js';

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			ignoreEnvFile: true,
			cache: true,
			validate: validateMemberReminderReconcilerEnvironment,
		}),
		DatabaseModule.forRootAsync({
			inject: [ConfigService],
			useFactory: (config: ConfigService<MemberReminderReconcilerEnvironment, true>) => ({
				databaseUrl: config.get('DATABASE_URL', { infer: true }),
				poolMax: config.get('DATABASE_POOL_MAX', { infer: true }),
				connectionTimeoutMilliseconds: config.get('DATABASE_CONNECTION_TIMEOUT_MS', {
					infer: true,
				}),
			}),
		}),
	],
	providers: [MemberReminderReconcilerService, ResendMemberReminderStatusService],
})
export class MemberReminderReconcilerModule {}
