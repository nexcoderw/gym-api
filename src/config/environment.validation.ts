import {
	NODE_ENVIRONMENTS,
	type EnvironmentVariables,
	type NodeEnvironment,
} from './environment.types';

const DEFAULT_PORT = 3001;
const DEFAULT_RATE_LIMIT_TTL_MS = 60_000;
const DEFAULT_RATE_LIMIT_LIMIT = 100;
const DEFAULT_LOCAL_ORIGIN = 'http://localhost:3000';

function parseInteger(
	value: unknown,
	name: string,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	if (value === undefined || value === '') {
		return fallback;
	}

	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(
			`${name} must be an integer between ${String(minimum)} and ${String(maximum)}.`,
		);
	}
	return parsed;
}

function parseBoolean(value: unknown, name: string, fallback: boolean): boolean {
	if (value === undefined || value === '') {
		return fallback;
	}
	if (value === true || value === 'true') {
		return true;
	}
	if (value === false || value === 'false') {
		return false;
	}
	throw new Error(`${name} must be either true or false.`);
}

function parseNodeEnvironment(value: unknown): NodeEnvironment {
	const environment = value ?? 'development';
	if (typeof environment !== 'string' || !isNodeEnvironment(environment)) {
		throw new Error(`NODE_ENV must be one of: ${NODE_ENVIRONMENTS.join(', ')}.`);
	}
	return environment;
}

function isNodeEnvironment(value: string): value is NodeEnvironment {
	return NODE_ENVIRONMENTS.some((environment) => environment === value);
}

function parseOrigins(value: unknown, environment: NodeEnvironment): string[] {
	const rawOrigins = typeof value === 'string' ? value : '';
	const candidates = rawOrigins
		.split(',')
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0);

	if (candidates.length === 0) {
		if (environment === 'production') {
			throw new Error('CORS_ORIGINS is required in production.');
		}
		return [DEFAULT_LOCAL_ORIGIN];
	}

	return candidates.map((candidate) => {
		let url: URL;
		try {
			url = new URL(candidate);
		} catch {
			throw new Error('CORS_ORIGINS must contain valid absolute origins.');
		}
		if (url.origin !== candidate || !['http:', 'https:'].includes(url.protocol)) {
			throw new Error('CORS_ORIGINS must contain HTTP origins without paths.');
		}
		return url.origin;
	});
}

/** Validates and normalizes environment variables before Nest creates application providers. */
export function validateEnvironment(input: Record<string, unknown>): EnvironmentVariables {
	const nodeEnvironment = parseNodeEnvironment(input.NODE_ENV);
	const host = input.HOST;
	if (host !== undefined && (typeof host !== 'string' || host.trim() === '')) {
		throw new Error('HOST must be a non-empty string.');
	}

	return Object.freeze({
		NODE_ENV: nodeEnvironment,
		HOST: typeof host === 'string' ? host : '127.0.0.1',
		PORT: parseInteger(input.PORT, 'PORT', DEFAULT_PORT, 1, 65_535),
		CORS_ORIGINS: parseOrigins(input.CORS_ORIGINS, nodeEnvironment),
		SWAGGER_ENABLED: parseBoolean(
			input.SWAGGER_ENABLED,
			'SWAGGER_ENABLED',
			nodeEnvironment !== 'production',
		),
		RATE_LIMIT_TTL_MS: parseInteger(
			input.RATE_LIMIT_TTL_MS,
			'RATE_LIMIT_TTL_MS',
			DEFAULT_RATE_LIMIT_TTL_MS,
			1_000,
			3_600_000,
		),
		RATE_LIMIT_LIMIT: parseInteger(
			input.RATE_LIMIT_LIMIT,
			'RATE_LIMIT_LIMIT',
			DEFAULT_RATE_LIMIT_LIMIT,
			1,
			100_000,
		),
	});
}
