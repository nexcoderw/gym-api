export const OWNER_ENTITLEMENTS_METADATA = 'owner-auth:entitlements';

export const OWNER_ENTITLEMENT_ERROR = Object.freeze({
	declarationRequired: {
		code: 'ORGANIZATION_ENTITLEMENT_REQUIRED',
		message: 'This operation has no declared organization entitlement.',
	},
	organizationScopeRequired: {
		code: 'ORGANIZATION_SCOPE_REQUIRED',
		message: 'An active organization context is required.',
	},
	featureDisabled: {
		code: 'ORGANIZATION_FEATURE_DISABLED',
		message: 'This functionality is not available for this organization.',
	},
	unavailable: {
		code: 'ORGANIZATION_ENTITLEMENT_UNAVAILABLE',
		message: 'Organization access verification is temporarily unavailable.',
	},
} as const);
