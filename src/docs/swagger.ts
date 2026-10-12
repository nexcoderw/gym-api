import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api.constants';

/** Builds the OpenAPI document used by protected Swagger UI and JSON export workflows. */
export function createOpenApiDocument(application: INestApplication): OpenAPIObject {
	const configuration = new DocumentBuilder()
		.setTitle('NEXCODE Gym API')
		.setDescription(
			'Shared multi-tenant API for NEXCODE Gym. Tenant access always requires authenticated organization authorization.',
		)
		.setVersion(API_VERSION)
		.addServer(`/api/v${API_VERSION}`, 'Current API version')
		.addCookieAuth('session', { type: 'apiKey', in: 'cookie' })
		.addBearerAuth(
			{ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
			'mobile-access-token',
		)
		.build();

	return SwaggerModule.createDocument(application, configuration);
}

export function configureSwagger(application: INestApplication): void {
	SwaggerModule.setup('docs', application, createOpenApiDocument(application), {
		customSiteTitle: 'NEXCODE Gym API Documentation',
	});
}
