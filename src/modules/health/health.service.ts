import { Injectable } from '@nestjs/common';

import { SERVICE_NAME, SERVICE_VERSION } from '../../common/constants/api.constants.js';
import type { LivenessResponseDto } from './dto/liveness-response.dto.js';

@Injectable()
export class HealthService {
	/** Reports process liveness only; it deliberately makes no database readiness claim. */
	getLiveness(): LivenessResponseDto {
		return {
			status: 'ok',
			service: SERVICE_NAME,
			version: SERVICE_VERSION,
			timestamp: new Date().toISOString(),
			uptimeSeconds: process.uptime(),
		};
	}
}
