export const PLATFORM_OWNER_ROLE = Object.freeze({
	key: 'platform.owner',
	name: 'Platform owner',
	description: 'Initial NEXCODE platform owner with explicitly reviewed permissions.',
});

export const PLATFORM_OWNER_PERMISSIONS = Object.freeze([
	Object.freeze({
		key: 'platform.dashboard.read',
		description: 'View the NEXCODE platform administration dashboard.',
	}),
]);

export const PLATFORM_OWNER_BOOTSTRAP_LOCK_ID = 5_644_759_676_398_721_837n;
export const PLATFORM_OWNER_RECOVERY_CODE_COUNT = 10;
export const PLATFORM_OWNER_RECOVERY_CODE_BYTES = 16;

