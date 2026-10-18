import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
	OrganizationPaymentMethod,
	OrganizationPaymentStatus,
	OrganizationStatus,
} from '@nexcoderw/gym-db';
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
import { PaymentOrder } from '../../src/modules/owner/payments/dto/list-payments-query.dto.js';
import { OwnerPaymentsController } from '../../src/modules/owner/payments/owner-payments.controller.js';
import { OwnerPaymentsService } from '../../src/modules/owner/payments/owner-payments.service.js';

const ROOT = '/api/v1/owner/payments';
const ORIGIN = 'https://soho.mucyora.rw';
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const SUBSCRIPTION_ID = '44444444-4444-4444-8444-444444444444';
const PAYMENT_ID = '55555555-5555-4555-8555-555555555555';
const KEY = '66666666-6666-4666-8666-666666666666';
const TOKEN = 'a'.repeat(43);
const CSRF = 'b'.repeat(43);
const AT = '2026-10-18T08:00:00.000Z';
const INPUT = {
	memberId: MEMBER_ID,
	subscriptionId: SUBSCRIPTION_ID,
	amount: 30_000,
	method: OrganizationPaymentMethod.CASH,
	occurredAt: AT,
};
const REGISTRATION_INPUT = {
	member: { name: 'Example Member', phoneNumber: '+250700000001' },
	subscription: {
		membershipPlanId: SUBSCRIPTION_ID,
		startDate: '2030-01-01',
		periodUnit: 'MONTHS',
		periodCount: 1,
	},
	method: OrganizationPaymentMethod.CASH,
	occurredAt: AT,
};
const PAYMENT = {
	id: PAYMENT_ID,
	receiptNumber: 'PAY-20261018-55555555',
	memberId: MEMBER_ID,
	memberName: 'Example Member',
	amount: 30_000,
	currency: 'RWF' as const,
	method: OrganizationPaymentMethod.CASH,
	status: OrganizationPaymentStatus.CONFIRMED,
	providerReference: null,
	note: null,
	occurredAt: AT,
	confirmedAt: AT,
	voidedAt: null,
	voidReason: null,
	createdAt: AT,
	allocations: [{ subscriptionId: SUBSCRIPTION_ID, planName: 'Monthly fitness', amount: 30_000 }],
	refunds: [],
};

describe('owner payments HTTP security', () => {
	let application: NestExpressApplication | undefined;
	const authenticate = jest.fn<OwnerSessionService['authenticate']>();
	const list = jest.fn<OwnerPaymentsService['list']>();
	const get = jest.fn<OwnerPaymentsService['get']>();
	const create = jest.fn<OwnerPaymentsService['create']>();
	const registerPayment = jest.fn<OwnerPaymentsService['registerPayment']>();
	const voidPayment = jest.fn<OwnerPaymentsService['void']>();
	const refund = jest.fn<OwnerPaymentsService['refund']>();

	beforeAll(async () => {
		const values = new Map<string, unknown>([
			['ORGANIZATION_PORTAL_ORIGIN', null],
			['ORGANIZATION_PORTAL_BASE_DOMAIN', 'mucyora.rw'],
			['OWNER_AUTH_COOKIE_SECURE', true],
		]);
		const module = await Test.createTestingModule({
			controllers: [OwnerPaymentsController],
			providers: [
				OwnerCookieService,
				OwnerOriginCsrfGuard,
				OwnerSessionGuard,
				{ provide: ConfigService, useValue: { get: (key: string): unknown => values.get(key) } },
				{ provide: OwnerSessionService, useValue: { authenticate } },
				{
					provide: OwnerTokenService,
					useValue: {
						equal: (first: string, second: string) => first === second,
						isValid: (value: string) => value === TOKEN,
					},
				},
				{
					provide: OwnerPaymentsService,
					useValue: { list, get, create, registerPayment, void: voidPayment, refund },
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
		list.mockResolvedValue({ items: [PAYMENT], nextCursor: null });
		get.mockResolvedValue(PAYMENT);
		create.mockResolvedValue(PAYMENT);
		registerPayment.mockResolvedValue(PAYMENT);
		voidPayment.mockResolvedValue({ ...PAYMENT, status: OrganizationPaymentStatus.VOIDED });
		refund.mockResolvedValue({ ...PAYMENT, status: OrganizationPaymentStatus.REFUNDED });
	});

	afterAll(async () => application?.close());

	it('records a validated payment only for the authenticated gym', async () => {
		await ownerRequest('post', ROOT).set('Idempotency-Key', KEY).send(INPUT).expect(201);
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: ORGANIZATION_ID, actorUserId: USER_ID }),
			INPUT,
			KEY,
		);
	});

	it('registers a new member and payment under the authenticated gym', async () => {
		await ownerRequest('post', `${ROOT}/registrations`)
			.set('Idempotency-Key', KEY)
			.send(REGISTRATION_INPUT)
			.expect(201);
		expect(registerPayment).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: ORGANIZATION_ID, actorUserId: USER_ID }),
			REGISTRATION_INPUT,
			KEY,
		);
	});

	it('rejects forged registration fields, missing CSRF and missing idempotency', async () => {
		await ownerRequest('post', `${ROOT}/registrations`)
			.set('Idempotency-Key', KEY)
			.send({ ...REGISTRATION_INPUT, organizationId: ORGANIZATION_ID })
			.expect(400);
		await ownerRequest('post', `${ROOT}/registrations`)
			.set('x-owner-csrf-token', 'invalid')
			.set('Idempotency-Key', KEY)
			.send(REGISTRATION_INPUT)
			.expect(403);
		await ownerRequest('post', `${ROOT}/registrations`).send(REGISTRATION_INPUT).expect(400);
		expect(registerPayment).not.toHaveBeenCalled();
	});

	it('rejects client-controlled tenant and lifecycle fields', async () => {
		for (const body of [
			{ ...INPUT, organizationId: ORGANIZATION_ID },
			{ ...INPUT, status: OrganizationPaymentStatus.CONFIRMED },
			{ ...INPUT, receiptNumber: 'forged' },
			{ ...INPUT, amount: 1.5 },
			{ ...INPUT, occurredAt: 'invalid' },
		]) {
			await ownerRequest('post', ROOT).set('Idempotency-Key', KEY).send(body).expect(400);
		}
		expect(create).not.toHaveBeenCalled();
	});

	it('requires authentication, exact tenant origin and CSRF', async () => {
		await request(app().getHttpServer()).get(ROOT).set('Origin', ORIGIN).expect(401);
		await ownerRequest('get', ROOT).set('Origin', 'https://other.mucyora.rw').expect(401);
		await ownerRequest('post', ROOT)
			.set('x-owner-csrf-token', 'invalid')
			.set('Idempotency-Key', KEY)
			.send(INPUT)
			.expect(403);
		expect(create).not.toHaveBeenCalled();
	});

	it('bounds listing and protects every financial command with idempotency', async () => {
		await ownerRequest('get', `${ROOT}?limit=51`).expect(400);
		await ownerRequest('get', ROOT).expect(200).expect('Cache-Control', 'no-store');
		expect(list).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: ORGANIZATION_ID }),
			{ limit: 20, order: PaymentOrder.NEWEST },
		);
		await ownerRequest('post', ROOT).send(INPUT).expect(400);
		await ownerRequest('post', `${ROOT}/${PAYMENT_ID}/voids`)
			.send({ reason: 'Incorrect entry' })
			.expect(400);
		await ownerRequest('post', `${ROOT}/${PAYMENT_ID}/refunds`)
			.set('Idempotency-Key', 'invalid')
			.send({ amount: 1_000, reason: 'Customer request' })
			.expect(400);
	});

	it('routes details, voids and refunds without accepting a tenant id', async () => {
		await ownerRequest('get', `${ROOT}/${PAYMENT_ID}`).expect(200);
		expect(get).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: ORGANIZATION_ID }),
			PAYMENT_ID,
		);
		await ownerRequest('post', `${ROOT}/${PAYMENT_ID}/voids`)
			.set('Idempotency-Key', KEY)
			.send({ reason: 'Incorrect entry' })
			.expect(200);
		await ownerRequest('post', `${ROOT}/${PAYMENT_ID}/refunds`)
			.set('Idempotency-Key', KEY)
			.send({ amount: 1_000, reason: 'Customer request' })
			.expect(200);
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
		if (application === undefined) throw new Error('Payment test app is unavailable.');
		return application;
	}

	function ownerRequest(method: 'get' | 'post', path: string): request.Test {
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
