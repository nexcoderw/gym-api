import type { ValidationError } from '@nestjs/common';

import { createValidationException } from '../../src/common/pipes/validation-exception.factory';

describe('createValidationException', () => {
	it('returns stable flattened field errors', () => {
		const errors: ValidationError[] = [
			{
				property: 'profile',
				children: [
					{
						property: 'email',
						constraints: { isEmail: 'email must be an email' },
					},
				],
			},
		];

		expect(createValidationException(errors).getResponse()).toEqual({
			code: 'VALIDATION_FAILED',
			message: 'Request validation failed',
			details: [{ field: 'profile.email', message: 'email must be an email' }],
		});
	});
});
