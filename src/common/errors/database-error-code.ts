/** Allow only Prisma's machine-code shape; never include messages, SQL or provider metadata. */
export function databaseErrorCode(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
	return typeof error.code === 'string' && /^P\d{4}$/u.test(error.code)
		? error.code
		: undefined;
}
