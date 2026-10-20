import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
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
import { OwnerPaymentReportsController } from '../../src/modules/owner/reports/owner-payment-reports.controller.js';
import { OwnerPaymentReportsService } from '../../src/modules/owner/reports/owner-payment-reports.service.js';

const PATH = '/api/v1/owner/reports/payments/summary';
const PDF_PATH = '/api/v1/owner/reports/payments/pdf';
const ORIGIN = 'https://soho.mucyora.rw';
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'a'.repeat(43);
const SUMMARY = {
	fromDate: '2026-01-01',
	toDate: '2026-01-31',
	currency: 'RWF' as const,
	paymentCount: 2,
	settledPaymentCount: 1,
	grossRwf: '15000',
	refundedRwf: '0',
	netRwf: '15000',
	generatedAt: '2026-02-01T08:00:00.000Z',
};

describe('owner payment report HTTP security', () => {
	let application: NestExpressApplication | undefined;
	const authenticate = jest.fn<OwnerSessionService['authenticate']>();
	const summary = jest.fn<OwnerPaymentReportsService['summary']>();
	const pdf = jest.fn<OwnerPaymentReportsService['pdf']>();

	beforeAll(async () => {
		const values = new Map<string, unknown>([
			['ORGANIZATION_PORTAL_ORIGIN', null],
			['ORGANIZATION_PORTAL_BASE_DOMAIN', 'mucyora.rw'],
			['OWNER_AUTH_COOKIE_SECURE', true],
		]);
		const module = await Test.createTestingModule({
			controllers: [OwnerPaymentReportsController],
			providers: [
				OwnerCookieService,
				OwnerOriginCsrfGuard,
				OwnerSessionGuard,
				{ provide: ConfigService, useValue: { get: (key: string): unknown => values.get(key) } },
				{ provide: OwnerSessionService, useValue: { authenticate } },
				{
					provide: OwnerTokenService,
					useValue: { isValid: (value: string) => value === TOKEN },
				},
				{ provide: OwnerPaymentReportsService, useValue: { summary, pdf } },
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
		summary.mockResolvedValue(SUMMARY);
		pdf.mockResolvedValue(Buffer.from('%PDF-1.7\nexample'));
	});

	afterAll(async () => application?.close());

	it('returns a no-store summary for the authenticated gym only', async () => {
		const response = await ownerRequest('?fromDate=2026-01-01&toDate=2026-01-31')
			.expect(200)
			.expect('Cache-Control', 'no-store');
		const body: unknown = response.body;
		expect(body).toEqual(SUMMARY);
		expect(summary).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: ORGANIZATION_ID, actorUserId: USER_ID }),
			{ fromDate: '2026-01-01', toDate: '2026-01-31' },
		);
	});

	it('downloads a PDF without accepting pagination or tenant controls', async () => {
		const response = await request(app().getHttpServer())
			.get(`${PDF_PATH}?fromDate=2026-01-01&toDate=2026-01-31`)
			.set('Origin', ORIGIN)
			.set('Cookie', `${OWNER_SESSION_COOKIE}=${TOKEN}`)
			.expect(200)
			.expect('Cache-Control', 'no-store')
			.expect('Content-Type', /application\/pdf/u);
		expect(response.headers['content-disposition']).toBe(
			'attachment; filename="payments-2026-01-01-to-2026-01-31.pdf"',
		);
		expect(pdf).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORGANIZATION_ID }), {
			fromDate: '2026-01-01',
			toDate: '2026-01-31',
		});
		await request(app().getHttpServer())
			.get(`${PDF_PATH}?fromDate=2026-01-01&toDate=2026-01-31&limit=24`)
			.set('Origin', ORIGIN)
			.set('Cookie', `${OWNER_SESSION_COOKIE}=${TOKEN}`)
			.expect(400);
		await request(app().getHttpServer())
			.get(`${PDF_PATH}?fromDate=2026-01-01`)
			.set('Origin', ORIGIN)
			.set('Cookie', `${OWNER_SESSION_COOKIE}=${TOKEN}`)
			.expect(400);
	});

	it('rejects missing, invalid and client-supplied tenant fields', async () => {
		await ownerRequest('?fromDate=2026-01-01').expect(400);
		await ownerRequest('?fromDate=2026-01-01&toDate=2026-01-31&organizationId=another-gym').expect(
			400,
		);
		await ownerRequest('?fromDate=2026-02&toDate=2026-03-01').expect(400);
		expect(summary).not.toHaveBeenCalled();
	});

	it('requires a valid owner session and exact gym origin', async () => {
		await request(app().getHttpServer())
			.get(`${PATH}?fromDate=2026-01-01&toDate=2026-01-31`)
			.set('Origin', ORIGIN)
			.expect(401);
		await ownerRequest('?fromDate=2026-01-01&toDate=2026-01-31')
			.set('Origin', 'https://another.mucyora.rw')
			.expect(401);
		await request(app().getHttpServer())
			.get(`${PDF_PATH}?fromDate=2026-01-01&toDate=2026-01-31`)
			.set('Origin', ORIGIN)
			.expect(401);
		expect(summary).not.toHaveBeenCalled();
		expect(pdf).not.toHaveBeenCalled();
	});

	it.each([
		{ status: OrganizationStatus.PENDING, roles: ['owner'] },
		{ status: OrganizationStatus.ACTIVE, roles: ['trainer'] },
	])('rejects ineligible organization access %#', async ({ status, roles }) => {
		authenticate.mockResolvedValue(principal(status, roles));
		await ownerRequest('?fromDate=2026-01-01&toDate=2026-01-31').expect(403);
		await request(app().getHttpServer())
			.get(`${PDF_PATH}?fromDate=2026-01-01&toDate=2026-01-31`)
			.set('Origin', ORIGIN)
			.set('Cookie', `${OWNER_SESSION_COOKIE}=${TOKEN}`)
			.expect(403);
		expect(summary).not.toHaveBeenCalled();
		expect(pdf).not.toHaveBeenCalled();
	});

	it('returns an explicit error instead of a partial PDF for oversized exports', async () => {
		pdf.mockRejectedValue(
			new PayloadTooLargeException({
				code: 'PAYMENT_REPORT_TOO_LARGE',
				message: 'Choose a shorter date range for the PDF export.',
			}),
		);
		await request(app().getHttpServer())
			.get(`${PDF_PATH}?fromDate=2026-01-01&toDate=2026-01-31`)
			.set('Origin', ORIGIN)
			.set('Cookie', `${OWNER_SESSION_COOKIE}=${TOKEN}`)
			.expect(413);
	});

	it('returns a safe unavailable response when aggregation fails', async () => {
		summary.mockRejectedValue(
			new ServiceUnavailableException({
				code: 'PAYMENT_REPORT_UNAVAILABLE',
				message: 'The payment report is temporarily unavailable.',
			}),
		);
		await ownerRequest('?fromDate=2026-01-01&toDate=2026-01-31').expect(503);
	});

	function app(): NestExpressApplication {
		if (application === undefined) throw new Error('Report test app is unavailable.');
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
					membershipId: '44444444-4444-4444-8444-444444444444',
					roles,
				},
			],
		};
	}
});
