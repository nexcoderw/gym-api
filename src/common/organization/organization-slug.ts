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
	'notify',
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

const ORGANIZATION_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function isOrganizationSlug(value: string): boolean {
	return (
		value.length >= 3 &&
		value.length <= 63 &&
		ORGANIZATION_SLUG_PATTERN.test(value) &&
		!ORGANIZATION_RESERVED_SLUGS.includes(value)
	);
}
