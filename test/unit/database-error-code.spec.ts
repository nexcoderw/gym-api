import { databaseErrorCode } from '../../src/common/errors/database-error-code.js';

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
});
