import { createDecipheriv } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as OTPAuth from 'otpauth';

import type { EnvironmentVariables } from '../../config/environment.types.js';
import type { AcceptedTotp } from './platform-auth.types.js';

const TOTP_PERIOD_SECONDS = 30;

export interface EncryptedTotpSecret {
	readonly platformStaffId: string;
	readonly encryptedSecret: Uint8Array;
	readonly initializationVector: Uint8Array;
	readonly authenticationTag: Uint8Array;
	readonly encryptionKeyId: string;
	readonly encryptionVersion: number;
}

@Injectable()
export class PlatformTotpService {
	private readonly keyring: Readonly<Record<string, string>>;

	constructor(config: ConfigService<EnvironmentVariables, true>) {
		this.keyring = config.get('PLATFORM_TOTP_KEYRING', { infer: true });
	}

	verify(credential: EncryptedTotpSecret, token: string, now: Date): AcceptedTotp | null {
		const key = this.keyring[credential.encryptionKeyId];
		if (key === undefined || credential.encryptionVersion !== 1) {
			return null;
		}

		let secretBuffer: Buffer | undefined;
		try {
			const decipher = createDecipheriv(
				'aes-256-gcm',
				Buffer.from(key, 'base64'),
				credential.initializationVector,
			);
			decipher.setAAD(
				Buffer.from(
					`${credential.platformStaffId}:${credential.encryptionKeyId}:${String(credential.encryptionVersion)}`,
					'utf8',
				),
			);
			decipher.setAuthTag(Buffer.from(credential.authenticationTag));
			secretBuffer = Buffer.concat([
				decipher.update(Buffer.from(credential.encryptedSecret)),
				decipher.final(),
			]);
			const secret = secretBuffer.toString('utf8');
			if (!/^[A-Z2-7]{16,128}$/u.test(secret)) {
				return null;
			}
			const totp = new OTPAuth.TOTP({
				algorithm: 'SHA1',
				digits: 6,
				period: TOTP_PERIOD_SECONDS,
				secret: OTPAuth.Secret.fromBase32(secret),
			});
			const delta = totp.validate({ token, timestamp: now.getTime(), window: 1 });
			if (delta === null) {
				return null;
			}
			return {
				timeStep: BigInt(Math.floor(now.getTime() / (TOTP_PERIOD_SECONDS * 1000)) + delta),
			};
		} catch {
			return null;
		} finally {
			secretBuffer?.fill(0);
		}
	}
}
