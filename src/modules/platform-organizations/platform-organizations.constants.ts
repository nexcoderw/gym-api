import { PLATFORM_PERMISSION } from '../platform-auth/platform-permission.constants.js';

export const ORGANIZATION_PERMISSION = Object.freeze({
	create: PLATFORM_PERMISSION.organizationsCreate,
	read: PLATFORM_PERMISSION.organizationsRead,
	update: PLATFORM_PERMISSION.organizationsUpdate,
	activate: PLATFORM_PERMISSION.organizationsActivate,
	suspend: PLATFORM_PERMISSION.organizationsSuspend,
});

export const ORGANIZATION_RESERVED_SLUGS = Object.freeze([
	'admin',
	'api',
	'app',
	'www',
	'auth',
	'login',
	'member',
	'members',
	'portal',
	'dashboard',
	'billing',
	'support',
	'status',
	'static',
	'assets',
	'cdn',
	'mail',
	'dev',
	'staging',
	'test',
	'localhost',
	'account',
	'accounts',
	'oauth',
	'console',
	'internal',
	'health',
	'metrics',
	'production',
	'development',
	'bootstrap',
]);

export const ORGANIZATION_TRANSACTION_OPTIONS = Object.freeze({ maxWait: 5_000, timeout: 10_000 });
