export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

/** Validated process configuration available through Nest's ConfigService. */
export interface EnvironmentVariables {
	readonly NODE_ENV: NodeEnvironment;
	readonly HOST: string;
	readonly PORT: number;
	readonly CORS_ORIGINS: string[];
	readonly SWAGGER_ENABLED: boolean;
	readonly RATE_LIMIT_TTL_MS: number;
	readonly RATE_LIMIT_LIMIT: number;
	readonly DATABASE_URL: string;
	readonly DATABASE_POOL_MAX: number;
	readonly DATABASE_CONNECTION_TIMEOUT_MS: number;
	readonly PLATFORM_ADMIN_ORIGIN: string;
	readonly PLATFORM_AUTH_COOKIE_SECURE: boolean;
	readonly PLATFORM_AUTH_DUMMY_PASSWORD_HASH: string;
	readonly PLATFORM_AUTH_TOKEN_PEPPER: string;
	readonly PLATFORM_AUTH_SESSION_TTL_SECONDS: number;
	readonly PLATFORM_AUTH_IDLE_TTL_SECONDS: number;
	readonly PLATFORM_AUTH_MFA_CHALLENGE_TTL_SECONDS: number;
	readonly PLATFORM_AUTH_MFA_MAX_ATTEMPTS: number;
	readonly PLATFORM_AUTH_LOGIN_ATTEMPT_WINDOW_MS: number;
	readonly PLATFORM_AUTH_LOGIN_ATTEMPT_LIMIT: number;
	readonly PLATFORM_AUTH_SINGLE_INSTANCE: boolean;
	readonly PLATFORM_TOTP_KEYRING: Readonly<Record<string, string>>;
	readonly PLATFORM_TOTP_ACTIVE_KEY_ID: string;
	readonly PLATFORM_OWNER_BOOTSTRAP_ENABLED: boolean;
	readonly PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_HOST: string | null;
	readonly PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_NAME: string | null;
}
