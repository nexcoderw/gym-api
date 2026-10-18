import { Module } from '@nestjs/common';

import { PlatformAuthModule } from '../../platform/auth/platform-auth.module.js';
import { OwnerAuthController } from './owner-auth.controller.js';
import { OwnerCookieService } from './owner-cookie.service.js';
import { OwnerLoginAttemptService } from './owner-login-attempt.service.js';
import { OwnerLoginService } from './owner-login.service.js';
import { OwnerOriginCsrfGuard } from './owner-origin-csrf.guard.js';
import { OwnerSessionGuard } from './owner-session.guard.js';
import { OwnerSessionService } from './owner-session.service.js';
import { OwnerTokenService } from './owner-token.service.js';

@Module({
	imports: [PlatformAuthModule],
	controllers: [OwnerAuthController],
	providers: [
		OwnerCookieService,
		OwnerLoginAttemptService,
		OwnerLoginService,
		OwnerOriginCsrfGuard,
		OwnerSessionGuard,
		OwnerSessionService,
		OwnerTokenService,
	],
	exports: [
		OwnerCookieService,
		OwnerOriginCsrfGuard,
		OwnerSessionGuard,
		OwnerSessionService,
		OwnerTokenService,
	],
})
export class OwnerAuthModule {}
