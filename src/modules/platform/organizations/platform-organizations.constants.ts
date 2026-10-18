import { PLATFORM_PERMISSION } from '../auth/platform-permission.constants.js';

export { ORGANIZATION_RESERVED_SLUGS } from '../../../common/organization/organization-slug.js';

export const ORGANIZATION_PERMISSION = Object.freeze({
	create: PLATFORM_PERMISSION.organizationsCreate,
	read: PLATFORM_PERMISSION.organizationsRead,
	update: PLATFORM_PERMISSION.organizationsUpdate,
	activate: PLATFORM_PERMISSION.organizationsActivate,
	suspend: PLATFORM_PERMISSION.organizationsSuspend,
	archive: PLATFORM_PERMISSION.organizationsArchive,
});

export const ORGANIZATION_TRANSACTION_OPTIONS = Object.freeze({ maxWait: 5_000, timeout: 10_000 });
