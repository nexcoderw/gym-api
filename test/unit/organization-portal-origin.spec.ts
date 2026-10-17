import {
	isOrganizationPortalOrigin,
	parseOrganizationPortalOriginPolicy,
	organizationPortalOriginForSlug,
	organizationSlugFromPortalOrigin,
} from '../../src/config/organization-portal-origin.js';

describe('organization portal origin policy', () => {
	const productionPolicy = { fixedOrigin: null, baseDomain: 'mucyora.rw' };

	it.each(['soho', 'diamondgym', 'kigali-strength-club'])(
		'accepts one valid organization slug: %s',
		(slug) => {
			const origin = `https://${slug}.mucyora.rw`;
			expect(isOrganizationPortalOrigin(origin, productionPolicy)).toBe(true);
			expect(organizationSlugFromPortalOrigin(origin, productionPolicy)).toBe(slug);
			expect(organizationPortalOriginForSlug(slug, productionPolicy)).toBe(origin);
		},
	);

	it.each([
		'http://soho.mucyora.rw',
		'https://mucyora.rw',
		'https://admin.mucyora.rw',
		'https://api.mucyora.rw',
		'https://notify.mucyora.rw',
		'https://branch.soho.mucyora.rw',
		'https://soho.mucyora.rw.attacker.example',
		'https://soho.mucyora.rw:444',
		'https://soho.mucyora.rw/path',
	])('rejects an unsafe production origin: %s', (origin) => {
		expect(isOrganizationPortalOrigin(origin, productionPolicy)).toBe(false);
		expect(organizationSlugFromPortalOrigin(origin, productionPolicy)).toBeNull();
	});

	it('keeps local development on the configured exact origin', () => {
		const localPolicy = { fixedOrigin: 'http://localhost:4001', baseDomain: null };
		expect(isOrganizationPortalOrigin('http://localhost:4001', localPolicy)).toBe(true);
		expect(isOrganizationPortalOrigin('http://soho.localhost:4001', localPolicy)).toBe(false);
		expect(organizationPortalOriginForSlug('soho', localPolicy)).toBe(
			'http://localhost:4001',
		);
	});

	it('keeps fixed origins local and base-domain routing production-only', () => {
		expect(() =>
			parseOrganizationPortalOriginPolicy(
				{ ORGANIZATION_PORTAL_BASE_DOMAIN: 'example.com' },
				false,
			),
		).toThrow('production-only');
		expect(() =>
			parseOrganizationPortalOriginPolicy(
				{ ORGANIZATION_PORTAL_ORIGIN: 'https://soho.example.com' },
				true,
			),
		).toThrow('instead of a fixed portal origin');
	});
});
