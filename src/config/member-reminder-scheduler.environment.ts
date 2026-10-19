import { loadDatabaseConfig } from '@nexcoderw/gym-db';

export interface MemberReminderSchedulerEnvironment {
	readonly NODE_ENV: 'development' | 'test' | 'production';
	readonly DATABASE_URL: string;
	readonly DATABASE_POOL_MAX: number;
	readonly DATABASE_CONNECTION_TIMEOUT_MS: number;
	readonly MEMBER_REMINDER_SCHEDULER_ENABLED: true;
}

/** The scheduler has no HTTP, authentication or email-provider configuration. */
export function validateMemberReminderSchedulerEnvironment(
	input: Record<string, unknown>,
): MemberReminderSchedulerEnvironment {
	const mode = input.NODE_ENV;
	if (mode !== 'development' && mode !== 'test' && mode !== 'production') {
		throw new Error('NODE_ENV must be explicitly set for the member reminder scheduler.');
	}
	if (input.MEMBER_REMINDER_SCHEDULER_ENABLED !== 'true') {
		throw new Error('The member reminder scheduler must be explicitly enabled.');
	}
	const databaseUrl = input.DATABASE_URL;
	if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
		throw new Error('DATABASE_URL is required for the member reminder scheduler.');
	}
	const database = loadDatabaseConfig({
		DATABASE_URL: databaseUrl,
		DATABASE_POOL_MAX: optional(input.DATABASE_POOL_MAX),
		DATABASE_CONNECTION_TIMEOUT_MS: optional(input.DATABASE_CONNECTION_TIMEOUT_MS),
	});
	const url = new URL(database.databaseUrl);
	if (
		['neondb_owner', 'postgres', 'gym_migrator'].includes(decodeURIComponent(url.username)) ||
		database.poolMax > 16 ||
		database.connectionTimeoutMilliseconds < 1000 ||
		database.connectionTimeoutMilliseconds > 60_000
	) {
		throw new Error('The scheduler requires restricted, bounded database configuration.');
	}
	if (
		mode === 'production' &&
		!['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')
	) {
		throw new Error('The scheduler requires production database TLS.');
	}
	return Object.freeze({
		NODE_ENV: mode,
		DATABASE_URL: database.databaseUrl,
		DATABASE_POOL_MAX: database.poolMax,
		DATABASE_CONNECTION_TIMEOUT_MS: database.connectionTimeoutMilliseconds,
		MEMBER_REMINDER_SCHEDULER_ENABLED: true,
	});
}

function optional(value: unknown): string | undefined {
	if (value === undefined || value === '') return undefined;
	if (typeof value !== 'string') throw new Error('Scheduler database settings must be strings.');
	return value;
}
