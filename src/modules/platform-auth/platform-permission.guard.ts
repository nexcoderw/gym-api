import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PLATFORM_PERMISSIONS_METADATA } from './platform-auth.constants.js';
import type { PlatformRequest } from './platform-request.js';

@Injectable()
export class PlatformPermissionGuard implements CanActivate {
	constructor(private readonly reflector: Reflector) {}

	canActivate(context: ExecutionContext): boolean {
		const required = this.reflector.getAllAndOverride<readonly string[]>(
			PLATFORM_PERMISSIONS_METADATA,
			[context.getHandler(), context.getClass()],
		);
		if (required === undefined || required.length === 0) {
			throw new ForbiddenException({
				code: 'PLATFORM_PERMISSION_REQUIRED',
				message: 'This operation has no declared platform permission',
			});
		}
		const principal = context.switchToHttp().getRequest<PlatformRequest>().platformPrincipal;
		if (
			principal === undefined ||
			!required.every((permission) => principal.permissions.includes(permission))
		) {
			throw new ForbiddenException({
				code: 'PLATFORM_PERMISSION_DENIED',
				message: 'The platform session lacks a required permission',
			});
		}
		return true;
	}
}
