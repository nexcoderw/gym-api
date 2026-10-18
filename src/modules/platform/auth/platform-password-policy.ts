import { isUtf8 } from 'node:buffer';

import { maxLength, minLength } from 'class-validator';

export const MINIMUM_PASSWORD_CHARACTERS = 12;
export const MAXIMUM_PASSWORD_CHARACTERS = 1_024;
export const MAXIMUM_BOOTSTRAP_PASSWORD_BYTES = 1_024;

/** Future bootstrap credentials must pass the existing login DTO without changing their bytes. */
export function acceptsBootstrapPassword(password: Buffer, normalizedEmail: string): boolean {
	if (password.length > MAXIMUM_BOOTSTRAP_PASSWORD_BYTES || !isUtf8(password)) return false;
	const value = password.toString('utf8');
	if (
		!minLength(value, MINIMUM_PASSWORD_CHARACTERS) ||
		!maxLength(value, MAXIMUM_PASSWORD_CHARACTERS) ||
		value.toLowerCase().includes(normalizedEmail.toLowerCase())
	) {
		return false;
	}
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
	}
	return true;
}
