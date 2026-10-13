/** Allow only Prisma's machine-code shape; never include messages, SQL or provider metadata. */
export function databaseErrorCode(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
	return typeof error.code === 'string' && /^P\d{4}$/u.test(error.code) ? error.code : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extract only PostgreSQL's bounded SQLSTATE; never parse or log rendered provider messages. */
export function databaseSqlState(error: unknown): string | undefined {
	if (!isRecord(error) || !isRecord(error.meta)) return undefined;
	const adapter = error.meta.driverAdapterError;
	if (!isRecord(adapter) || !isRecord(adapter.cause)) return undefined;
	const code = adapter.cause.originalCode;
	return typeof code === 'string' && code.length === 5 && /^[0-9A-Z]{5}$/u.test(code)
		? code
		: undefined;
}
