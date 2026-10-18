import { jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { TenantTransactionService } from '@nexcoderw/gym-db';

import { MemberPeriodUnit } from '../../src/modules/owner/members/member-period.js';
import { OwnerMembersService } from '../../src/modules/owner/members/owner-members.service.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const KEY = '44444444-4444-4444-8444-444444444444';
const CONTEXT = { organizationId: ORGANIZATION_ID, actorUserId: KEY };
const AT = new Date('2026-10-18T08:00:00.000Z');
const MEMBER = {
	id: MEMBER_ID, name: 'Example Member', phoneNumber: '+250700000001',
	email: null, archivedAt: null, createdAt: AT, updatedAt: AT,
};
const SUBSCRIPTION = {
	id: KEY, memberId: MEMBER_ID, membershipPlanId: PLAN_ID,
	planName: 'Monthly access', priceRwf: 30_000n, periodUnit: 'MONTHS' as const,
	periodCount: 1, startDate: new Date('2030-01-01T00:00:00.000Z'),
	endDate: new Date('2030-01-31T00:00:00.000Z'), createdAt: AT, cancelledAt: null,
};
const INPUT = {
	name: MEMBER.name, phoneNumber: MEMBER.phoneNumber,
	subscription: { membershipPlanId: PLAN_ID, startDate: '2030-01-01', periodUnit: MemberPeriodUnit.MONTHS, periodCount: 1 },
};

describe('member registration workflow', () => {
	let service: OwnerMembersService;
	let module: TestingModule | undefined;
	let storedFingerprint: string;
	const createMember = jest.fn<
		(input: { data: { organizationId: string } }) => Promise<typeof MEMBER>
	>();
	const createSubscription = jest.fn<
		(input: {
			data: {
				organizationId: string;
				memberId: string;
				priceRwf: bigint;
				createdByUserId: string;
				idempotencyKey: string;
				requestFingerprint: string;
			};
		}) => Promise<typeof SUBSCRIPTION>
	>();
	const findReplay = jest.fn<() => Promise<(typeof SUBSCRIPTION & { requestFingerprint: string; member: typeof MEMBER }) | null>>();
	const lock = jest.fn<() => Promise<({ id: string } | { id: string; name: string; price_rwf: bigint })[]>>();
	const transaction = {
		organizationMember: { create: createMember },
		organizationMemberSubscription: { create: createSubscription, findFirst: findReplay },
		$queryRaw: lock,
	};

	beforeEach(async () => {
		jest.resetAllMocks();
		createMember.mockResolvedValue(MEMBER);
		createSubscription.mockImplementation(({ data }) => {
			storedFingerprint = data.requestFingerprint;
			return Promise.resolve(SUBSCRIPTION);
		});
		// The first lookup is idempotency; the second checks overlap.
		findReplay.mockResolvedValue(null);
		lock.mockResolvedValueOnce([{ id: MEMBER_ID }]).mockResolvedValueOnce([{ id: PLAN_ID, name: 'Monthly access', price_rwf: 30_000n }]);
		module = await Test.createTestingModule({
			providers: [
				OwnerMembersService,
				{ provide: TenantTransactionService, useValue: {
					run: async (_context: unknown, operation: (value: typeof transaction) => Promise<unknown>): Promise<unknown> => operation(transaction),
				} },
			],
		}).compile();
		service = module.get(OwnerMembersService);
	});

	afterEach(async () => module?.close());

	it('creates the profile and plan terms together using the trusted scope', async () => {
		const result = await service.create(CONTEXT, INPUT, KEY);
		expect(result.member.id).toBe(MEMBER_ID);
		expect(result.subscription.endDate).toBe('2030-01-31');
		const memberInput = createMember.mock.calls[0]?.[0];
		const subscriptionInput = createSubscription.mock.calls[0]?.[0];
		expect(memberInput?.data.organizationId).toBe(ORGANIZATION_ID);
		expect(subscriptionInput?.data).toMatchObject({
			memberId: MEMBER_ID,
			organizationId: ORGANIZATION_ID,
			priceRwf: 30_000n,
			createdByUserId: KEY,
			idempotencyKey: KEY,
		});
	});

	it('returns the original registration for identical retries and rejects key reuse', async () => {
		await service.create(CONTEXT, INPUT, KEY);
		findReplay.mockResolvedValue({ ...SUBSCRIPTION, requestFingerprint: storedFingerprint, member: MEMBER });
		await service.create(CONTEXT, INPUT, KEY);
		expect(createMember).toHaveBeenCalledTimes(1);
		expect(createSubscription).toHaveBeenCalledTimes(1);
		await expect(service.create(CONTEXT, { ...INPUT, name: 'Different Member' }, KEY)).rejects.toMatchObject({
			response: { code: 'MEMBER_IDEMPOTENCY_CONFLICT' },
		});
	});

	it('rejects archived or foreign plans before inserting a registration', async () => {
		lock.mockReset().mockResolvedValueOnce([{ id: MEMBER_ID }]).mockResolvedValueOnce([]);
		await expect(service.create(CONTEXT, INPUT, KEY)).rejects.toMatchObject({ response: { code: 'MEMBER_NOT_FOUND' } });
		expect(createSubscription).not.toHaveBeenCalled();
	});

	it('rejects an overlapping registration without inserting another one', async () => {
		findReplay.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...SUBSCRIPTION, requestFingerprint: 'unrelated', member: MEMBER }).mockResolvedValueOnce(null);
		await expect(service.create(CONTEXT, INPUT, KEY)).rejects.toMatchObject({ response: { code: 'MEMBER_PERIOD_OVERLAP' } });
		expect(createSubscription).not.toHaveBeenCalled();
	});
});
