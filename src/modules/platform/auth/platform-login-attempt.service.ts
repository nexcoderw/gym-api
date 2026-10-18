import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../../../config/environment.types.js';
import { PlatformTokenService } from './platform-token.service.js';

interface AttemptWindow {
	count: number;
	expiresAt: number;
}

const MAXIMUM_TRACKED_KEYS = 10_000;

/** Single-process login limiter; production validation forbids a multi-replica deployment. */
@Injectable()
export class PlatformLoginAttemptService {
	private readonly attempts = new Map<string, AttemptWindow>();
	private readonly windowMilliseconds: number;
	private readonly limit: number;

	constructor(
		config: ConfigService<EnvironmentVariables, true>,
		private readonly tokens: PlatformTokenService,
	) {
		this.windowMilliseconds = config.get('PLATFORM_AUTH_LOGIN_ATTEMPT_WINDOW_MS', {
			infer: true,
		});
		this.limit = config.get('PLATFORM_AUTH_LOGIN_ATTEMPT_LIMIT', { infer: true });
	}

	assertAllowed(ipAddress: string, normalizedEmail: string, now = Date.now()): void {
		const keys = [this.key('ip', ipAddress), this.key('account', normalizedEmail)];
		for (const key of keys) {
			const window = this.attempts.get(key);
			if (window !== undefined && window.expiresAt > now && window.count >= this.limit) {
				throw new HttpException(
					{
						code: 'PLATFORM_LOGIN_RATE_LIMITED',
						message: 'Too many authentication attempts; try again later',
					},
					HttpStatus.TOO_MANY_REQUESTS,
				);
			}
		}
	}

	recordFailure(ipAddress: string, normalizedEmail: string, now = Date.now()): void {
		this.prune(now);
		for (const key of [this.key('ip', ipAddress), this.key('account', normalizedEmail)]) {
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

	private key(scope: string, value: string): string {
		return `${scope}:${this.tokens.digest(value)}`;
	}

	private prune(now: number): void {
		for (const [key, window] of this.attempts) {
			if (window.expiresAt <= now || this.attempts.size > MAXIMUM_TRACKED_KEYS) {
				this.attempts.delete(key);
			}
		}
	}
}
