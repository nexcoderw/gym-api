import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '../../src/app-bootstrap';
import { AppModule } from '../../src/app.module';
import { validateEnvironment } from '../../src/config/environment.validation';

describe('API foundation (e2e)', () => {
	let application: INestApplication;

	beforeAll(async () => {
		const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
		application = module.createNestApplication();
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
		const response = await request(application.getHttpServer()).get('/api/v1/health/live').expect(200);

		expect(response.headers['x-request-id']).toEqual(expect.any(String));
		expect(response.headers['x-content-type-options']).toBe('nosniff');
		expect(response.body).toEqual({
			status: 'ok',
			service: 'nexcode-gym-api',
			version: '0.1.0',
			timestamp: expect.any(String),
			uptimeSeconds: expect.any(Number),
		});
	});

	it('returns the stable error envelope for unknown routes', async () => {
		const response = await request(application.getHttpServer())
			.get('/api/v1/missing')
			.set('x-request-id', 'foundation-test')
			.expect(404);

		expect(response.body).toEqual({
			error: {
				code: 'NOT_FOUND',
				message: 'Cannot GET /api/v1/missing',
				requestId: 'foundation-test',
			},
			timestamp: expect.any(String),
			path: '/api/v1/missing',
		});
	});
});
