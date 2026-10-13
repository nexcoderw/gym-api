import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import type { EnvironmentVariables } from './config/environment.types.js';
import { validateEnvironment } from './config/environment.validation.js';
import { DatabaseIntegrationModule } from './infrastructure/database/database-integration.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PlatformAuthModule } from './modules/platform-auth/platform-auth.module.js';

@Module({
	imports: [
		ConfigModule.forRoot({
			cache: true,
			envFilePath: ['.env.local', '.env'],
			ignoreEnvFile: process.env.NODE_ENV === 'test',
			isGlobal: true,
			validate: validateEnvironment,
		}),
		DatabaseIntegrationModule,
		ThrottlerModule.forRootAsync({
			inject: [ConfigService],
			useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
				throttlers: [
					{
						ttl: config.get('RATE_LIMIT_TTL_MS', { infer: true }),
						limit: config.get('RATE_LIMIT_LIMIT', { infer: true }),
					},
				],
			}),
		}),
		HealthModule,
		PlatformAuthModule,
	],
	providers: [
		{ provide: APP_GUARD, useClass: ThrottlerGuard },
		{ provide: APP_FILTER, useClass: ApiExceptionFilter },
		{ provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
	],
})
export class AppModule implements NestModule {
	configure(consumer: MiddlewareConsumer): void {
		consumer.apply(RequestIdMiddleware).forRoutes('*');
	}
}
