import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@nexcoderw/gym-db';

import { AppModule } from '../../src/app.module.js';
import { createOpenApiDocument } from '../../src/docs/swagger.js';

describe('OpenAPI integration', () => {
	let application: INestApplication;

	beforeAll(async () => {
		const module = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(PrismaService)
			.useValue({})
			.compile();
		application = module.createNestApplication();
		await application.init();
	});

	afterAll(async () => {
		await application.close();
	});

	it('documents the liveness endpoint and response contract', () => {
		const document = createOpenApiDocument(application);
		const operation = document.paths['/health/live']?.get;

		expect(operation?.summary).toBe('Check process liveness');
		expect(operation?.responses['200']).toBeDefined();
		expect(operation?.responses['429']).toBeDefined();
	});

	it('documents every platform authentication endpoint', () => {
		const document = createOpenApiDocument(application);

		expect(document.paths['/platform/auth/login']?.post?.responses['200']).toBeDefined();
		expect(document.paths['/platform/auth/mfa/verify']?.post?.responses['200']).toBeDefined();
		expect(document.paths['/platform/auth/session']?.get?.responses['401']).toBeDefined();
		expect(document.paths['/platform/auth/logout']?.post?.responses['204']).toBeDefined();
	});
});
