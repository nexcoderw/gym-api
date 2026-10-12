import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { configureApplication } from './app-bootstrap';
import { AppModule } from './app.module';
import type { EnvironmentVariables } from './config/environment.types';

async function bootstrap(): Promise<void> {
	const application = await NestFactory.create(AppModule, { bufferLogs: true });
	const config = application.get(ConfigService<EnvironmentVariables, true>);
	const environment = config.get('NODE_ENV', { infer: true });
	application.useLogger(new Logger());
	configureApplication(application, {
		NODE_ENV: environment,
		HOST: config.get('HOST', { infer: true }),
		PORT: config.get('PORT', { infer: true }),
		CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
		SWAGGER_ENABLED: config.get('SWAGGER_ENABLED', { infer: true }),
		RATE_LIMIT_TTL_MS: config.get('RATE_LIMIT_TTL_MS', { infer: true }),
		RATE_LIMIT_LIMIT: config.get('RATE_LIMIT_LIMIT', { infer: true }),
	});
	await application.listen(
		config.get('PORT', { infer: true }),
		config.get('HOST', { infer: true }),
	);
}

void bootstrap().catch((error: unknown) => {
	const logger = new Logger('Bootstrap');
	logger.error('API startup failed.', error instanceof Error ? error.stack : undefined);
	process.exitCode = 1;
});
