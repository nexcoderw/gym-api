import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { configureApplication } from './app-bootstrap.js';
import { AppModule } from './app.module.js';
import type { EnvironmentVariables } from './config/environment.types.js';

async function bootstrap(): Promise<void> {
	const application = await NestFactory.create(AppModule, { bufferLogs: true });
	const config = application.get(ConfigService<EnvironmentVariables, true>);
	application.useLogger(new Logger());
	configureApplication(application, {
		CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
		SWAGGER_ENABLED: config.get('SWAGGER_ENABLED', { infer: true }),
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
