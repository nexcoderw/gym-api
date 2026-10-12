import { Controller, Get } from '@nestjs/common';
import {
	ApiOkResponse,
	ApiOperation,
	ApiTags,
	ApiTooManyRequestsResponse,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto';
import { LivenessResponseDto } from './dto/liveness-response.dto';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
	constructor(private readonly healthService: HealthService) {}

	@Get('live')
	@ApiOperation({
		summary: 'Check process liveness',
		description:
			'Confirms that the API process can serve HTTP. It does not assert database readiness.',
	})
	@ApiOkResponse({ description: 'The API process is alive.', type: LivenessResponseDto })
	@ApiTooManyRequestsResponse({ description: 'The caller exceeded the request limit.', type: ApiErrorResponseDto })
	getLiveness(): LivenessResponseDto {
		return this.healthService.getLiveness();
	}
}
