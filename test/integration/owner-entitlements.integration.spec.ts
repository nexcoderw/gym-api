import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '@nexcoderw/gym-db';

import { AppModule } from '../../src/app.module.js';
import {
	OwnerEntitlementGuard,
} from '../../src/modules/owner/entitlements/owner-entitlement.guard.js';
import {
	OwnerEntitlementService,
} from '../../src/modules/owner/entitlements/owner-entitlement.service.js';

describe('OwnerEntitlementsModule integration', () => {
	let module: TestingModule;

	beforeAll(async () => {
		module = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(PrismaService)
			.useValue({ organizationFeatureEntitlement: { count: () => 0 } })
			.compile();
	});

	afterAll(async () => module.close());

	it('registers the live entitlement service and default-deny guard', () => {
		expect(module.get(OwnerEntitlementService)).toBeInstanceOf(OwnerEntitlementService);
		expect(module.get(OwnerEntitlementGuard)).toBeInstanceOf(OwnerEntitlementGuard);
	});
});
