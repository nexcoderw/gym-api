import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { OrganizationMemberReminderKind as ReminderKind } from '@nexcoderw/gym-db';

import { ResendMemberReminderEmailService } from '../../src/infrastructure/email/resend-member-reminder-email.service.js';

const MESSAGE_ID = '55555555-5555-4555-8555-555555555555';
const message = {
	recipient: 'member@example.com',
	organizationName: 'Soho Gym',
	planName: 'Monthly fitness',
	endDate: '2026-10-22',
	kind: ReminderKind.THREE_DAYS_BEFORE,
	idempotencyKey: 'a'.repeat(64),
};

describe('Resend member reminder email adapter', () => {
	const originalFetch = globalThis.fetch;
	const fetchFake = jest.fn<typeof fetch>();
	let module: TestingModule | undefined;
	let service: ResendMemberReminderEmailService;

	beforeEach(async () => {
		globalThis.fetch = fetchFake;
		fetchFake.mockReset();
		module = await Test.createTestingModule({
			providers: [
				ResendMemberReminderEmailService,
				{
					provide: ConfigService,
					useValue: {
						get: (name: string): string | undefined =>
							name === 'RESEND_API_KEY'
								? 're_fictional'
								: name === 'MEMBER_REMINDER_FROM_EMAIL'
									? 'reminders@notify.example.invalid'
									: undefined,
					},
				},
			],
		}).compile();
		service = module.get(ResendMemberReminderEmailService);
	});

	afterEach(async () => {
		await module?.close();
	});
	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	it('uses the fixed verified sender and stable idempotency key', async () => {
		fetchFake.mockResolvedValue(
			new Response(JSON.stringify({ id: MESSAGE_ID }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
		expect(await service.send(message)).toEqual({ kind: 'accepted', messageId: MESSAGE_ID });
		const request = fetchFake.mock.calls[0];
		expect(request?.[0]).toBe('https://api.resend.com/emails');
		expect(request?.[1]?.headers).toMatchObject({ 'Idempotency-Key': message.idempotencyKey });
		const payload: unknown = JSON.parse(String(request?.[1]?.body));
		expect(payload).toMatchObject({
			from: 'Soho Gym via Mucyora <reminders@notify.example.invalid>',
			to: ['member@example.com'],
		});
	});

	it('classifies a definite rate limit separately from an uncertain transport outcome', async () => {
		fetchFake.mockResolvedValueOnce(new Response(null, { status: 429 }));
		expect(await service.send(message)).toEqual({
			kind: 'rejected',
			code: 'PROVIDER_RATE_LIMITED',
			retryable: true,
		});
		fetchFake.mockRejectedValueOnce(new Error('private transport detail'));
		expect(await service.send(message)).toEqual({
			kind: 'uncertain',
			code: 'PROVIDER_OUTCOME_UNKNOWN',
		});
	});
});
