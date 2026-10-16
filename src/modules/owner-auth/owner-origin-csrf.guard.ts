import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import type { EnvironmentVariables } from '../../config/environment.types.js';
import { OWNER_CSRF_HEADER, OWNER_CSRF_REQUIRED_METADATA } from './owner-auth.constants.js';
import { OwnerCookieService } from './owner-cookie.service.js';
import type { OwnerRequest } from './owner-request.js';
import { OwnerTokenService } from './owner-token.service.js';

@Injectable()
export class OwnerOriginCsrfGuard implements CanActivate {
	private readonly allowedOrigin: string;

	constructor(
		config: ConfigService<EnvironmentVariables, true>,
		private readonly reflector: Reflector,
		private readonly cookies: OwnerCookieService,
		private readonly tokens: OwnerTokenService,
	) {
		this.allowedOrigin = config.get('ORGANIZATION_PORTAL_ORIGIN', { infer: true });
	}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<OwnerRequest>();
		if (request.headers.origin !== this.allowedOrigin) {
			throw new ForbiddenException({
				code: 'OWNER_ORIGIN_REJECTED',
				message: 'The request origin is not allowed',
			});
		}
		const required = this.reflector.getAllAndOverride<boolean>(OWNER_CSRF_REQUIRED_METADATA, [
			context.getHandler(),
			context.getClass(),
		]);
		if (!required) return true;

		const cookieToken = this.cookies.readCsrf(request);
		const header = request.headers[OWNER_CSRF_HEADER];
		const headerToken = Array.isArray(header) ? undefined : header;
		if (
			cookieToken === undefined ||
			headerToken === undefined ||
			!this.tokens.equal(cookieToken, headerToken)
		) {
			throw new ForbiddenException({
				code: 'OWNER_CSRF_REJECTED',
				message: 'The CSRF token is missing or invalid',
			});
		}
		return true;
	}
}
