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
import { OwnerMembershipPlansController } from '../../src/modules/owner/membership-plans/owner-membership-plans.controller.js';
import { OwnerMembershipPlansService } from '../../src/modules/owner/membership-plans/owner-membership-plans.service.js';

const ROOT = '/api/v1/owner/membership-plans';
const SESSION_TOKEN = 'a'.repeat(43);
const CSRF_TOKEN = 'b'.repeat(43);
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const MEMBERSHIP_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const UPDATED_AT = '2026-10-18T08:00:00.000Z';
const SOHO_ORIGIN = 'https://soho.mucyora.rw';

const PLAN = {
	id: PLAN_ID,
	name: 'Monthly fitness',
	price: 35_000,
	currency: 'RWF' as const,
	description: null,
	status: 'ACTIVE' as const,
	createdAt: UPDATED_AT,
	updatedAt: UPDATED_AT,
	archivedAt: null,
};

describe('owner membership plan HTTP security (e2e)', () => {
	let application: NestExpressApplication | undefined;
	const authenticate = jest.fn<OwnerSessionService['authenticate']>();
	const list = jest.fn<OwnerMembershipPlansService['list']>();
	const get = jest.fn<OwnerMembershipPlansService['get']>();
	const create = jest.fn<OwnerMembershipPlansService['create']>();
	const update = jest.fn<OwnerMembershipPlansService['update']>();
	const archive = jest.fn<OwnerMembershipPlansService['archive']>();

	beforeAll(async () => {
		const configValues = new Map<string, unknown>([
			['ORGANIZATION_PORTAL_ORIGIN', null],
			['ORGANIZATION_PORTAL_BASE_DOMAIN', 'mucyora.rw'],
			['OWNER_AUTH_COOKIE_SECURE', true],
		]);
		const module = await Test.createTestingModule({
			controllers: [OwnerMembershipPlansController],
			providers: [
				OwnerCookieService,
				OwnerOriginCsrfGuard,
				OwnerSessionGuard,
				{
					provide: ConfigService,
					useValue: { get: (key: string): unknown => configValues.get(key) },
				},
				{
					provide: OwnerTokenService,
					useValue: {
						equal: (left: string, right: string) => left === right,
						isValid: (token: string) => token === SESSION_TOKEN,
					},
				},
				{ provide: OwnerSessionService, useValue: { authenticate } },
				{
					provide: OwnerMembershipPlansService,
					useValue: { list, get, create, update, archive },
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
		authenticate.mockResolvedValue(ownerPrincipal());
		list.mockResolvedValue({ items: [PLAN], nextCursor: null });
		get.mockResolvedValue(PLAN);
		create.mockResolvedValue(PLAN);
		update.mockResolvedValue({ ...PLAN, name: 'Premium fitness' });
		archive.mockResolvedValue(undefined);
	});

	afterAll(async () => application?.close());

	it('lists only the organization selected by the authenticated portal origin', async () => {
		await ownerRequest('get', ROOT)
			.expect(200)
			.expect({ items: [PLAN], nextCursor: null });
		expect(list).toHaveBeenCalledWith(ORGANIZATION_ID, {
			limit: 20,
			status: 'ACTIVE',
		});
	});

	it('creates a plan with only required name and price fields', async () => {
		await ownerRequest('post', ROOT).send({ name: 'Monthly fitness', price: 35_000 }).expect(201);
		expect(create).toHaveBeenCalledWith(ORGANIZATION_ID, {
			name: 'Monthly fitness',
			price: 35_000,
		});
	});

	it('normalizes a blank optional description to null', async () => {
		await ownerRequest('post', ROOT)
			.send({ name: 'Monthly fitness', price: 35_000, description: '   ' })
			.expect(201);
		expect(create).toHaveBeenCalledWith(
			ORGANIZATION_ID,
			expect.objectContaining({ description: null }),
		);
	});

	it('rejects missing required fields, decimal prices and unknown properties', async () => {
		for (const body of [
			{ price: 35_000 },
			{ name: 'Monthly fitness' },
			{ name: 'Monthly fitness', price: 35_000.5 },
			{ name: 'Monthly fitness', price: 35_000, organizationId: ORGANIZATION_ID },
		]) {
			await ownerRequest('post', ROOT).send(body).expect(400);
		}
		expect(create).not.toHaveBeenCalled();
	});

	it('requires authentication for reads and CSRF for mutations', async () => {
		await request(app().getHttpServer()).get(ROOT).set('Origin', SOHO_ORIGIN).expect(401);
		await ownerRequest('post', ROOT)
			.set('x-owner-csrf-token', 'invalid')
			.send({ name: 'Monthly fitness', price: 35_000 })
			.expect(403);
		expect(create).not.toHaveBeenCalled();
	});

	it("rejects Soho Gym's session from another gym subdomain", async () => {
		await ownerRequest('get', ROOT, 'https://powergym.mucyora.rw').expect(401);
		expect(list).not.toHaveBeenCalled();
	});

	it.each([
		{ status: OrganizationStatus.PENDING, roles: ['owner'] },
		{ status: OrganizationStatus.ACTIVE, roles: ['trainer'] },
	])('denies ineligible tenant access %#', async ({ status, roles }) => {
		authenticate.mockResolvedValue(ownerPrincipal(status, roles));
		await ownerRequest('get', ROOT).expect(403);
		expect(list).not.toHaveBeenCalled();
	});

	it('returns ETags and requires them for update and archival', async () => {
		await ownerRequest('get', `${ROOT}/${PLAN_ID}`).expect(200).expect('ETag', `"${UPDATED_AT}"`);
		await ownerRequest('patch', `${ROOT}/${PLAN_ID}`).send({ name: 'Premium fitness' }).expect(400);
		await ownerRequest('patch', `${ROOT}/${PLAN_ID}`)
			.set('If-Match', `"${UPDATED_AT}"`)
			.send({ name: 'Premium fitness' })
			.expect(200);
		expect(update).toHaveBeenCalledWith(
			ORGANIZATION_ID,
			PLAN_ID,
			{ name: 'Premium fitness' },
			new Date(UPDATED_AT),
		);
		await ownerRequest('delete', `${ROOT}/${PLAN_ID}`)
			.set('If-Match', `"${UPDATED_AT}"`)
			.expect(204);
		expect(archive).toHaveBeenCalledWith(ORGANIZATION_ID, PLAN_ID, new Date(UPDATED_AT));
	});

	function app(): NestExpressApplication {
		if (application === undefined) throw new Error('Membership plan test app is unavailable.');
		return application;
	}

	function ownerRequest(
		method: 'delete' | 'get' | 'patch' | 'post',
		path: string,
		origin = SOHO_ORIGIN,
	): request.Test {
		return request(app().getHttpServer())
			[method](path)
			.set('Origin', origin)
			.set('Cookie', `${OWNER_SESSION_COOKIE}=${SESSION_TOKEN}; ${OWNER_CSRF_COOKIE}=${CSRF_TOKEN}`)
			.set('x-owner-csrf-token', CSRF_TOKEN);
	}

	function ownerPrincipal(
		status = OrganizationStatus.ACTIVE,
		roles: readonly string[] = ['owner'],
	): Awaited<ReturnType<OwnerSessionService['authenticate']>> {
		return {
			sessionId: '44444444-4444-4444-8444-444444444444',
			userId: '55555555-5555-4555-8555-555555555555',
			displayName: 'Aline Uwase',
			email: 'aline@example.com',
			assurance: 'AAL1',
			expiresAt: new Date('2030-01-01T00:00:00.000Z'),
			organizations: [
				{
					organizationId: ORGANIZATION_ID,
					name: 'Soho Gym',
					slug: 'soho',
					status,
					membershipId: MEMBERSHIP_ID,
					roles,
				},
			],
		};
	}
});
