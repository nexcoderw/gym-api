import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../../src/config/environment.types.js';
import { validateEnvironment } from '../../src/config/environment.validation.js';
import { ResendEmailService } from '../../src/infrastructure/email/resend-email.service.js';

describe('ResendEmailService', () => {
	const fetchMock = jest.fn<typeof fetch>();
	const service = new ResendEmailService(new ConfigService<EnvironmentVariables, true>(validateEnvironment({ NODE_ENV: 'test', PLATFORM_AUTH_EMAIL_OTP_ENABLED: 'true', RESEND_API_KEY: 're_fictional', RESEND_FROM_EMAIL: 'security@example.com' })));
	beforeEach(() => { jest.clearAllMocks(); jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock); });
	afterEach(() => { jest.restoreAllMocks(); });
	it('uses the fixed HTTPS endpoint and an idempotency key', async () => {
		fetchMock.mockResolvedValueOnce(Response.json({ id: '2f5298af-cf42-4e66-8968-a42be74cb34b' }));
		await service.sendOtp('admin@example.com', '012345', 'fictional-delivery-id');
		expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ 'Idempotency-Key': 'platform-otp/fictional-delivery-id' }) }));
	});
	it.each([401, 429, 500])('sanitizes provider failure %s and never retries', async (status) => {
		fetchMock.mockResolvedValueOnce(Response.json({ message: 'private provider message' }, { status }));
		await expect(service.sendOtp('admin@example.com', '012345', 'delivery-id')).rejects.toMatchObject({ status: 503 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it.each([{}, { id: 'invalid' }])('rejects an incompatible success payload', async (body) => {
		fetchMock.mockResolvedValueOnce(Response.json(body));
		await expect(service.sendOtp('admin@example.com', '012345', 'delivery-id')).rejects.toMatchObject({ status: 503 });
	});
	it('bounds provider response bytes', async () => {
		fetchMock.mockResolvedValueOnce(new Response('x'.repeat(4_097)));
		await expect(service.sendOtp('admin@example.com', '012345', 'delivery-id')).rejects.toMatchObject({ status: 503 });
	});
});
