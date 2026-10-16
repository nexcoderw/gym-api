export interface OwnerInvitationDeliveryEnvironment {
	readonly acceptanceOrigin: string;
	readonly acceptancePath: string;
	readonly acceptanceReviewId: string;
	readonly hmacSecret: string;
	readonly encryptionKeys: Readonly<Record<string, string>>;
	readonly activeKeyId: string;
	readonly expirySeconds: number;
	readonly leaseSeconds: number;
	readonly maxAttempts: number;
	readonly concurrency: number;
}

/** Separate operator attestations do not replace the worker's database preflight or release review. */
export function parseOwnerInvitationDeliveryEnvironment(
	input: Record<string, unknown>,
	production: boolean,
): OwnerInvitationDeliveryEnvironment | null {
	const flag = input.OWNER_INVITATION_DELIVERY_ENABLED;
	if (flag === undefined || flag === '' || flag === 'false' || flag === false) return null;
	if (flag !== 'true' && flag !== true) {
		throw new Error('OWNER_INVITATION_DELIVERY_ENABLED must be true or false.');
	}
	if (
		input.OWNER_INVITATION_DELIVERY_DATABASE_APPROVED !== 'true' &&
		input.OWNER_INVITATION_DELIVERY_DATABASE_APPROVED !== true
	) {
		throw new Error('Owner invitation database repair and grants require independent approval.');
	}
	const acceptanceReviewId = required(input, 'OWNER_INVITATION_ACCEPTANCE_REVIEW_ID');
	if (!/^[A-Za-z0-9._:-]{8,120}$/u.test(acceptanceReviewId)) {
		throw new Error('OWNER_INVITATION_ACCEPTANCE_REVIEW_ID must identify a completed review.');
	}
	const acceptanceOrigin = required(input, 'OWNER_INVITATION_ACCEPTANCE_ORIGIN');
	let origin: URL;
	try {
		origin = new URL(acceptanceOrigin);
	} catch {
		throw new Error('OWNER_INVITATION_ACCEPTANCE_ORIGIN must be an exact origin.');
	}
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
	if (
		origin.origin !== acceptanceOrigin || acceptanceOrigin.length > 253 || origin.hostname.includes('*') ||
		origin.username !== '' || origin.password !== '' ||
		(origin.protocol !== 'https:' && !(local && !production && origin.protocol === 'http:')) ||
		(production && (local || origin.hostname.endsWith('.invalid') || origin.hostname.endsWith('.test')))
	) {
		throw new Error('Owner acceptance requires an approved exact HTTPS origin (localhost in development only).');
	}
	const acceptancePath = required(input, 'OWNER_INVITATION_ACCEPTANCE_PATH');
	if (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/u.test(acceptancePath) || acceptancePath.length > 120) {
		throw new Error('OWNER_INVITATION_ACCEPTANCE_PATH must be a fixed path without a query or fragment.');
	}
	const hmacSecret = key(required(input, 'OWNER_INVITATION_TOKEN_HMAC_SECRET'));
	const entries = required(input, 'OWNER_INVITATION_ENCRYPTION_KEYRING').split(',');
	const keys = new Map<string, string>();
	if (entries.length > 4) throw new Error('Owner invitation keyring supports at most four keys.');
	for (const entry of entries) {
		const separator = entry.indexOf('=');
		const id = entry.slice(0, separator);
		if (separator < 1 || !/^[A-Za-z0-9._:-]{1,120}$/u.test(id) || keys.has(id)) {
			throw new Error('Owner invitation keyring contains an invalid or duplicate key ID.');
		}
		const secret = key(entry.slice(separator + 1));
		if (secret === hmacSecret || secret === input.PLATFORM_AUTH_TOKEN_PEPPER) {
			throw new Error('Invitation encryption keys must be separate from token signing secrets.');
		}
		keys.set(id, secret);
	}
	if (hmacSecret === input.PLATFORM_AUTH_TOKEN_PEPPER) {
		throw new Error('Invitation signing must use a separately managed secret.');
	}
	const activeKeyId = required(input, 'OWNER_INVITATION_ENCRYPTION_ACTIVE_KEY_ID');
	if (!keys.has(activeKeyId)) throw new Error('Owner invitation active encryption key is missing.');
	if (production && [...keys.keys()].some((id) => /^(?:local|test|dev)(?:[._:-]|$)/iu.test(id))) {
		throw new Error('Development invitation encryption keys are forbidden in production.');
	}
	return Object.freeze({
		acceptanceOrigin, acceptancePath, acceptanceReviewId, hmacSecret,
		encryptionKeys: Object.freeze(Object.fromEntries(keys)), activeKeyId,
		expirySeconds: integer(input, 'OWNER_INVITATION_EXPIRY_SECONDS', 86_400, 300, 604_800),
		leaseSeconds: integer(input, 'OWNER_INVITATION_DELIVERY_LEASE_SECONDS', 60, 30, 120),
		maxAttempts: integer(input, 'OWNER_INVITATION_DELIVERY_MAX_ATTEMPTS', 3, 1, 10),
		concurrency: integer(input, 'OWNER_INVITATION_DELIVERY_CONCURRENCY', 1, 1, 4),
	});
}

function required(input: Record<string, unknown>, name: string): string {
	const value = input[name];
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
		throw new Error(`${name} is required for owner invitation delivery.`);
	}
	return value;
}

function key(value: string): string {
	const bytes = Buffer.from(value, 'base64');
	if (bytes.length !== 32 || bytes.toString('base64') !== value || new Set(bytes).size < 16) {
		throw new Error('Owner invitation keys must be independently generated 256-bit base64 secrets.');
	}
	return value;
}

function integer(
	input: Record<string, unknown>, name: string, fallback: number, minimum: number, maximum: number,
): number {
	const value = input[name];
	if (value === undefined || value === '') return fallback;
	if (typeof value !== 'string' || !/^\d+$/u.test(value)) throw new Error(`${name} must be an integer.`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(`${name} is outside its supported range.`);
	}
	return parsed;
}
