import { HealthService } from '../../src/modules/health/health.service';

describe('HealthService', () => {
	it('reports process liveness without claiming dependency readiness', () => {
		const result = new HealthService().getLiveness();

		expect(result).toEqual({
			status: 'ok',
			service: 'nexcode-gym-api',
			version: '0.1.0',
			timestamp: expect.any(String),
			uptimeSeconds: expect.any(Number),
		});
		expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
	});
});
