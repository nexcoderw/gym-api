import { SetMetadata } from '@nestjs/common';

import { PLATFORM_PERMISSIONS_METADATA } from './platform-auth.constants.js';

/** Declares every platform permission required by a guarded operation. */
export const RequirePlatformPermissions = (...permissions: readonly string[]): MethodDecorator =>
	SetMetadata(PLATFORM_PERMISSIONS_METADATA, permissions);
