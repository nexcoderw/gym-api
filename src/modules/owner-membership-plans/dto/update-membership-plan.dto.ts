import { PartialType } from '@nestjs/swagger';

import { CreateMembershipPlanDto } from './create-membership-plan.dto.js';

/** PATCH accepts only mutable plan fields; organization, currency and lifecycle remain server-owned. */
export class UpdateMembershipPlanDto extends PartialType(CreateMembershipPlanDto) {}
