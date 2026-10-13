import { validateEnvironment } from '../../src/config/environment.validation.js';

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
			DATABASE_URL: 'postgresql://gym_app:local-only@localhost:5432/nexcode_gym',
			DATABASE_POOL_MAX: 10,
			DATABASE_CONNECTION_TIMEOUT_MS: 10_000,
			PLATFORM_ADMIN_ORIGIN: 'http://localhost:3000',
			PLATFORM_AUTH_COOKIE_SECURE: false,
			PLATFORM_AUTH_DUMMY_PASSWORD_HASH:
				'$argon2id$v=19$m=65536,t=3,p=1$c3ludGhldGljLXNhbHQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
			PLATFORM_AUTH_TOKEN_PEPPER: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
			PLATFORM_AUTH_SESSION_TTL_SECONDS: 28_800,
			PLATFORM_AUTH_IDLE_TTL_SECONDS: 1_800,
			PLATFORM_AUTH_MFA_CHALLENGE_TTL_SECONDS: 300,
			PLATFORM_AUTH_MFA_MAX_ATTEMPTS: 5,
			PLATFORM_AUTH_LOGIN_ATTEMPT_WINDOW_MS: 900_000,
			PLATFORM_AUTH_LOGIN_ATTEMPT_LIMIT: 5,
			PLATFORM_AUTH_SINGLE_INSTANCE: true,
			PLATFORM_TOTP_KEYRING: {
				'local-v1': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
			},
			PLATFORM_TOTP_ACTIVE_KEY_ID: 'local-v1',
			PLATFORM_OWNER_BOOTSTRAP_ENABLED: false,
			PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_HOST: null,
			PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_NAME: null,
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
			DATABASE_URL: 'postgresql://gym_app:password@database.example/nexcode_gym',
			PLATFORM_ADMIN_ORIGIN: 'https://admin.gym.rw',
			PLATFORM_AUTH_DUMMY_PASSWORD_HASH:
				'$argon2id$v=19$m=65536,t=3,p=1$c3ludGhldGljLXNhbHQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
			PLATFORM_AUTH_TOKEN_PEPPER: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
			PLATFORM_AUTH_SINGLE_INSTANCE: 'true',
			PLATFORM_TOTP_KEYRING: 'production-v1=AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
			PLATFORM_TOTP_ACTIVE_KEY_ID: 'production-v1',
		});

		expect(configuration.SWAGGER_ENABLED).toBe(false);
		expect(configuration.CORS_ORIGINS).toEqual(['https://gym.rw', 'https://admin.gym.rw']);
	});

	it('requires an exact database fingerprint when owner bootstrap is enabled', () => {
		expect(() =>
			validateEnvironment({
				NODE_ENV: 'test',
				DATABASE_URL: 'postgresql://gym_bootstrap:secret@approved.neon.tech/neondb',
				PLATFORM_OWNER_BOOTSTRAP_ENABLED: 'true',
				PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_HOST: 'wrong.neon.tech',
				PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_NAME: 'neondb',
			}),
		).toThrow('The configured database does not match the approved platform owner bootstrap target.');
	});

	it('rejects the development key material in production', () => {
		expect(() =>
			validateEnvironment({
				NODE_ENV: 'production',
				CORS_ORIGINS: 'https://admin.gym.rw',
				DATABASE_URL: 'postgresql://gym_app:password@database.example/nexcode_gym',
				PLATFORM_ADMIN_ORIGIN: 'https://admin.gym.rw',
				PLATFORM_AUTH_DUMMY_PASSWORD_HASH:
					'$argon2id$v=19$m=65536,t=3,p=1$c3ludGhldGljLXNhbHQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
				PLATFORM_AUTH_TOKEN_PEPPER: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
				PLATFORM_AUTH_SINGLE_INSTANCE: 'true',
				PLATFORM_TOTP_KEYRING: 'production-v1=AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
			}),
		).toThrow('PLATFORM_AUTH_TOKEN_PEPPER must not use the local development key.');
	});
});
