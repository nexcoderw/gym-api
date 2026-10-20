import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { OrganizationStatus } from '@nexcoderw/gym-db';
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
import { OwnerMembersController } from '../../src/modules/owner/members/owner-members.controller.js';
import { OwnerMembersService } from '../../src/modules/owner/members/owner-members.service.js';
import { MemberPeriodUnit } from '../../src/modules/owner/members/member-period.js';
import { MemberSubscriptionStatus } from '../../src/modules/owner/members/dto/member-response.dto.js';

const ROOT = '/api/v1/owner/members';
const ORIGIN = 'https://soho.mucyora.rw';
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';
const AT = '2026-10-18T08:00:00.000Z';
const TOKEN = 'a'.repeat(43);
const CSRF = 'b'.repeat(43);
const CONTEXT = { organizationId: ORGANIZATION_ID, actorUserId: USER_ID };
const INPUT = {
	name: 'Example Member',
	phoneNumber: '+250700000001',
	subscription: {
		membershipPlanId: PLAN_ID,
		startDate: '2026-11-01',
		periodUnit: MemberPeriodUnit.MONTHS,
		periodCount: 1,
	},
};
const MEMBER = {
	id: MEMBER_ID,
	name: INPUT.name,
	phoneNumber: INPUT.phoneNumber,
	email: null,
	status: 'ACTIVE' as const,
	createdAt: AT,
	updatedAt: AT,
	archivedAt: null,
};
const SUBSCRIPTION = {
	id: KEY,
	memberId: MEMBER_ID,
	membershipPlanId: PLAN_ID,
	planName: 'Monthly fitness',
	price: 30_000,
	currency: 'RWF' as const,
	periodUnit: MemberPeriodUnit.MONTHS,
	periodCount: 1,
	startDate: '2026-11-01',
	endDate: '2026-11-30',
	status: MemberSubscriptionStatus.SCHEDULED,
	createdAt: AT,
	cancelledAt: null,
};

describe('owner members HTTP security', () => {
	let application: NestExpressApplication | undefined;
	const authenticate = jest.fn<OwnerSessionService['authenticate']>();
	const list = jest.fn<OwnerMembersService['list']>();
	const get = jest.fn<OwnerMembersService['get']>();
	const create = jest.fn<OwnerMembersService['create']>();
	const update = jest.fn<OwnerMembersService['update']>();
	const archive = jest.fn<OwnerMembersService['archive']>();
	const renew = jest.fn<OwnerMembersService['renew']>();
	const subscriptions = jest.fn<OwnerMembersService['subscriptions']>();
	const cancel = jest.fn<OwnerMembersService['cancel']>();

	beforeAll(async () => {
		const values = new Map<string, unknown>([
			['ORGANIZATION_PORTAL_ORIGIN', null],
			['ORGANIZATION_PORTAL_BASE_DOMAIN', 'mucyora.rw'],
			['OWNER_AUTH_COOKIE_SECURE', true],
		]);
		const module = await Test.createTestingModule({
			controllers: [OwnerMembersController],
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
				{
					provide: OwnerMembersService,
					useValue: { list, get, create, update, archive, renew, subscriptions, cancel },
				},
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
		list.mockResolvedValue({ items: [MEMBER], nextCursor: null });
		get.mockResolvedValue(MEMBER);
		create.mockResolvedValue({ member: MEMBER, subscription: SUBSCRIPTION });
		update.mockResolvedValue(MEMBER);
		archive.mockResolvedValue(undefined);
		renew.mockResolvedValue(SUBSCRIPTION);
		subscriptions.mockResolvedValue({ items: [SUBSCRIPTION], nextCursor: null });
		cancel.mockResolvedValue({
			...SUBSCRIPTION,
			status: MemberSubscriptionStatus.CANCELLED,
			cancelledAt: AT,
		});
	});

	afterAll(async () => application?.close());

	it('registers contact and first plan together in the trusted organization', async () => {
		await ownerRequest('post', ROOT).set('Idempotency-Key', KEY).send(INPUT).expect(201);
		expect(create).toHaveBeenCalledWith(CONTEXT, INPUT, KEY);
	});

	it('rejects missing plans, client-controlled dates/prices/tenant and invalid periods', async () => {
		for (const body of [
			{ name: INPUT.name, phoneNumber: INPUT.phoneNumber },
			{ ...INPUT, organizationId: ORGANIZATION_ID },
			{ ...INPUT, subscription: { ...INPUT.subscription, endDate: '2030-01-01' } },
			{ ...INPUT, subscription: { ...INPUT.subscription, price: 1 } },
			{ ...INPUT, subscription: { ...INPUT.subscription, periodCount: 1.5 } },
			{ ...INPUT, email: 'invalid' },
		]) {
			await ownerRequest('post', ROOT).set('Idempotency-Key', KEY).send(body).expect(400);
		}
		expect(create).not.toHaveBeenCalled();
	});

	it('requires authentication, matching tenant membership and CSRF', async () => {
		await request(app().getHttpServer()).get(ROOT).set('Origin', ORIGIN).expect(401);
		await ownerRequest('get', ROOT).set('Origin', 'https://powergym.mucyora.rw').expect(401);
		await ownerRequest('post', ROOT)
			.set('x-owner-csrf-token', 'invalid')
			.set('Idempotency-Key', KEY)
			.send(INPUT)
			.expect(403);
		expect(create).not.toHaveBeenCalled();
		expect(list).not.toHaveBeenCalled();
	});

	it('requires a registration idempotency key and rejects unknown update fields', async () => {
		await ownerRequest('post', ROOT).send(INPUT).expect(400);
		await ownerRequest('post', `${ROOT}/${MEMBER_ID}/subscriptions`)
			.set('Idempotency-Key', 'invalid')
			.send(INPUT.subscription)
			.expect(400);
		await ownerRequest('patch', `${ROOT}/${MEMBER_ID}`)
			.set('If-Match', `"${AT}"`)
			.send({ organizationId: ORGANIZATION_ID })
			.expect(400);
		await ownerRequest('patch', `${ROOT}/${MEMBER_ID}`)
			.set('If-Match', `"${AT}"`)
			.send({ name: null })
			.expect(400);
	});

	it('bounds pagination and scopes history and commands to the authenticated gym', async () => {
		await ownerRequest('get', `${ROOT}?limit=51`).expect(400);
		await ownerRequest('get', ROOT).expect(200).expect('Cache-Control', 'no-store');
		expect(list).toHaveBeenCalledWith(CONTEXT, { limit: 24, status: 'ACTIVE', order: 'NEWEST' });
		await ownerRequest('get', `${ROOT}?limit=25`).expect(400);
		await ownerRequest(
			'get',
			`${ROOT}?search=member&order=NAME_ASC&fromDate=2026-10-01&toDate=2026-10-20`,
		).expect(200);
		expect(list).toHaveBeenLastCalledWith(CONTEXT, {
			limit: 24,
			status: 'ACTIVE',
			order: 'NAME_ASC',
			search: 'member',
			fromDate: '2026-10-01',
			toDate: '2026-10-20',
		});
		await ownerRequest('get', `${ROOT}/${MEMBER_ID}/subscriptions`).expect(200);
		expect(subscriptions).toHaveBeenCalledWith(CONTEXT, MEMBER_ID, { limit: 24 });
		await ownerRequest('post', `${ROOT}/${MEMBER_ID}/subscriptions`)
			.set('Idempotency-Key', KEY)
			.send(INPUT.subscription)
			.expect(201);
		expect(renew).toHaveBeenCalledWith(CONTEXT, MEMBER_ID, INPUT.subscription, KEY);
		await ownerRequest('post', `${ROOT}/${MEMBER_ID}/subscriptions/${KEY}/cancellations`).expect(
			200,
		);
		expect(cancel).toHaveBeenCalledWith(CONTEXT, MEMBER_ID, KEY);
	});

	it('requires optimistic concurrency for profile changes and archival', async () => {
		await ownerRequest('get', `${ROOT}/${MEMBER_ID}`).expect(200).expect('ETag', `"${AT}"`);
		await ownerRequest('patch', `${ROOT}/${MEMBER_ID}`)
			.send({ name: 'Updated Member' })
			.expect(400);
		await ownerRequest('patch', `${ROOT}/${MEMBER_ID}`)
			.set('If-Match', `"${AT}"`)
			.send({ name: 'Updated Member' })
			.expect(200);
		expect(update).toHaveBeenCalledWith(
			CONTEXT,
			MEMBER_ID,
			{ name: 'Updated Member' },
			new Date(AT),
		);
		await ownerRequest('delete', `${ROOT}/${MEMBER_ID}`).set('If-Match', `"${AT}"`).expect(204);
	});

	it.each([
		{ status: OrganizationStatus.PENDING, roles: ['owner'] },
		{ status: OrganizationStatus.ACTIVE, roles: ['trainer'] },
	])('denies ineligible gym access %#', async ({ status, roles }) => {
		authenticate.mockResolvedValue(principal(status, roles));
		await ownerRequest('get', ROOT).expect(403);
		expect(list).not.toHaveBeenCalled();
	});

	function app(): NestExpressApplication {
		if (application === undefined) throw new Error('Member test app is unavailable.');
		return application;
	}

	function ownerRequest(method: 'get' | 'post' | 'patch' | 'delete', path: string): request.Test {
		return request(app().getHttpServer())
			[method](path)
			.set('Origin', ORIGIN)
			.set('Cookie', `${OWNER_SESSION_COOKIE}=${TOKEN}; ${OWNER_CSRF_COOKIE}=${CSRF}`)
			.set('x-owner-csrf-token', CSRF);
	}

	function principal(
		status: OrganizationStatus = OrganizationStatus.ACTIVE,
		roles: readonly string[] = ['owner'],
	): Awaited<ReturnType<OwnerSessionService['authenticate']>> {
		return {
			sessionId: KEY,
			userId: USER_ID,
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
					membershipId: KEY,
					roles,
				},
			],
		};
	}
});
