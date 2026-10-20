import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { OrganizationMemberReminderStatus as ReminderStatus, OrganizationStatus } from '@nexcoderw/gym-db';
import request from 'supertest';

import { configureApplication } from '../../src/app-bootstrap.js';
import {
	OWNER_CSRF_COOKIE,
	OWNER_SESSION_COOKIE,
} from '../../src/modules/owner/auth/owner-auth.constants.js';
import { OwnerCookieService } from '../../src/modules/owner/auth/owner-cookie.service.js';
import { OwnerOriginCsrfGuard } from '../../src/modules/owner/auth/owner-origin-csrf.guard.js';
import { OwnerSessionGuard } from '../../src/modules/owner/auth/owner-session.guard.js';
import { OwnerSessionService } from '../../src/modules/owner/auth/owner-session.service.js';
import { OwnerTokenService } from '../../src/modules/owner/auth/owner-token.service.js';
import { OwnerReminderActivityController } from '../../src/modules/owner/reminders/owner-reminder-activity.controller.js';
import { OwnerReminderActivityService } from '../../src/modules/owner/reminders/owner-reminder-activity.service.js';

const ROOT = '/api/v1/owner/reminders/activity';
const UPCOMING = '/api/v1/owner/reminders/upcoming';
const SUBSCRIPTION_ID = '77777777-7777-4777-8777-777777777777';
const MANUAL = `/api/v1/owner/reminders/subscriptions/${SUBSCRIPTION_ID}/deliveries`;
const ORIGIN = 'https://soho.mucyora.rw';
const OTHER_ORIGIN = 'https://othergym.mucyora.rw';
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(43);
const CSRF = 'b'.repeat(43);

describe('owner reminder activity HTTP security', () => {
	let application: NestExpressApplication | undefined;
	const authenticate = jest.fn<OwnerSessionService['authenticate']>();
	const list = jest.fn<OwnerReminderActivityService['list']>();
	const upcoming = jest.fn<OwnerReminderActivityService['upcoming']>();
	const queueManual = jest.fn<OwnerReminderActivityService['queueManual']>();

	beforeAll(async () => {
		const values = new Map<string, unknown>([
			['ORGANIZATION_PORTAL_ORIGIN', null],
			['ORGANIZATION_PORTAL_BASE_DOMAIN', 'mucyora.rw'],
			['OWNER_AUTH_COOKIE_SECURE', true],
		]);
		const module = await Test.createTestingModule({
			controllers: [OwnerReminderActivityController],
			providers: [
				OwnerCookieService,
				OwnerOriginCsrfGuard,
				OwnerSessionGuard,
				{ provide: ConfigService, useValue: { get: (key: string): unknown => values.get(key) } },
				{ provide: OwnerSessionService, useValue: { authenticate } },
				{
					provide: OwnerTokenService,
					useValue: {
						equal: (a: string, b: string) => a === b,
						isValid: (value: string) => value === TOKEN,
					},
				},
				{ provide: OwnerReminderActivityService, useValue: { list, upcoming, queueManual } },
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
		list.mockResolvedValue({ items: [] });
		upcoming.mockResolvedValue({ items: [], nextCursor: null });
		queueManual.mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888', status: ReminderStatus.QUEUED });
	});

	afterAll(async () => application?.close());

	it('returns only the authenticated gym feed with bounded pagination', async () => {
		await ownerRequest(ROOT).expect(200).expect('Cache-Control', 'no-store');
		expect(list).toHaveBeenCalledWith(ORGANIZATION_ID, { limit: 20 });
		await ownerRequest(`${ROOT}?limit=51`).expect(400);
		await ownerRequest(`${ROOT}?organizationId=99999999-9999-4999-8999-999999999999`).expect(400);
		expect(list).toHaveBeenCalledTimes(1);
	});

	it('rejects missing sessions, foreign gyms and invalid origins', async () => {
		await request(app().getHttpServer()).get(ROOT).set('Origin', ORIGIN).expect(401);
		await ownerRequest(ROOT).set('Origin', OTHER_ORIGIN).expect(401);
		await ownerRequest(ROOT).set('Origin', 'https://attacker.example').expect(403);
		expect(list).not.toHaveBeenCalled();
	});

	it('rejects owners without active tenant membership', async () => {
		authenticate.mockResolvedValueOnce(principal(OrganizationStatus.PENDING));
		await ownerRequest(ROOT).expect(403);
		expect(list).not.toHaveBeenCalled();
	});

	it('lists only the authenticated gym upcoming expiries with a bounded page', async () => {
		await ownerRequest(UPCOMING).expect(200).expect('Cache-Control', 'no-store');
		expect(upcoming).toHaveBeenCalledWith(ORGANIZATION_ID, { limit: 24 });
		await ownerRequest(`${UPCOMING}?limit=25`).expect(400);
		await ownerRequest(`${UPCOMING}?organizationId=${ORGANIZATION_ID}`).expect(400);
		await request(app().getHttpServer()).get(UPCOMING).set('Origin', ORIGIN).expect(401);
		await ownerRequest(UPCOMING).set('Origin', OTHER_ORIGIN).expect(401);
	});

	it('requires owner session, tenant origin and CSRF for manual email queueing', async () => {
		await request(app().getHttpServer()).post(MANUAL).set('Origin', ORIGIN).expect(401);
		await manualRequest().set('x-owner-csrf-token', 'invalid').expect(403);
		await manualRequest().set('Origin', OTHER_ORIGIN).set('x-owner-csrf-token', CSRF).expect(401);
		expect(queueManual).not.toHaveBeenCalled();
		await manualRequest().set('x-owner-csrf-token', CSRF).expect(202);
		expect(queueManual).toHaveBeenCalledWith(ORGANIZATION_ID, SUBSCRIPTION_ID);
	});

	function app(): NestExpressApplication {
		if (application === undefined) throw new Error('Reminder activity test app is unavailable.');
		return application;
	}

	function ownerRequest(path: string): request.Test {
		return request(app().getHttpServer())
			.get(path)
			.set('Origin', ORIGIN)
			.set('Cookie', `${OWNER_SESSION_COOKIE}=${TOKEN}; ${OWNER_CSRF_COOKIE}=${CSRF}`);
	}

	function manualRequest(): request.Test {
		return request(app().getHttpServer())
			.post(MANUAL)
			.set('Origin', ORIGIN)
			.set('Cookie', `${OWNER_SESSION_COOKIE}=${TOKEN}; ${OWNER_CSRF_COOKIE}=${CSRF}`);
	}

	function principal(
		status: OrganizationStatus = OrganizationStatus.ACTIVE,
	): Awaited<ReturnType<OwnerSessionService['authenticate']>> {
		return {
			sessionId: '22222222-2222-4222-8222-222222222222',
			userId: '33333333-3333-4333-8333-333333333333',
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
					roles: ['owner'],
				},
			],
		};
	}
});
