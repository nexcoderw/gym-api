import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../../../config/environment.types.js';
import { OwnerTokenService } from './owner-token.service.js';

interface AttemptWindow {
	count: number;
	expiresAt: number;
}

const MAXIMUM_TRACKED_KEYS = 10_000;

@Injectable()
export class OwnerLoginAttemptService {
	private readonly attempts = new Map<string, AttemptWindow>();
	private readonly windowMilliseconds: number;
	private readonly limit: number;

	constructor(
		config: ConfigService<EnvironmentVariables, true>,
		private readonly tokens: OwnerTokenService,
	) {
		this.windowMilliseconds = config.get('OWNER_AUTH_LOGIN_ATTEMPT_WINDOW_MS', { infer: true });
		this.limit = config.get('OWNER_AUTH_LOGIN_ATTEMPT_LIMIT', { infer: true });
	}

	assertAllowed(ipAddress: string, normalizedEmail: string, now = Date.now()): void {
		for (const key of this.keys(ipAddress, normalizedEmail)) {
			const window = this.attempts.get(key);
			if (window !== undefined && window.expiresAt > now && window.count >= this.limit) {
				throw new HttpException(
					{
						code: 'OWNER_LOGIN_RATE_LIMITED',
						message: 'Too many authentication attempts; try again later',
					},
					HttpStatus.TOO_MANY_REQUESTS,
				);
			}
		}
	}

	recordFailure(ipAddress: string, normalizedEmail: string, now = Date.now()): void {
		this.prune(now);
		for (const key of this.keys(ipAddress, normalizedEmail)) {
			const current = this.attempts.get(key);
			this.attempts.set(key, {
				count: current === undefined || current.expiresAt <= now ? 1 : current.count + 1,
				expiresAt:
					current === undefined || current.expiresAt <= now
						? now + this.windowMilliseconds
						: current.expiresAt,
			});
		}
	}

	clearAccount(normalizedEmail: string): void {
		this.attempts.delete(this.key('account', normalizedEmail));
	}

	private keys(ipAddress: string, normalizedEmail: string): string[] {
		return [this.key('ip', ipAddress), this.key('account', normalizedEmail)];
	}

	private key(scope: string, value: string): string {
		return `${scope}:${this.tokens.rateLimitDigest(value)}`;
	}

	private prune(now: number): void {
		for (const [key, window] of this.attempts) {
			if (window.expiresAt <= now || this.attempts.size > MAXIMUM_TRACKED_KEYS) {
				this.attempts.delete(key);
			}
		}
	}
}
