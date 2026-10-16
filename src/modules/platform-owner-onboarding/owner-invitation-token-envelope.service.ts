import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../../config/environment.types.js';
import { OWNER_INVITATION_TOKEN_PURPOSE } from './owner-invitation-token.service.js';

export interface InvitationEnvelopeIdentity {
	readonly id: string;
	readonly organizationId: string;
	readonly ownerInvitationId: string;
}

/** Freeze the complete provider payload, not mutable branding, for safe idempotent retries. */
export interface InvitationEmailSnapshot {
	readonly token: string;
	readonly organizationName: string;
	readonly recipient: string;
	readonly sender: string;
	readonly acceptanceOrigin: string;
	readonly acceptancePath: string;
}

export interface InvitationTokenEnvelope {
	readonly tokenCiphertext: Uint8Array<ArrayBuffer>;
	readonly tokenInitializationVector: Uint8Array<ArrayBuffer>;
	readonly tokenAuthenticationTag: Uint8Array<ArrayBuffer>;
	readonly tokenEncryptionKeyId: string;
	readonly tokenEncryptionVersion: number;
}

@Injectable()
export class OwnerInvitationTokenEnvelopeService {
	constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

	encrypt(
		identity: InvitationEnvelopeIdentity,
		snapshot: InvitationEmailSnapshot,
	): InvitationTokenEnvelope {
		const settings = this.settings();
		const secret = settings.encryptionKeys[settings.activeKeyId];
		if (secret === undefined) throw new Error('Invitation encryption unavailable.');
		const plaintext = Buffer.from(JSON.stringify(snapshot));
		if (plaintext.length < 32 || plaintext.length > 4096)
			throw new Error('Invitation envelope bounds exceeded.');
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', Buffer.from(secret, 'base64'), iv);
		cipher.setAAD(associatedData(identity));
		try {
			return {
				tokenCiphertext: new Uint8Array(Buffer.concat([cipher.update(plaintext), cipher.final()])),
				tokenInitializationVector: new Uint8Array(iv),
				tokenAuthenticationTag: new Uint8Array(cipher.getAuthTag()),
				tokenEncryptionKeyId: settings.activeKeyId,
				tokenEncryptionVersion: 1,
			};
		} finally {
			plaintext.fill(0);
		}
	}

	/** Only the explicitly started delivery worker consumes plaintext envelopes. */
	decrypt(
		identity: InvitationEnvelopeIdentity,
		envelope: InvitationTokenEnvelope,
	): InvitationEmailSnapshot {
		try {
			const secret = this.settings().encryptionKeys[envelope.tokenEncryptionKeyId];
			if (
				secret === undefined ||
				envelope.tokenEncryptionVersion !== 1 ||
				envelope.tokenInitializationVector.length !== 12 ||
				envelope.tokenAuthenticationTag.length !== 16 ||
				envelope.tokenCiphertext.length < 32 ||
				envelope.tokenCiphertext.length > 4096
			) {
				throw new Error('Invalid envelope.');
			}
			const decipher = createDecipheriv(
				'aes-256-gcm',
				Buffer.from(secret, 'base64'),
				envelope.tokenInitializationVector,
			);
			decipher.setAAD(associatedData(identity));
			decipher.setAuthTag(envelope.tokenAuthenticationTag);
			const value: unknown = JSON.parse(
				Buffer.concat([decipher.update(envelope.tokenCiphertext), decipher.final()]).toString(
					'utf8',
				),
			);
			if (!isSnapshot(value)) throw new Error('Invalid snapshot.');
			return value;
		} catch {
			throw new Error('Invitation envelope could not be opened.');
		}
	}

	private settings() {
		const settings = this.config.get('OWNER_INVITATION_DELIVERY', { infer: true });
		if (settings === null) throw new Error('Invitation encryption unavailable.');
		return settings;
	}
}

function associatedData(identity: InvitationEnvelopeIdentity): Buffer {
	return Buffer.from(
		JSON.stringify([
			OWNER_INVITATION_TOKEN_PURPOSE,
			1,
			identity.id,
			identity.organizationId,
			identity.ownerInvitationId,
		]),
	);
}

function isSnapshot(value: unknown): value is InvitationEmailSnapshot {
	return (
		typeof value === 'object' &&
		value !== null &&
		'token' in value &&
		typeof value.token === 'string' &&
		/^[A-Za-z0-9_-]{43}$/u.test(value.token) &&
		'organizationName' in value &&
		typeof value.organizationName === 'string' &&
		value.organizationName.length <= 160 &&
		'recipient' in value &&
		typeof value.recipient === 'string' &&
		value.recipient.length <= 254 &&
		'sender' in value &&
		typeof value.sender === 'string' &&
		value.sender.length <= 254 &&
		'acceptanceOrigin' in value &&
		typeof value.acceptanceOrigin === 'string' &&
		value.acceptanceOrigin.length <= 253 &&
		'acceptancePath' in value &&
		typeof value.acceptancePath === 'string' &&
		value.acceptancePath.length <= 120
	);
}
