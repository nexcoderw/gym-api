import { BadRequestException, type ValidationError } from '@nestjs/common';

interface ValidationDetail {
	readonly field: string;
	readonly message: string;
}

function flattenErrors(errors: ValidationError[], parent = ''): ValidationDetail[] {
	return errors.flatMap((error) => {
		const field = parent === '' ? error.property : `${parent}.${error.property}`;
		const ownErrors = Object.values(error.constraints ?? {}).map((message) => ({ field, message }));
		return [...ownErrors, ...flattenErrors(error.children ?? [], field)];
	});
}

/** Produces the stable validation payload consumed by the global exception filter. */
export function createValidationException(errors: ValidationError[]): BadRequestException {
	return new BadRequestException({
		code: 'VALIDATION_FAILED',
		message: 'Request validation failed',
		details: flattenErrors(errors),
	});
}
