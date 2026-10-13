import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class PlatformEmailOtpRequestDto {
	@ApiProperty({ description: 'Password-step challenge; recipient is selected by the server.', maxLength: 256 })
	@IsString()
	@Matches(/^[A-Za-z0-9_-]{32,256}$/u)
	challengeToken!: string;
}
