import {
	databaseErrorCode,
	databaseSqlState,
} from '../../src/common/errors/database-error-code.js';

describe('safe database diagnostics', () => {
	it('exposes only the machine code, never messages or metadata', () => {
		expect(
			databaseErrorCode({ code: 'P2028', message: 'private SQL', meta: { secret: 'private' } }),
		).toBe('P2028');
	});
	it.each([null, undefined, 'P2028', { code: 'private-secret' }, { code: 2028 }, {}])(
		'rejects unsafe diagnostic values: %p',
		(error) => {
			expect(databaseErrorCode(error)).toBeUndefined();
		},
	);
	it.each(['42501', '42P01', '40001', '25P02'])(
		'extracts only adapter SQLSTATE %s from private provider metadata',
		(code) => {
			expect(
				databaseSqlState({
					code: 'P2039',
					meta: {
						driverAdapterError: {
							cause: { originalCode: code, originalMessage: 'private SQL and credentials' },
						},
					},
				}),
			).toBe(code);
		},
	);
	it.each([null, {}, { meta: null }, { meta: { driverAdapterError: null } }])(
		'rejects malformed SQLSTATE containers: %p',
		(error) => {
			expect(databaseSqlState(error)).toBeUndefined();
		},
	);
	it.each(['private-secret', '42501\n', '42501 password', 'p2039', 42501, null])(
		'rejects unsafe SQLSTATE values: %p',
		(originalCode) => {
			expect(
				databaseSqlState({ meta: { driverAdapterError: { cause: { originalCode } } } }),
			).toBeUndefined();
		},
	);
});
