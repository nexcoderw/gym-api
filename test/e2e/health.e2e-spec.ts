import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@nexcoderw/gym-db';
import request from 'supertest';

import { configureApplication } from '../../src/app-bootstrap.js';
import { AppModule } from '../../src/app.module.js';
import { validateEnvironment } from '../../src/config/environment.validation.js';

describe('API foundation (e2e)', () => {
	let application: NestExpressApplication;

	beforeAll(async () => {
		const module = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(PrismaService)
			.useValue({})
			.compile();
		application = module.createNestApplication<NestExpressApplication>();
		configureApplication(
			application,
			validateEnvironment({
				NODE_ENV: 'test',
				CORS_ORIGINS: 'http://localhost:3000',
				SWAGGER_ENABLED: 'false',
			}),
		);
		await application.init();
	});

	afterAll(async () => {
		await application.close();
	});

	it('serves a versioned liveness response with security headers', async () => {
		const response = await request(application.getHttpServer())
			.get('/api/v1/health/live')
			.expect(200);
		const body: unknown = response.body;

		expect(typeof response.get('x-request-id')).toBe('string');
		expect(response.get('x-content-type-options')).toBe('nosniff');
		expect(isRecord(body)).toBe(true);
		if (!isRecord(body)) {
			throw new Error('Expected a liveness response object.');
		}
		expect(body.status).toBe('ok');
		expect(body.service).toBe('nexcode-gym-api');
		expect(body.version).toBe('0.1.0');
		expect(typeof body.timestamp).toBe('string');
		expect(typeof body.uptimeSeconds).toBe('number');
	});

	it('returns the stable error envelope for unknown routes', async () => {
		const response = await request(application.getHttpServer())
			.get('/api/v1/missing')
			.set('x-request-id', 'foundation-test')
			.expect(404);
		const body: unknown = response.body;

		expect(isRecord(body)).toBe(true);
		if (!isRecord(body) || !isRecord(body.error)) {
			throw new Error('Expected an API error response object.');
		}
		expect(body.error.code).toBe('NOT_FOUND');
		expect(body.error.message).toBe('Cannot GET /api/v1/missing');
		expect(body.error.requestId).toBe('foundation-test');
		expect(typeof body.timestamp).toBe('string');
		expect(body.path).toBe('/api/v1/missing');
	});
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
