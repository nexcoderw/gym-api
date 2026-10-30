import { jest } from '@jest/globals';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { PrismaService } from '@nexcoderw/gym-db';
import request from 'supertest';

import { configureApplication } from '../../src/app-bootstrap.js';
import { AppModule } from '../../src/app.module.js';
import { validateEnvironment } from '../../src/config/environment.validation.js';
import { createOpenApiDocument } from '../../src/docs/swagger.js';
import {
	LOCAL_PLATFORM_CSRF_COOKIE,
	LOCAL_PLATFORM_SESSION_COOKIE,
} from '../../src/modules/platform/auth/platform-auth.constants.js';
import { ORGANIZATION_ENTITLEMENT_PERMISSION } from '../../src/modules/platform/organization-entitlements/platform-organization-entitlements.constants.js';
import { PlatformOrganizationEntitlementsService } from '../../src/modules/platform/organization-entitlements/platform-organization-entitlements.service.js';
import {
	createPlatformOrganizationsDatabaseFixture,
	organizationSessionFixture,
	ORGANIZATION_ID,
} from '../fixtures/platform-organizations-database.fixture.js';

const ROOT = `/api/v1/platform/organizations/${ORGANIZATION_ID}/entitlements`;
const FEATURE_KEY = 'organization.members.read';
const SESSION_TOKEN = 'a'.repeat(43);
const CSRF_TOKEN = 'b'.repeat(43);
const COOKIE = `${LOCAL_PLATFORM_SESSION_COOKIE}=${SESSION_TOKEN}; ${LOCAL_PLATFORM_CSRF_COOKIE}=${CSRF_TOKEN}`;
const ENTITLEMENT = {
	featureKey: FEATURE_KEY,
	enabled: true,
	effectiveStatus: 'ENABLED' as const,
	startsAt: null,
	expiresAt: null,
	version: 1,
	updatedAt: '2026-10-30T08:00:00.000Z',
};

describe('platform organization entitlement HTTP security', () => {
	let application: NestExpressApplication | undefined;
	const database = createPlatformOrganizationsDatabaseFixture();
	const list = jest.fn<PlatformOrganizationEntitlementsService['list']>();
	const update = jest.fn<PlatformOrganizationEntitlementsService['update']>();

	beforeAll(async () => {
		const module = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(PrismaService)
			.useValue(database.prisma)
			.overrideProvider(PlatformOrganizationEntitlementsService)
			.useValue({ list, update })
			.overrideProvider(getOptionsToken())
			.useValue([{ name: 'default', ttl: 60_000, limit: 10_000 }])
			.compile();
		application = module.createNestApplication<NestExpressApplication>();
		configureApplication(
			application,
			validateEnvironment({ NODE_ENV: 'test', SWAGGER_ENABLED: 'false' }),
		);
		await application.init();
	});

	beforeEach(() => {
		jest.clearAllMocks();
		database.sessionFindUnique
			.mockReset()
			.mockResolvedValue(
				organizationSessionFixture(Object.values(ORGANIZATION_ENTITLEMENT_PERMISSION)),
			);
		list.mockResolvedValue({ organizationId: ORGANIZATION_ID, items: [ENTITLEMENT] });
		update.mockResolvedValue({
			...ENTITLEMENT,
			enabled: false,
			effectiveStatus: 'DISABLED',
			version: 2,
		});
	});

	afterAll(async () => application?.close());

	it('requires authentication and the dedicated read permission', async () => {
		await request(app().getHttpServer())
			.get(ROOT)
			.set('Origin', 'http://localhost:4000')
			.expect(401);
		database.sessionFindUnique.mockResolvedValue(
			organizationSessionFixture(['platform.dashboard.read']),
		);
		await platformRequest('get', ROOT).expect(403);
		expect(list).not.toHaveBeenCalled();
	});

	it('returns the reviewed organization capability catalog without caching', async () => {
		await platformRequest('get', ROOT)
			.expect(200)
			.expect('Cache-Control', 'no-store')
			.expect({ organizationId: ORGANIZATION_ID, items: [ENTITLEMENT] });
		expect(list).toHaveBeenCalledWith(ORGANIZATION_ID);
	});

	it('requires manage permission, CSRF, a version and a validated mutation body', async () => {
		database.sessionFindUnique.mockResolvedValue(
			organizationSessionFixture([ORGANIZATION_ENTITLEMENT_PERMISSION.read]),
		);
		await platformRequest('patch', `${ROOT}/${FEATURE_KEY}`).send(validBody()).expect(403);
		database.sessionFindUnique.mockResolvedValue(
			organizationSessionFixture(Object.values(ORGANIZATION_ENTITLEMENT_PERMISSION)),
		);
		await platformRequest('patch', `${ROOT}/${FEATURE_KEY}`)
			.set('x-platform-csrf-token', 'c'.repeat(43))
			.set('If-Match', '"1"')
			.send(validBody())
			.expect(403);
		await platformRequest('patch', `${ROOT}/${FEATURE_KEY}`).send(validBody()).expect(400);
		await platformRequest('patch', `${ROOT}/${FEATURE_KEY}`)
			.set('If-Match', '"1"')
			.send({ ...validBody(), organizationId: ORGANIZATION_ID })
			.expect(400);
		expect(update).not.toHaveBeenCalled();
	});

	it('updates one capability with server-established actor context and returns its next ETag', async () => {
		const response = await platformRequest('patch', `${ROOT}/${FEATURE_KEY}`)
			.set('If-Match', '"1"')
			.send(validBody())
			.expect(200)
			.expect('ETag', '"2"')
			.expect('Cache-Control', 'no-store');
		expect(response.body).toMatchObject({ featureKey: FEATURE_KEY, enabled: false, version: 2 });
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				actorPlatformStaffId: '33333333-3333-4333-8333-333333333333',
				requestId: expect.any(String),
			}),
			ORGANIZATION_ID,
			FEATURE_KEY,
			1,
			validBody(),
		);
	});

	it('documents both entitlement operations and their protected error boundaries', () => {
		const document = createOpenApiDocument(app());
		const listOperation =
			document.paths['/api/v1/platform/organizations/{organizationId}/entitlements']?.get;
		const updateOperation =
			document.paths['/api/v1/platform/organizations/{organizationId}/entitlements/{featureKey}']
				?.patch;
		expect(listOperation?.security).toEqual([{ 'platform-session': [] }]);
		expect(updateOperation?.security).toEqual([{ 'platform-session': [] }]);
		expect(updateOperation?.responses['412']).toBeDefined();
		expect(updateOperation?.description).toContain('audit evidence');
	});

	function app(): NestExpressApplication {
		if (application === undefined) throw new Error('Entitlement HTTP application is unavailable.');
		return application;
	}

	function platformRequest(method: 'get' | 'patch', path: string): request.Test {
		const agent = request(app().getHttpServer());
		const operation = method === 'get' ? agent.get(path) : agent.patch(path);
		return operation
			.set('Origin', 'http://localhost:4000')
			.set('Cookie', COOKIE)
			.set('x-platform-csrf-token', CSRF_TOKEN);
	}

	function validBody(): { readonly enabled: false; readonly reason: string } {
		return {
			enabled: false,
			reason: 'Disable member visibility for the approved organization plan.',
		};
	}
});
