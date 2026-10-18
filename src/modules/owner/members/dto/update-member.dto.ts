import { PartialType } from '@nestjs/swagger';

import { MemberProfileDto } from './create-member.dto.js';

export class UpdateMemberDto extends PartialType(MemberProfileDto, { skipNullProperties: false }) {}
