import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../../src/config/environment.types.js';
import { validateEnvironment } from '../../src/config/environment.validation.js';
import { OwnerTokenService } from '../../src/modules/owner-auth/owner-token.service.js';

describe('OwnerTokenService', () => {
	const service = new OwnerTokenService(
		new ConfigService<EnvironmentVariables, true>(
			validateEnvironment({
				NODE_ENV: 'test',
				OWNER_AUTH_TOKEN_PEPPER: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
				OWNER_ENROLLMENT_TOKEN_PEPPER: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
			}),
		),
	);

	it('creates canonical opaque tokens', () => {
		const first = service.create();
		const second = service.create();
		expect(service.isValid(first)).toBe(true);
		expect(first).not.toBe(second);
		expect(service.isValid(`${first}=`)).toBe(false);
	});

	it('separates session, enrollment and rate-limit digest domains', () => {
		const token = service.create();
		const digests = [
			service.sessionDigest(token),
			service.enrollmentDigest(token),
			service.rateLimitDigest(token),
		];
		expect(new Set(digests).size).toBe(3);
		expect(digests.every((digest) => digest.length === 64)).toBe(true);
		expect(service.equal(digests[0] ?? '', service.sessionDigest(token))).toBe(true);
	});
});
