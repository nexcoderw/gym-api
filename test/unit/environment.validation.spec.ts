import { validateEnvironment } from '../../src/config/environment.validation';

describe('validateEnvironment', () => {
	it('returns safe development defaults', () => {
		expect(validateEnvironment({ NODE_ENV: 'development' })).toEqual({
			NODE_ENV: 'development',
			HOST: '127.0.0.1',
			PORT: 3001,
			CORS_ORIGINS: ['http://localhost:3000'],
			SWAGGER_ENABLED: true,
			RATE_LIMIT_TTL_MS: 60_000,
			RATE_LIMIT_LIMIT: 100,
		});
	});

	it('requires explicit production origins', () => {
		expect(() => validateEnvironment({ NODE_ENV: 'production' })).toThrow(
			'CORS_ORIGINS is required in production.',
		);
	});

	it('rejects origins containing paths', () => {
		expect(() =>
			validateEnvironment({
				NODE_ENV: 'test',
				CORS_ORIGINS: 'https://soho.gym.rw/dashboard',
			}),
		).toThrow('CORS_ORIGINS must contain HTTP origins without paths.');
	});

	it('disables production Swagger by default', () => {
		const configuration = validateEnvironment({
			NODE_ENV: 'production',
			CORS_ORIGINS: 'https://gym.rw,https://admin.gym.rw',
		});

		expect(configuration.SWAGGER_ENABLED).toBe(false);
		expect(configuration.CORS_ORIGINS).toEqual(['https://gym.rw', 'https://admin.gym.rw']);
	});
});
