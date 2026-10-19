import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { MemberReminderReconcilerEnvironment } from '../../config/member-reminder-reconciler.environment.js';

export type ReminderProviderStatus =
	| { readonly kind: 'pending' }
	| { readonly kind: 'delivered' }
	| { readonly kind: 'bounced' }
	| { readonly kind: 'complained' }
	| { readonly kind: 'failed' }
	| { readonly kind: 'unavailable' };

const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class ResendMemberReminderStatusService {
	constructor(private readonly config: ConfigService<MemberReminderReconcilerEnvironment, true>) {}

	async get(messageId: string, recipient: string): Promise<ReminderProviderStatus> {
		if (!MESSAGE_ID.test(messageId)) return { kind: 'unavailable' };
		try {
			const response = await fetch(`https://api.resend.com/emails/${messageId}`, {
				method: 'GET',
				redirect: 'error',
				signal: AbortSignal.timeout(8_000),
				headers: {
					Authorization: `Bearer ${this.config.get('RESEND_REMINDER_RECONCILER_API_KEY', { infer: true })}`,
				},
			});
			if (!response.ok) {
				await response.body?.cancel();
				return { kind: 'unavailable' };
			}
			const value = await boundedJson(response);
			if (
				typeof value !== 'object' ||
				value === null ||
				!('id' in value) ||
				value.id !== messageId ||
				!('to' in value) ||
				!Array.isArray(value.to) ||
				value.to.length !== 1 ||
				typeof value.to[0] !== 'string' ||
				value.to[0].toLowerCase() !== recipient.toLowerCase() ||
				!('from' in value) ||
				typeof value.from !== 'string' ||
				!senderMatches(
					value.from,
					this.config.get('MEMBER_REMINDER_FROM_EMAIL', { infer: true }),
				) ||
				!('last_event' in value) ||
				typeof value.last_event !== 'string'
			) {
				return { kind: 'unavailable' };
			}
			switch (value.last_event) {
				case 'delivered':
				case 'opened':
				case 'clicked':
					return { kind: 'delivered' };
				case 'bounced':
					return { kind: 'bounced' };
				case 'complained':
					return { kind: 'complained' };
				case 'failed':
				case 'suppressed':
					return { kind: 'failed' };
				case 'sent':
				case 'delivery_delayed':
				case 'scheduled':
					return { kind: 'pending' };
				default:
					return { kind: 'unavailable' };
			}
		} catch {
			// Never log provider bodies, email addresses, credentials or transport details.
			return { kind: 'unavailable' };
		}
	}
}

function senderMatches(value: string, sender: string): boolean {
	const normalized = value.trim().toLowerCase();
	return normalized === sender || normalized.endsWith(` <${sender}>`);
}

async function boundedJson(response: Response): Promise<unknown> {
	if (
		response.body === null ||
		!response.headers.get('content-type')?.includes('application/json')
	) {
		await response.body?.cancel();
		return null;
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		let chunk = await reader.read();
		while (!chunk.done) {
			size += chunk.value.byteLength;
			if (size > 16_384) return null;
			chunks.push(chunk.value);
			chunk = await reader.read();
		}
		const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		return value;
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
}
