export const OWNER_SESSION_COOKIE = '__Host-nexcode-owner-session';
export const LOCAL_OWNER_SESSION_COOKIE = 'nexcode-owner-session';
export const OWNER_CSRF_COOKIE = '__Host-nexcode-owner-csrf';
export const LOCAL_OWNER_CSRF_COOKIE = 'nexcode-owner-csrf';
export const OWNER_CSRF_HEADER = 'x-owner-csrf-token';
export const OWNER_CSRF_REQUIRED_METADATA = 'owner-auth:csrf-required';

export const OWNER_AUTH_ERROR = Object.freeze({
	invalidCredentials: {
		code: 'OWNER_AUTHENTICATION_FAILED',
		message: 'The supplied authentication credentials are invalid',
	},
	invalidSession: {
		code: 'OWNER_SESSION_INVALID',
		message: 'The owner session is invalid or expired',
	},
} as const);
