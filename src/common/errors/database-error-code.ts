/** Allow only Prisma's machine-code shape; never include messages, SQL or provider metadata. */
export function databaseErrorCode(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
	return typeof error.code === 'string' && /^P\d{4}$/u.test(error.code) ? error.code : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Classify Prisma transaction failures without returning the underlying private message. */
export function databaseTransactionFailure(error: unknown): string | undefined {
	if (databaseErrorCode(error) !== 'P2028' || !isRecord(error)) {
		return undefined;
	}
	// Prisma's JS engine places transaction text in message; engine variants may use meta.error.
	const details = [isRecord(error.meta) ? error.meta.error : undefined, error.message];
	for (const detail of details) {
		if (typeof detail !== 'string') continue;
		if (detail.includes('Unable to start a transaction in the given time.')) {
			return 'start_timeout';
		}
		if (
			/A (?:query|commit|rollback) cannot be executed on an expired transaction\./u.test(detail)
		) {
			return 'execution_timeout';
		}
		if (detail.includes('Transaction already closed:')) return 'already_closed';
		if (detail.includes('Transaction not found.')) return 'not_found';
	}
	return 'unknown';
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
