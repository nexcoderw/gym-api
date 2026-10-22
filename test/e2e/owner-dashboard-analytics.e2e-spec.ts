import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { OrganizationStatus } from '@nexcoderw/gym-db';
import request from 'supertest';

import { configureApplication } from '../../src/app-bootstrap.js';
import { OWNER_SESSION_COOKIE } from '../../src/modules/owner/auth/owner-auth.constants.js';
import { OwnerCookieService } from '../../src/modules/owner/auth/owner-cookie.service.js';
import { OwnerOriginCsrfGuard } from '../../src/modules/owner/auth/owner-origin-csrf.guard.js';
import { OwnerSessionGuard } from '../../src/modules/owner/auth/owner-session.guard.js';
import { OwnerSessionService } from '../../src/modules/owner/auth/owner-session.service.js';
import { OwnerTokenService } from '../../src/modules/owner/auth/owner-token.service.js';
import { OwnerDashboardAnalyticsController } from '../../src/modules/owner/dashboard/owner-dashboard-analytics.controller.js';
import { OwnerDashboardAnalyticsService } from '../../src/modules/owner/dashboard/owner-dashboard-analytics.service.js';
import type {
	OwnerDashboardAnalyticsQueryDto,
	OwnerDashboardAnalyticsResponseDto,
} from '../../src/modules/owner/dashboard/dto/owner-dashboard-analytics.dto.js';
import { resolveDashboardPeriod } from '../../src/modules/owner/dashboard/owner-dashboard-analytics.policy.js';

const PATH = '/api/v1/owner/dashboard/analytics';
const ORIGIN = 'https://soho.mucyora.rw';
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(43);
const RESPONSE: OwnerDashboardAnalyticsResponseDto = {
	period: {
		fromDate: '2026-01-01',
		toDate: '2026-01-02',
		comparisonFromDate: '2025-12-30',
		comparisonToDate: '2025-12-31',
		timeZone: 'Africa/Kigali',
		revenueBucket: 'DAY',
	},
	currency: 'RWF',
	metrics: {
		netCollected: {
			currentRwf: '15000',
			previousRwf: '0',
			change: { direction: 'NEW', percent: null },
		},
		settledPayments: { current: 1, previous: 0, change: { direction: 'NEW', percent: null } },
		newMembers: { current: 1, previous: 0, change: { direction: 'NEW', percent: null } },
		activeSubscribers: { current: 1, previous: 0, change: { direction: 'NEW', percent: null } },
	},
	revenueSeries: [
		{
			fromDate: '2026-01-01',
			toDate: '2026-01-01',
			grossRwf: '15000',
			refundedRwf: '0',
			netRwf: '15000',
		},
	],
	planTotals: [],
	methodTotals: [],
	generatedAt: '2026-01-03T08:00:00.000Z',
};

describe('owner dashboard analytics HTTP security', () => {
	let application: NestExpressApplication | undefined;
	const authenticate = jest.fn<OwnerSessionService['authenticate']>();
	const get = jest.fn<OwnerDashboardAnalyticsService['get']>();

	beforeAll(async () => {
		const values = new Map<string, unknown>([
			['ORGANIZATION_PORTAL_ORIGIN', null],
			['ORGANIZATION_PORTAL_BASE_DOMAIN', 'mucyora.rw'],
			['OWNER_AUTH_COOKIE_SECURE', true],
		]);
		const module = await Test.createTestingModule({
			controllers: [OwnerDashboardAnalyticsController],
			providers: [
				OwnerCookieService,
				OwnerOriginCsrfGuard,
				OwnerSessionGuard,
				{ provide: ConfigService, useValue: { get: (key: string): unknown => values.get(key) } },
				{ provide: OwnerSessionService, useValue: { authenticate } },
				{ provide: OwnerTokenService, useValue: { isValid: (value: string) => value === TOKEN } },
				{ provide: OwnerDashboardAnalyticsService, useValue: { get } },
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
		get.mockImplementation(async (_context, query: OwnerDashboardAnalyticsQueryDto) => {
			resolveDashboardPeriod(query, new Date('2026-10-22T08:00:00.000Z'));
			return RESPONSE;
		});
	});

	afterAll(async () => application?.close());

	it('returns the authenticated gym’s analytics without browser-selected tenant context', async () => {
		const response = await ownerRequest('?fromDate=2026-01-01&toDate=2026-01-02')
			.expect(200)
			.expect('Cache-Control', 'no-store');
		const body: unknown = response.body;
		expect(body).toEqual(RESPONSE);
		expect(get).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORGANIZATION_ID }), {
			fromDate: '2026-01-01',
			toDate: '2026-01-02',
		});
		await ownerRequest('').expect(200);
		expect(get).toHaveBeenLastCalledWith(
			expect.objectContaining({ organizationId: ORGANIZATION_ID }),
			{},
		);
	});

	it('rejects unpaired, malformed and client-supplied tenant query fields', async () => {
		await ownerRequest('?fromDate=2026-01-01').expect(400);
		await ownerRequest('?fromDate=2026-02-30&toDate=2026-03-01').expect(400);
		await ownerRequest('?organizationId=another-gym').expect(400);
		expect(get).not.toHaveBeenCalled();
	});

	it('requires a valid owner session and matching portal origin', async () => {
		await request(app().getHttpServer()).get(PATH).set('Origin', ORIGIN).expect(401);
		await ownerRequest('').set('Origin', 'https://another.mucyora.rw').expect(401);
		expect(get).not.toHaveBeenCalled();
	});

	it.each([
		{ status: OrganizationStatus.PENDING, roles: ['owner'] },
		{ status: OrganizationStatus.ACTIVE, roles: ['trainer'] },
	])('denies ineligible organization access %#', async ({ status, roles }) => {
		authenticate.mockResolvedValue(principal(status, roles));
		await ownerRequest('').expect(403);
		expect(get).not.toHaveBeenCalled();
	});

	it('does not return partial analytics on backend failure', async () => {
		get.mockRejectedValue(
			new ServiceUnavailableException({ code: 'DASHBOARD_ANALYTICS_UNAVAILABLE' }),
		);
		await ownerRequest('').expect(503);
	});

	function app(): NestExpressApplication {
		if (application === undefined) throw new Error('Dashboard test app is unavailable.');
		return application;
	}

	function ownerRequest(query: string): request.Test {
		return request(app().getHttpServer())
			.get(`${PATH}${query}`)
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
