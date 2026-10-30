import { jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ORGANIZATION_ENTITLEMENT, OrganizationStatus } from '@nexcoderw/gym-db';
import request from 'supertest';

import { configureApplication } from '../../src/app-bootstrap.js';
import { OWNER_SESSION_COOKIE } from '../../src/modules/owner/auth/owner-auth.constants.js';
import { OwnerCookieService } from '../../src/modules/owner/auth/owner-cookie.service.js';
import { OwnerOriginCsrfGuard } from '../../src/modules/owner/auth/owner-origin-csrf.guard.js';
import { OwnerSessionGuard } from '../../src/modules/owner/auth/owner-session.guard.js';
import { OwnerSessionService } from '../../src/modules/owner/auth/owner-session.service.js';
import { OwnerTokenService } from '../../src/modules/owner/auth/owner-token.service.js';
import { OwnerCapabilitiesController } from '../../src/modules/owner/entitlements/owner-capabilities.controller.js';
import { OwnerEntitlementService } from '../../src/modules/owner/entitlements/owner-entitlement.service.js';

const PATH = '/api/v1/owner/capabilities';
const ORIGIN = 'https://soho.mucyora.rw';
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(43);

describe('owner capability bootstrap HTTP security', () => {
	let application: NestExpressApplication | undefined;
	const authenticate = jest.fn<OwnerSessionService['authenticate']>();
	const listEnabled = jest.fn<OwnerEntitlementService['listEnabled']>();

	beforeAll(async () => {
		const values = new Map<string, unknown>([
			['ORGANIZATION_PORTAL_ORIGIN', null],
			['ORGANIZATION_PORTAL_BASE_DOMAIN', 'mucyora.rw'],
			['OWNER_AUTH_COOKIE_SECURE', true],
		]);
		const module = await Test.createTestingModule({
			controllers: [OwnerCapabilitiesController],
			providers: [
				OwnerCookieService,
				OwnerOriginCsrfGuard,
				OwnerSessionGuard,
				{ provide: ConfigService, useValue: { get: (key: string): unknown => values.get(key) } },
				{ provide: OwnerSessionService, useValue: { authenticate } },
				{ provide: OwnerEntitlementService, useValue: { listEnabled } },
				{ provide: OwnerTokenService, useValue: { isValid: (value: string) => value === TOKEN } },
			],
		}).compile();
		application = module.createNestApplication<NestExpressApplication>();
		configureApplication(application, {
			CORS_ORIGINS: [],
			ORGANIZATION_PORTAL_BASE_DOMAIN: 'mucyora.rw',
			SWAGGER_ENABLED: false,
		});
		await application.init();
	});

	beforeEach(() => {
		jest.clearAllMocks();
		authenticate.mockResolvedValue(principal());
		listEnabled.mockResolvedValue([
			ORGANIZATION_ENTITLEMENT.membersRead,
			ORGANIZATION_ENTITLEMENT.paymentsRead,
		]);
	});

	afterAll(async () => application?.close());

	it('returns a no-store, organization-bound effective capability snapshot', async () => {
		const response = await ownerRequest().expect(200).expect('Cache-Control', 'no-store');
		const body: unknown = response.body;
		expect(body).toMatchObject({
			organizationId: ORGANIZATION_ID,
			capabilities: [ORGANIZATION_ENTITLEMENT.membersRead, ORGANIZATION_ENTITLEMENT.paymentsRead],
		});
		expect(listEnabled).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID }, expect.any(Date));
	});

	it('requires the verified owner session and matching organization portal origin', async () => {
		await request(app().getHttpServer()).get(PATH).set('Origin', ORIGIN).expect(401);
		await ownerRequest().set('Origin', 'https://another.mucyora.rw').expect(401);
		expect(listEnabled).not.toHaveBeenCalled();
	});

	it.each([
		{ status: OrganizationStatus.SUSPENDED, roles: ['owner'] },
		{ status: OrganizationStatus.ACTIVE, roles: ['trainer'] },
	])(
		'fails closed before listing capabilities for an ineligible organization %#',
		async ({ status, roles }) => {
			authenticate.mockResolvedValue(principal(status, roles));
			await ownerRequest().expect(403);
			expect(listEnabled).not.toHaveBeenCalled();
		},
	);

	it('does not return a partial snapshot when evaluation is unavailable', async () => {
		listEnabled.mockRejectedValueOnce(new ServiceUnavailableException('unavailable'));
		await ownerRequest().expect(503);
	});

	function app(): NestExpressApplication {
		if (application === undefined) throw new Error('Capability test app is unavailable.');
		return application;
	}

	function ownerRequest(): request.Test {
		return request(app().getHttpServer())
			.get(PATH)
			.set('Origin', ORIGIN)
			.set('Cookie', `${OWNER_SESSION_COOKIE}=${TOKEN}`);
	}

	function principal(
		status: OrganizationStatus = OrganizationStatus.ACTIVE,
		roles: readonly string[] = ['owner'],
	): Awaited<ReturnType<OwnerSessionService['authenticate']>> {
		return {
			sessionId: '33333333-3333-4333-8333-333333333333',
			userId: '22222222-2222-4222-8222-222222222222',
			displayName: 'Example Owner',
			email: 'owner@example.com',
			assurance: 'AAL1',
			expiresAt: new Date('2030-01-01T00:00:00.000Z'),
			organizations: [
				{
					organizationId: ORGANIZATION_ID,
					name: 'Soho Gym',
					slug: 'soho',
					status,
					membershipId: '44444444-4444-4444-8444-444444444444',
					roles,
				},
			],
		};
	}
});
