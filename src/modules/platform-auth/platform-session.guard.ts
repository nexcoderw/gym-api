import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { PLATFORM_AUTH_ERROR } from './platform-auth.constants.js';
import { PlatformCookieService } from './platform-cookie.service.js';
import type { PlatformRequest } from './platform-request.js';
import { PlatformSessionService } from './platform-session.service.js';

@Injectable()
export class PlatformSessionGuard implements CanActivate {
	constructor(
		private readonly cookies: PlatformCookieService,
		private readonly sessions: PlatformSessionService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<PlatformRequest>();
		const token = this.cookies.readSession(request);
		if (token === undefined || token.length < 32 || token.length > 256) {
			throw new UnauthorizedException(PLATFORM_AUTH_ERROR.invalidSession);
		}
		request.platformPrincipal = await this.sessions.authenticate(token);
		return true;
	}
}
