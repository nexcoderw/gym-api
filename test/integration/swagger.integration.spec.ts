import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { createOpenApiDocument } from '../../src/docs/swagger';

describe('OpenAPI integration', () => {
	let application: INestApplication;

	beforeAll(async () => {
		const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
});
