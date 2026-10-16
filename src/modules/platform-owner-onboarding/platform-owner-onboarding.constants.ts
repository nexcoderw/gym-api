import { PLATFORM_PERMISSION } from '../platform-auth/platform-permission.constants.js';

export const OWNER_INVITATION_PERMISSION = Object.freeze({
	invite: PLATFORM_PERMISSION.organizationOwnersInvite,
	read: PLATFORM_PERMISSION.organizationOwnersRead,
	revoke: PLATFORM_PERMISSION.organizationOwnersRevokeInvitation,
	send: PLATFORM_PERMISSION.organizationOwnersSendInvitation,
});

export const OWNER_INVITATION_TRANSACTION_OPTIONS = Object.freeze({
	maxWait: 5_000,
	timeout: 10_000,
});
