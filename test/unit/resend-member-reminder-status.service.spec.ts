import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { ResendMemberReminderStatusService } from '../../src/infrastructure/email/resend-member-reminder-status.service.js';

const ID = '55555555-5555-4555-8555-555555555555';
const RECIPIENT = 'member@example.com';
const sender = 'Soho Gym via Mucyora <reminders@notify.example.invalid>';

function email(lastEvent: string): Response {
	return Response.json({
		id: ID,
		to: [RECIPIENT],
		from: sender,
		last_event: lastEvent,
	});
}

describe('Resend member reminder status adapter', () => {
	const originalFetch = globalThis.fetch;
	const fetchFake = jest.fn<typeof fetch>();
	let module: TestingModule | undefined;
	let service: ResendMemberReminderStatusService;

	beforeEach(async () => {
		globalThis.fetch = fetchFake;
		fetchFake.mockReset();
		module = await Test.createTestingModule({
			providers: [
				ResendMemberReminderStatusService,
				{
					provide: ConfigService,
					useValue: {
						get: (name: string): string | undefined =>
							name === 'RESEND_REMINDER_RECONCILER_API_KEY'
								? 're_fictional_full_access'
								: name === 'MEMBER_REMINDER_FROM_EMAIL'
									? 'reminders@notify.example.invalid'
									: undefined,
					},
				},
			],
		}).compile();
		service = module.get(ResendMemberReminderStatusService);
	});

	afterEach(async () => module?.close());
	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	it.each([
		['sent', 'pending'],
		['delivery_delayed', 'pending'],
		['delivered', 'delivered'],
		['opened', 'delivered'],
		['bounced', 'bounced'],
		['complained', 'complained'],
		['failed', 'failed'],
	])('classifies %s as %s', async (event, kind) => {
		fetchFake.mockResolvedValueOnce(email(event));
		expect(await service.get(ID, RECIPIENT)).toEqual({ kind });
		expect(fetchFake.mock.calls[0]?.[0]).toBe(`https://api.resend.com/emails/${ID}`);
	});

	it('ignores a provider record for a different recipient or sender', async () => {
		fetchFake.mockResolvedValueOnce(
			Response.json({ id: ID, to: ['other@example.com'], from: sender, last_event: 'delivered' }),
		);
		expect(await service.get(ID, RECIPIENT)).toEqual({ kind: 'unavailable' });
		fetchFake.mockResolvedValueOnce(
			Response.json({
				id: ID,
				to: [RECIPIENT],
				from: 'Other <attacker@example.com>',
				last_event: 'delivered',
			}),
		);
		expect(await service.get(ID, RECIPIENT)).toEqual({ kind: 'unavailable' });
	});

	it('treats malformed records and transport failures as unavailable', async () => {
		fetchFake.mockResolvedValueOnce(Response.json({ id: ID, to: [RECIPIENT], from: sender }));
		expect(await service.get(ID, RECIPIENT)).toEqual({ kind: 'unavailable' });
		fetchFake.mockRejectedValueOnce(new Error('private provider error'));
		expect(await service.get(ID, RECIPIENT)).toEqual({ kind: 'unavailable' });
	});
});
