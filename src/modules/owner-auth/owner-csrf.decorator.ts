import { SetMetadata } from '@nestjs/common';

import { OWNER_CSRF_REQUIRED_METADATA } from './owner-auth.constants.js';

export const RequireOwnerCsrf = () => SetMetadata(OWNER_CSRF_REQUIRED_METADATA, true);
