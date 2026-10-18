import { Module } from '@nestjs/common';

import { PlatformPasswordService } from '../auth/platform-password.service.js';
import { PlatformTokenService } from '../auth/platform-token.service.js';
import { PlatformTotpService } from '../auth/platform-totp.service.js';
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
