import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationMemberReminderKind as ReminderKind } from '@nexcoderw/gym-db';

import type { MemberReminderWorkerEnvironment } from '../../config/member-reminder-worker.environment.js';

export type MemberReminderProviderOutcome =
	| { readonly kind: 'accepted'; readonly messageId: string }
	| {
			readonly kind: 'rejected';
			readonly code:
				'PROVIDER_RATE_LIMITED' | 'PROVIDER_REJECTED' | 'DELIVERY_CONFIGURATION_CHANGED';
			readonly retryable: boolean;
	  }
	| {
			readonly kind: 'uncertain';
			readonly code: 'PROVIDER_OUTCOME_UNKNOWN' | 'PROVIDER_RESPONSE_INVALID';
	  };

export interface MemberReminderEmail {
	readonly recipient: string;
	readonly organizationName: string;
	readonly planName: string;
	readonly endDate: string;
	readonly kind: ReminderKind;
	readonly idempotencyKey: string;
}

@Injectable()
export class ResendMemberReminderEmailService {
	constructor(private readonly config: ConfigService<MemberReminderWorkerEnvironment, true>) {}

	/** One submission only; transport exceptions are ambiguous and must not be retried here. */
	async send(input: MemberReminderEmail): Promise<MemberReminderProviderOutcome> {
		const key = this.config.get('RESEND_API_KEY', { infer: true });
		const sender = this.config.get('MEMBER_REMINDER_FROM_EMAIL', { infer: true });
		const organizationName = safeDisplayName(input.organizationName);
		const planName = safeText(input.planName);
		if (!/^[0-9a-f]{64}$/u.test(input.idempotencyKey)) {
			return { kind: 'rejected', code: 'DELIVERY_CONFIGURATION_CHANGED', retryable: false };
		}
		const occasion = input.kind === ReminderKind.THREE_DAYS_BEFORE ? 'in three days' : 'today';
		const text = `Your ${planName} membership at ${organizationName} ends ${occasion} (${input.endDate}, Africa/Kigali). Contact your gym if you would like to renew. If this is unexpected, contact the gym directly.`;
		try {
			const response = await fetch('https://api.resend.com/emails', {
				method: 'POST',
				redirect: 'error',
				signal: AbortSignal.timeout(8_000),
				headers: {
					Authorization: `Bearer ${key}`,
					'Content-Type': 'application/json',
					'Idempotency-Key': input.idempotencyKey,
				},
				body: JSON.stringify({
					from: `${organizationName} via Mucyora <${sender}>`,
					to: [input.recipient],
					subject: `Your ${organizationName} membership ends ${occasion}`,
					text,
				}),
			});
			if (!response.ok) {
				await response.body?.cancel();
				if (response.status === 429)
					return { kind: 'rejected', code: 'PROVIDER_RATE_LIMITED', retryable: true };
				if ([400, 401, 403, 404, 422].includes(response.status)) {
					return { kind: 'rejected', code: 'PROVIDER_REJECTED', retryable: false };
				}
				return { kind: 'uncertain', code: 'PROVIDER_OUTCOME_UNKNOWN' };
			}
			const value = await boundedJson(response);
			if (
				typeof value !== 'object' ||
				value === null ||
				!('id' in value) ||
				typeof value.id !== 'string' ||
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
					value.id,
				)
			) {
				return { kind: 'uncertain', code: 'PROVIDER_RESPONSE_INVALID' };
			}
			return { kind: 'accepted', messageId: value.id };
		} catch {
			return { kind: 'uncertain', code: 'PROVIDER_OUTCOME_UNKNOWN' };
		}
	}
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
			if (size > 4096) return null;
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

function safeDisplayName(value: string): string {
	const normalized = value
		.normalize('NFKC')
		.replace(/[^\p{L}\p{N} &'’.-]/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim();
	return normalized.slice(0, 64) || 'Your gym';
}

function safeText(value: string): string {
	return (
		value
			.normalize('NFKC')
			.replace(/[\p{Cc}\p{Cf}]/gu, ' ')
			.replace(/\s+/gu, ' ')
			.trim()
			.slice(0, 100) || 'gym'
	);
}
