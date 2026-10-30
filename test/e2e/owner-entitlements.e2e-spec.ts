import { jest } from '@jest/globals';
import {
	CanActivate,
	Controller,
	ExecutionContext,
	Get,
	Injectable,
	ServiceUnavailableException,
	UseGuards,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ORGANIZATION_ENTITLEMENT, OrganizationStatus, PrismaService } from '@nexcoderw/gym-db';
import request from 'supertest';

import { configureApplication } from '../../src/app-bootstrap.js';
import { AppModule } from '../../src/app.module.js';
import { validateEnvironment } from '../../src/config/environment.validation.js';
import type { OwnerRequest } from '../../src/modules/owner/auth/owner-request.js';
import { OWNER_ENTITLEMENT_ERROR } from '../../src/modules/owner/entitlements/owner-entitlement.constants.js';
import { OwnerEntitlementGuard } from '../../src/modules/owner/entitlements/owner-entitlement.guard.js';
import { OwnerEntitlementService } from '../../src/modules/owner/entitlements/owner-entitlement.service.js';
import { RequireOwnerEntitlements } from '../../src/modules/owner/entitlements/require-owner-entitlements.decorator.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';

@Injectable()
class FixtureOwnerPrincipalGuard implements CanActivate {
	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<OwnerRequest>();
		request.ownerPrincipal = {
			sessionId: '22222222-2222-4222-8222-222222222222',
			userId: '33333333-3333-4333-8333-333333333333',
			displayName: 'Fictional Gym Owner',
			email: 'owner@example.com',
			assurance: 'AAL1',
			expiresAt: new Date('2030-01-01T00:00:00.000Z'),
			organizations: [
				{
					organizationId: ORGANIZATION_ID,
					name: 'Soho Gym',
					slug: 'soho',
					status: OrganizationStatus.ACTIVE,
					membershipId: '44444444-4444-4444-8444-444444444444',
					roles: ['owner'],
				},
			],
		};
		return true;
	}
}

@Injectable()
class FixtureSuspendedOrganizationGuard implements CanActivate {
	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<OwnerRequest>();
		request.ownerPrincipal = {
			sessionId: '22222222-2222-4222-8222-222222222222',
			userId: '33333333-3333-4333-8333-333333333333',
			displayName: 'Fictional Gym Owner',
			email: 'owner@example.com',
			assurance: 'AAL1',
			expiresAt: new Date('2030-01-01T00:00:00.000Z'),
			organizations: [
				{
					organizationId: ORGANIZATION_ID,
					name: 'Soho Gym',
					slug: 'soho',
					status: OrganizationStatus.SUSPENDED,
					membershipId: '44444444-4444-4444-8444-444444444444',
					roles: ['owner'],
				},
			],
		};
		return true;
	}
}

@Controller('owner/entitlement-probe')
class OwnerEntitlementProbeController {
	@Get('declared')
	@UseGuards(FixtureOwnerPrincipalGuard, OwnerEntitlementGuard)
	@RequireOwnerEntitlements(ORGANIZATION_ENTITLEMENT.membersRead)
	declared(): { readonly status: 'permitted' } {
		return { status: 'permitted' };
	}

	@Get('undeclared')
	@UseGuards(FixtureOwnerPrincipalGuard, OwnerEntitlementGuard)
	undeclared(): { readonly status: 'unreachable' } {
		return { status: 'unreachable' };
	}

	@Get('missing-scope')
	@UseGuards(OwnerEntitlementGuard)
	@RequireOwnerEntitlements(ORGANIZATION_ENTITLEMENT.membersRead)
	missingScope(): { readonly status: 'unreachable' } {
		return { status: 'unreachable' };
	}

	@Get('suspended')
	@UseGuards(FixtureSuspendedOrganizationGuard, OwnerEntitlementGuard)
	@RequireOwnerEntitlements(ORGANIZATION_ENTITLEMENT.membersRead)
	suspended(): { readonly status: 'unreachable' } {
		return { status: 'unreachable' };
	}
}

describe('owner entitlement policy HTTP behavior (e2e)', () => {
	let application: NestExpressApplication | undefined;
	const hasAllEnabled = jest.fn<OwnerEntitlementService['hasAllEnabled']>();

	beforeAll(async () => {
		const module = await Test.createTestingModule({
			imports: [AppModule],
			controllers: [OwnerEntitlementProbeController],
			providers: [
				FixtureOwnerPrincipalGuard,
				FixtureSuspendedOrganizationGuard,
				OwnerEntitlementGuard,
				{ provide: OwnerEntitlementService, useValue: { hasAllEnabled } },
			],
		})
			.overrideProvider(PrismaService)
			.useValue({})
			.compile();
		application = module.createNestApplication<NestExpressApplication>();
		configureApplication(application, validateEnvironment({ NODE_ENV: 'test' }));
		await application.init();
	});

	beforeEach(() => {
		hasAllEnabled.mockReset().mockResolvedValue(true);
	});

	afterAll(async () => application?.close());

	it('allows the operation only when every declared entitlement is live', async () => {
		await request(requireApplication(application).getHttpServer())
			.get('/api/v1/owner/entitlement-probe/declared')
			.expect(200, { status: 'permitted' });
		expect(hasAllEnabled).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID }, [
			ORGANIZATION_ENTITLEMENT.membersRead,
		]);
	});

	it('returns a stable forbidden error when the organization feature is disabled', async () => {
		hasAllEnabled.mockResolvedValueOnce(false);
		const response = await request(requireApplication(application).getHttpServer())
			.get('/api/v1/owner/entitlement-probe/declared')
			.expect(403);
		const body: unknown = response.body;
		expect(body).toMatchObject({
			error: { code: 'ORGANIZATION_FEATURE_DISABLED' },
		});
	});

	it('does not expose persistence details when entitlement evaluation is unavailable', async () => {
		hasAllEnabled.mockRejectedValueOnce(
			new ServiceUnavailableException(OWNER_ENTITLEMENT_ERROR.unavailable, {
				cause: new Error('private database host and query detail'),
			}),
		);
		const response = await request(requireApplication(application).getHttpServer())
			.get('/api/v1/owner/entitlement-probe/declared')
			.expect(503);
		const body: unknown = response.body;
		const serialized = JSON.stringify(body);
		expect(body).toMatchObject({
			error: { code: 'ORGANIZATION_ENTITLEMENT_UNAVAILABLE' },
		});
		expect(serialized).not.toContain('private database');
		expect(serialized).not.toContain('query detail');
	});

	it('fails closed when a guarded operation has no entitlement declaration', async () => {
		const response = await request(requireApplication(application).getHttpServer())
			.get('/api/v1/owner/entitlement-probe/undeclared')
			.expect(403);
		const body: unknown = response.body;
		expect(body).toMatchObject({
			error: { code: 'ORGANIZATION_ENTITLEMENT_REQUIRED' },
		});
		expect(hasAllEnabled).not.toHaveBeenCalled();
	});

	it('does not accept a missing verified organization context', async () => {
		const response = await request(requireApplication(application).getHttpServer())
			.get('/api/v1/owner/entitlement-probe/missing-scope')
			.expect(403);
		const body: unknown = response.body;
		expect(body).toMatchObject({
			error: { code: 'ORGANIZATION_SCOPE_REQUIRED' },
		});
		expect(hasAllEnabled).not.toHaveBeenCalled();
	});

	it('rejects a suspended organization before reading its entitlements', async () => {
		const response = await request(requireApplication(application).getHttpServer())
			.get('/api/v1/owner/entitlement-probe/suspended')
			.expect(403);
		const body: unknown = response.body;
		expect(body).toMatchObject({
			error: { code: 'ORGANIZATION_SCOPE_REQUIRED' },
		});
		expect(hasAllEnabled).not.toHaveBeenCalled();
	});
});

function requireApplication(
	application: NestExpressApplication | undefined,
): NestExpressApplication {
	if (application === undefined) throw new Error('The e2e application was not initialized.');
	return application;
}
