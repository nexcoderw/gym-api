import { PickType } from '@nestjs/swagger';

import { CreateOrganizationDto } from './create-organization.dto.js';

/** Profile writes cannot assign slug, status, timestamps, identities or permissions. */
export class UpdateOrganizationDto extends PickType(CreateOrganizationDto, ['name'] as const) {}
