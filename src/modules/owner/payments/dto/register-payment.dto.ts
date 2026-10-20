import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsOptional, IsUUID, ValidateNested } from 'class-validator';

import { MemberProfileDto } from '../../members/dto/create-member.dto.js';
import { RegisterMemberSubscriptionDto } from '../../members/dto/register-member-subscription.dto.js';
import { CreatePaymentDto } from './create-payment.dto.js';

/** Exactly one of memberId or member is accepted by the service. */
export class RegisterPaymentDto extends OmitType(CreatePaymentDto, [
	'memberId',
	'subscriptionId',
	'amount',
] as const) {
	@ApiPropertyOptional({ format: 'uuid', description: 'An existing active member of this gym.' })
	@IsOptional()
	@IsUUID('loose')
	memberId?: string;

	@ApiPropertyOptional({ type: MemberProfileDto, description: 'A new gym member profile.' })
	@IsOptional()
	@ValidateNested()
	@Type(() => MemberProfileDto)
	member?: MemberProfileDto;

	@ApiProperty({ type: RegisterMemberSubscriptionDto })
	@IsDefined()
	@ValidateNested()
	@Type(() => RegisterMemberSubscriptionDto)
	subscription!: RegisterMemberSubscriptionDto;
}
