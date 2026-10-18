import { jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import {
	OrganizationPaymentMethod,
	OrganizationPaymentStatus,
	TenantTransactionService,
} from '@nexcoderw/gym-db';

import { MemberPeriodUnit } from '../../src/modules/owner/members/member-period.js';
import type { RegisterPaymentDto } from '../../src/modules/owner/payments/dto/register-payment.dto.js';
import { OwnerPaymentsService } from '../../src/modules/owner/payments/owner-payments.service.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const SUBSCRIPTION_ID = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';
const CONTEXT = { organizationId: ORGANIZATION_ID, actorUserId: KEY, requestId: 'test-request' };
const AT = new Date('2026-10-18T08:00:00.000Z');
const INPUT: RegisterPaymentDto = {
	member: { name: 'Example Member', phoneNumber: '+250700000001' },
	subscription: {
		membershipPlanId: PLAN_ID,
		startDate: '2030-01-01',
		periodUnit: MemberPeriodUnit.MONTHS,
		periodCount: 1,
	},
	method: OrganizationPaymentMethod.CASH,
	occurredAt: AT.toISOString(),
};
const SUBSCRIPTION = {
	id: SUBSCRIPTION_ID,
	memberId: MEMBER_ID,
	membershipPlanId: PLAN_ID,
	planName: 'Monthly access',
	priceRwf: 30_000n,
	periodUnit: MemberPeriodUnit.MONTHS,
	periodCount: 1,
	startDate: new Date('2030-01-01T00:00:00.000Z'),
	endDate: new Date('2030-01-31T00:00:00.000Z'),
	createdAt: AT,
	cancelledAt: null,
};
const PAYMENT = {
	id: KEY,
	receiptNumber: 'PAY-20261018-55555555',
	memberId: MEMBER_ID,
	amountRwf: 30_000n,
	method: OrganizationPaymentMethod.CASH,
	status: OrganizationPaymentStatus.CONFIRMED,
	providerReference: null,
	note: null,
	occurredAt: AT,
	confirmedAt: AT,
	voidedAt: null,
	voidReason: null,
	createdAt: AT,
	member: { name: 'Example Member' },
	allocations: [
		{
			memberSubscriptionId: SUBSCRIPTION_ID,
			amountRwf: 30_000n,
			memberSubscription: { planName: 'Monthly access' },
		},
	],
	refunds: [],
};

function inputWith(changes: Partial<RegisterPaymentDto>): RegisterPaymentDto {
	return Object.assign(Object.create(Object.getPrototypeOf(INPUT)), INPUT, changes);
}

describe('owner registration payment', () => {
	let service: OwnerPaymentsService;
	let module: TestingModule | undefined;
	const findPayment =
		jest.fn<() => Promise<(typeof PAYMENT & { requestFingerprint: string }) | null>>();
	const createMember = jest.fn<() => Promise<{ id: string }>>();
	const createSubscription = jest.fn<() => Promise<typeof SUBSCRIPTION>>();
	const createPayment = jest.fn<
		(input: {
			data: {
				amountRwf: number;
				organizationId: string;
				memberId: string;
				requestFingerprint: string;
			};
		}) => Promise<typeof PAYMENT>
	>();
	const audit = jest.fn<() => Promise<unknown>>();
	const lock =
		jest.fn<() => Promise<({ id: string } | { id: string; name: string; price_rwf: bigint })[]>>();
	const transaction = {
		organizationPayment: { findFirst: findPayment, create: createPayment },
		organizationMember: { create: createMember },
		organizationMemberSubscription: {
			findFirst: jest.fn<() => Promise<null>>(),
			create: createSubscription,
		},
		organizationPaymentAllocation: {
			aggregate: jest.fn<() => Promise<{ _sum: { amountRwf: bigint } }>>(),
		},
		organizationPaymentAuditEvent: { create: audit },
		$queryRaw: lock,
	};

	beforeEach(async () => {
		jest.resetAllMocks();
		findPayment.mockResolvedValue(null);
		createMember.mockResolvedValue({ id: MEMBER_ID });
		createSubscription.mockResolvedValue(SUBSCRIPTION);
		createPayment.mockResolvedValue(PAYMENT);
		audit.mockResolvedValue({});
		transaction.organizationMemberSubscription.findFirst.mockResolvedValue(null);
		transaction.organizationPaymentAllocation.aggregate.mockResolvedValue({
			_sum: { amountRwf: 0n },
		});
		lock
			.mockResolvedValueOnce([{ id: MEMBER_ID }])
			.mockResolvedValueOnce([{ id: PLAN_ID, name: 'Monthly access', price_rwf: 30_000n }])
			.mockResolvedValueOnce([{ id: SUBSCRIPTION_ID, price_rwf: 30_000n }]);
		module = await Test.createTestingModule({
			providers: [
				OwnerPaymentsService,
				{
					provide: TenantTransactionService,
					useValue: {
						run: async (
							_context: unknown,
							operation: (value: typeof transaction) => Promise<unknown>,
						): Promise<unknown> => operation(transaction),
					},
				},
			],
		}).compile();
		service = module.get(OwnerPaymentsService);
	});

	afterEach(async () => module?.close());

	it('stores a new member, dated registration, full plan price and payment audit', async () => {
		const result = await service.registerPayment(CONTEXT, INPUT, KEY);
		expect(result.amount).toBe(30_000);
		expect(result.status).toBe(OrganizationPaymentStatus.CONFIRMED);
		expect(createMember).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ organizationId: ORGANIZATION_ID }),
			}),
		);
		expect(createSubscription).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					endDate: SUBSCRIPTION.endDate,
					organizationId: ORGANIZATION_ID,
				}),
			}),
		);
		expect(createPayment.mock.calls[0]?.[0].data).toMatchObject({
			amountRwf: 30_000,
			memberId: MEMBER_ID,
			organizationId: ORGANIZATION_ID,
		});
		expect(audit).toHaveBeenCalledTimes(1);
	});

	it('does not create another member or payment for an identical retry', async () => {
		await service.registerPayment(CONTEXT, INPUT, KEY);
		const firstWrite = createPayment.mock.calls[0]?.[0];
		if (firstWrite === undefined) throw new Error('Missing first payment write.');
		findPayment.mockResolvedValue({
			...PAYMENT,
			requestFingerprint: firstWrite.data.requestFingerprint,
		});
		await service.registerPayment(CONTEXT, INPUT, KEY);
		expect(createMember).toHaveBeenCalledTimes(1);
		expect(createPayment).toHaveBeenCalledTimes(1);
		await expect(
			service.registerPayment(CONTEXT, inputWith({ note: 'Changed' }), KEY),
		).rejects.toMatchObject({
			response: { code: 'PAYMENT_IDEMPOTENCY_CONFLICT' },
		});
	});

	it('requires exactly one member selection before opening a transaction', async () => {
		await expect(
			service.registerPayment(CONTEXT, inputWith({ memberId: MEMBER_ID }), KEY),
		).rejects.toMatchObject({ response: { code: 'PAYMENT_MEMBER_REQUIRED' } });
		await expect(
			service.registerPayment(CONTEXT, inputWith({ member: undefined }), KEY),
		).rejects.toMatchObject({ response: { code: 'PAYMENT_MEMBER_REQUIRED' } });
		expect(createMember).not.toHaveBeenCalled();
	});

	it('uses an existing active member without creating another profile', async () => {
		const result = await service.registerPayment(
			CONTEXT,
			inputWith({ member: undefined, memberId: MEMBER_ID }),
			KEY,
		);
		expect(result.memberId).toBe(MEMBER_ID);
		expect(createMember).not.toHaveBeenCalled();
		expect(createSubscription).toHaveBeenCalledTimes(1);
	});

	it('rejects an unavailable or foreign plan before recording payment', async () => {
		lock
			.mockReset()
			.mockResolvedValueOnce([{ id: MEMBER_ID }])
			.mockResolvedValueOnce([]);
		await expect(service.registerPayment(CONTEXT, INPUT, KEY)).rejects.toMatchObject({
			response: { code: 'MEMBER_NOT_FOUND' },
		});
		expect(createPayment).not.toHaveBeenCalled();
		expect(audit).not.toHaveBeenCalled();
	});

	it('does not record a payment for a zero-price plan', async () => {
		createSubscription.mockResolvedValue({ ...SUBSCRIPTION, priceRwf: 0n });
		lock
			.mockReset()
			.mockResolvedValueOnce([{ id: MEMBER_ID }])
			.mockResolvedValueOnce([{ id: PLAN_ID, name: 'Free access', price_rwf: 0n }]);
		await expect(service.registerPayment(CONTEXT, INPUT, KEY)).rejects.toMatchObject({
			response: { code: 'PAYMENT_FREE_PLAN' },
		});
		expect(createPayment).not.toHaveBeenCalled();
		expect(audit).not.toHaveBeenCalled();
	});
});
