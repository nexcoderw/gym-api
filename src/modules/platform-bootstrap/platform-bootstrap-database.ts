import { PLATFORM_OWNER_BOOTSTRAP_LOCK_ID } from './platform-bootstrap.constants.js';
import { PlatformBootstrapError } from './platform-bootstrap.types.js';

export interface BootstrapDatabaseTarget {
	readonly databaseName: string;
	readonly databaseRole: string;
	readonly databaseMarker: string;
}

interface BootstrapQueryClient {
	$queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/** A transaction lock returns a supported boolean rather than PostgreSQL's void type. */
export async function acquireBootstrapLock(transaction: BootstrapQueryClient): Promise<void> {
	const rows = await transaction.$queryRaw`
		SELECT pg_try_advisory_xact_lock(${PLATFORM_OWNER_BOOTSTRAP_LOCK_ID}::bigint) AS acquired
	`;
	const result: unknown = Array.isArray(rows) && rows.length === 1 ? rows[0] : undefined;
	if (
		typeof result !== 'object' ||
		result === null ||
		!('acquired' in result) ||
		result.acquired !== true
	) {
		throw new PlatformBootstrapError(
			'BOOTSTRAP_CONCURRENT_OPERATION',
			'Another bootstrap transaction holds the lock; review its outcome before retrying.',
		);
	}
}

/** Verify the actual backend and effective role in the same transaction as privileged writes. */
export async function verifyBootstrapDatabase(
	transaction: BootstrapQueryClient,
	target: BootstrapDatabaseTarget,
): Promise<void> {
	const rows: unknown = await transaction.$queryRaw`
		SELECT current_database()::text AS "databaseName",
			current_user::text AS "databaseRole", session_user::text AS "sessionRole",
			shobj_description(d.oid, 'pg_database') AS "databaseMarker",
			EXISTS (
				SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user, r.oid, 'MEMBER')
				AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
					OR r.rolbypassrls OR r.rolname IN
					('neon_superuser', 'pg_read_all_data', 'pg_write_all_data'))
			) AS "unsafeRole",
			(has_database_privilege(current_user, d.oid, 'CREATE') OR
				has_schema_privilege(current_user, 'public', 'CREATE')) AS "canCreate",
			(pg_has_role(current_user, d.datdba, 'MEMBER') OR EXISTS (
				SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
				AND pg_has_role(current_user, c.relowner, 'MEMBER')
			)) AS "ownsObjects"
		FROM pg_database d WHERE d.datname = current_database()
	`;
	const identity: unknown = Array.isArray(rows) && rows.length === 1 ? rows[0] : undefined;
	if (
		typeof identity !== 'object' ||
		identity === null ||
		!('databaseName' in identity) ||
		!('databaseRole' in identity) ||
		!('sessionRole' in identity) ||
		!('databaseMarker' in identity) ||
		!('unsafeRole' in identity) ||
		!('canCreate' in identity) ||
		!('ownsObjects' in identity) ||
		identity.databaseName !== target.databaseName ||
		identity.databaseRole !== target.databaseRole ||
		identity.sessionRole !== target.databaseRole ||
		identity.databaseMarker !== target.databaseMarker ||
		identity.unsafeRole !== false ||
		identity.canCreate !== false ||
		identity.ownsObjects !== false
	) {
		throw new PlatformBootstrapError(
			'BOOTSTRAP_UNSAFE_DATABASE',
			'The connected database identity or operator role does not match the approved target.',
		);
	}
}
