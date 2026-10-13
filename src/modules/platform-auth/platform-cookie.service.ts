import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parse } from 'cookie';
import type { Request, Response } from 'express';

import type { EnvironmentVariables } from '../../config/environment.types.js';
import {
	LOCAL_PLATFORM_CSRF_COOKIE,
	LOCAL_PLATFORM_SESSION_COOKIE,
	PLATFORM_CSRF_COOKIE,
	PLATFORM_SESSION_COOKIE,
} from './platform-auth.constants.js';

@Injectable()
export class PlatformCookieService {
	private readonly secure: boolean;
	private readonly sessionCookieName: string;
	private readonly csrfCookieName: string;

	constructor(config: ConfigService<EnvironmentVariables, true>) {
		this.secure = config.get('PLATFORM_AUTH_COOKIE_SECURE', { infer: true });
		this.sessionCookieName = this.secure
			? PLATFORM_SESSION_COOKIE
			: LOCAL_PLATFORM_SESSION_COOKIE;
		this.csrfCookieName = this.secure ? PLATFORM_CSRF_COOKIE : LOCAL_PLATFORM_CSRF_COOKIE;
	}

	readSession(request: Request): string | undefined {
		return this.readCookie(request, this.sessionCookieName);
	}

	readCsrf(request: Request): string | undefined {
		return this.readCookie(request, this.csrfCookieName);
	}

	setSession(response: Response, token: string, expiresAt: Date): void {
		response.cookie(this.sessionCookieName, token, {
			expires: expiresAt,
			httpOnly: true,
			path: '/',
			sameSite: 'strict',
			secure: this.secure,
		});
	}

	setCsrf(response: Response, token: string, expiresAt: Date): void {
		response.cookie(this.csrfCookieName, token, {
			expires: expiresAt,
			httpOnly: false,
			path: '/',
			sameSite: 'strict',
			secure: this.secure,
		});
	}

	clearSession(response: Response): void {
		response.clearCookie(this.sessionCookieName, {
			httpOnly: true,
			path: '/',
			sameSite: 'strict',
			secure: this.secure,
		});
	}

	private readCookie(request: Request, name: string): string | undefined {
		const header = request.headers.cookie;
		if (header === undefined) {
			return undefined;
		}
		return parse(header)[name];
	}
}
