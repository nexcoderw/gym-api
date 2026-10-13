import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';

import { API_PREFIX, API_VERSION } from './common/constants/api.constants.js';
import { createValidationException } from './common/pipes/validation-exception.factory.js';
import type { EnvironmentVariables } from './config/environment.types.js';
import { configureSwagger } from './docs/swagger.js';

type ApplicationConfiguration = Pick<EnvironmentVariables, 'CORS_ORIGINS' | 'SWAGGER_ENABLED'>;

/** Applies transport-wide security and API conventions to production and test applications. */
export function configureApplication(
	application: INestApplication,
	configuration: ApplicationConfiguration,
): void {
	application.enableShutdownHooks();
	application.setGlobalPrefix(API_PREFIX);
	application.enableVersioning({ defaultVersion: API_VERSION, type: VersioningType.URI });
	application.use(helmet());
	application.enableCors({
		origin: configuration.CORS_ORIGINS,
		credentials: true,
		methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	});
	application.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
			transformOptions: { enableImplicitConversion: false },
			exceptionFactory: createValidationException,
		}),
	);

	if (configuration.SWAGGER_ENABLED) {
		configureSwagger(application);
	}
}
