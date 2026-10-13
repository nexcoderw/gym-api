import { Module } from '@nestjs/common';

import { PlatformPasswordService } from '../platform-auth/platform-password.service.js';
import { PlatformTokenService } from '../platform-auth/platform-token.service.js';
import { PlatformTotpService } from '../platform-auth/platform-totp.service.js';
import { PlatformOwnerBootstrapService } from './platform-owner-bootstrap.service.js';

@Module({
	providers: [
		PlatformOwnerBootstrapService,
		PlatformPasswordService,
		PlatformTokenService,
		PlatformTotpService,
	],
	exports: [PlatformOwnerBootstrapService],
})
export class PlatformBootstrapModule {}
