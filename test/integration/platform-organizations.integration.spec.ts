import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '@nexcoderw/gym-db';

import { AppModule } from '../../src/app.module.js';
import {
	PlatformOrganizationAudit,
	UnavailableOrganizationAudit,
} from '../../src/modules/platform-organizations/platform-organization-audit.js';
import { PlatformOrganizationsController } from '../../src/modules/platform-organizations/platform-organizations.controller.js';
import { PlatformOrganizationMutationsService } from '../../src/modules/platform-organizations/platform-organization-mutations.service.js';
import {
	createPlatformOrganizationsDatabaseFixture,
	ORGANIZATION_ID,
} from '../fixtures/platform-organizations-database.fixture.js';

describe('organization module integration (adapter fake; no live PostgreSQL)', () => {
	let module: TestingModule;
	const database = createPlatformOrganizationsDatabaseFixture();
	beforeAll(async () => {
		module = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(PrismaService)
			.useValue(database.prisma)
			.compile();
	});
	afterAll(async () => {
		await module.close();
	});

	it('reuses the existing database provider and registers an unavailable audit provider', () => {
		expect(module.get(PrismaService)).toBe(database.prisma);
		expect(module.get(PlatformOrganizationAudit)).toBeInstanceOf(UnavailableOrganizationAudit);
	});
	it('resolves the registered controller and explicit read contract', async () => {
		const controller = module.get(PlatformOrganizationsController);
		expect(await controller.list({ limit: 20 })).toMatchObject({
			items: [{ id: ORGANIZATION_ID, name: 'Soho Gym' }],
			nextCursor: null,
		});
	});
	it('never enters organization persistence for the production audit gate', async () => {
		await expect(
			module.get(PlatformOrganizationMutationsService).create(
				{
					actorPlatformStaffId: '33333333-3333-4333-8333-333333333333',
					requestId: 'fictional-request',
				},
				{ name: 'Soho Gym', slug: 'soho' },
			),
		).rejects.toMatchObject({ status: 503 });
		expect(database.create).not.toHaveBeenCalled();
	});
});
