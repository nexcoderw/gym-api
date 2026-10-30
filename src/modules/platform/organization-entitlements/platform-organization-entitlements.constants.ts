import { PLATFORM_PERMISSION } from '../auth/platform-permission.constants.js';

export const ORGANIZATION_ENTITLEMENT_PERMISSION = Object.freeze({
	read: PLATFORM_PERMISSION.organizationEntitlementsRead,
	manage: PLATFORM_PERMISSION.organizationEntitlementsManage,
});
