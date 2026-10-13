import { Module } from '@nestjs/common';
import { ResendEmailService } from '../../infrastructure/email/resend-email.service.js';
import { PlatformEmailOtpService } from './platform-email-otp.service.js';

import { PlatformAuthController } from './platform-auth.controller.js';
import { PlatformCookieService } from './platform-cookie.service.js';
import { PlatformLoginAttemptService } from './platform-login-attempt.service.js';
import { PlatformLoginService } from './platform-login.service.js';
import { PlatformMfaService } from './platform-mfa.service.js';
import { PlatformOriginCsrfGuard } from './platform-origin-csrf.guard.js';
import { PlatformPasswordService } from './platform-password.service.js';
import { PlatformPermissionGuard } from './platform-permission.guard.js';
import { PlatformSessionGuard } from './platform-session.guard.js';
import { PlatformSessionService } from './platform-session.service.js';
import { PlatformTokenService } from './platform-token.service.js';
import { PlatformTotpService } from './platform-totp.service.js';

@Module({
	controllers: [PlatformAuthController],
	providers: [
		ResendEmailService,
		PlatformEmailOtpService,
		PlatformCookieService,
		PlatformLoginAttemptService,
		PlatformLoginService,
		PlatformMfaService,
		PlatformOriginCsrfGuard,
		PlatformPasswordService,
		PlatformPermissionGuard,
		PlatformSessionGuard,
		PlatformSessionService,
		PlatformTokenService,
		PlatformTotpService,
	],
	// Nest instantiates controller guards in the consuming feature's module context.
	exports: [
		PlatformCookieService,
		PlatformPermissionGuard,
		PlatformSessionGuard,
		PlatformSessionService,
		PlatformOriginCsrfGuard,
		PlatformTokenService,
	],
})
export class PlatformAuthModule {}
