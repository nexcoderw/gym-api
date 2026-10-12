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
}
