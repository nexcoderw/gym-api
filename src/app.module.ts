import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import type { EnvironmentVariables } from './config/environment.types';
import { validateEnvironment } from './config/environment.validation';
import { HealthModule } from './modules/health/health.module';

@Module({
	imports: [
		ConfigModule.forRoot({
			cache: true,
			envFilePath: ['.env.local', '.env'],
			isGlobal: true,
			validate: validateEnvironment,
		}),
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
