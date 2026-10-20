import { jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
	OrganizationPaymentRefundStatus,
	OrganizationPaymentStatus,
	TenantTransactionService,
} from '@nexcoderw/gym-db';

import { OwnerPaymentReportsService } from '../../src/modules/owner/reports/owner-payment-reports.service.js';

const CONTEXT = {
	organizationId: '11111111-1111-4111-8111-111111111111',
	actorUserId: '22222222-2222-4222-8222-222222222222',
	requestId: '33333333-3333-4333-8333-333333333333',
};
const QUERY = { fromDate: '2026-01-01', toDate: '2026-01-31' };

describe('owner payment report summary', () => {
	let module: TestingModule | undefined;
	let service: OwnerPaymentReportsService;
	const groupBy = jest.fn<
		() => Promise<
			{
				status: OrganizationPaymentStatus;
				_count: { _all: number };
				_sum: { amountRwf: bigint | null };
			}[]
		>
	>();
	const aggregate = jest.fn<() => Promise<{ _sum: { amountRwf: bigint | null } }>>();
	const transaction = {
		organizationPayment: { groupBy },
		organizationPaymentRefund: { aggregate },
	};
	const run =
		jest.fn<
			(
				_context: unknown,
				operation: (value: typeof transaction) => Promise<unknown>,
			) => Promise<unknown>
		>();

	beforeEach(async () => {
		jest.resetAllMocks();
		run.mockImplementation(async (_context, operation) => operation(transaction));
		groupBy.mockResolvedValue([
			{
				status: OrganizationPaymentStatus.CONFIRMED,
				_count: { _all: 2 },
				_sum: { amountRwf: 30_000n },
			},
			{
				status: OrganizationPaymentStatus.PENDING,
				_count: { _all: 1 },
				_sum: { amountRwf: 20_000n },
			},
		]);
		aggregate.mockResolvedValue({ _sum: { amountRwf: 5_000n } });
		module = await Test.createTestingModule({
			providers: [
				OwnerPaymentReportsService,
				{ provide: TenantTransactionService, useValue: { run } },
			],
		}).compile();
		service = module.get(OwnerPaymentReportsService);
	});

	afterEach(async () => module?.close());

	it('aggregates only the authenticated gym and selected Kigali payment days', async () => {
		const result = await service.summary(CONTEXT, QUERY);
		const occurredAt = {
			gte: new Date('2025-12-31T22:00:00.000Z'),
			lt: new Date('2026-01-31T22:00:00.000Z'),
		};

		expect(run).toHaveBeenCalledWith(CONTEXT, expect.any(Function));
		expect(groupBy).toHaveBeenCalledWith({
			by: ['status'],
			where: { organizationId: CONTEXT.organizationId, occurredAt },
			_count: { _all: true },
			_sum: { amountRwf: true },
		});
		expect(aggregate).toHaveBeenCalledWith({
			where: {
				organizationId: CONTEXT.organizationId,
				status: OrganizationPaymentRefundStatus.CONFIRMED,
				payment: { is: { organizationId: CONTEXT.organizationId, occurredAt } },
			},
			_sum: { amountRwf: true },
		});
		expect(result).toMatchObject({
			...QUERY,
			currency: 'RWF',
			paymentCount: 3,
			settledPaymentCount: 2,
			grossRwf: '30000',
			refundedRwf: '5000',
			netRwf: '25000',
		});
		expect(Number.isNaN(Date.parse(result.generatedAt))).toBe(false);
	});

	it('returns zero totals for an empty date range', async () => {
		groupBy.mockResolvedValue([]);
		aggregate.mockResolvedValue({ _sum: { amountRwf: null } });
		await expect(service.summary(CONTEXT, QUERY)).resolves.toMatchObject({
			paymentCount: 0,
			settledPaymentCount: 0,
			grossRwf: '0',
			refundedRwf: '0',
			netRwf: '0',
		});
	});

	it('rejects invalid dates before opening a database transaction', async () => {
		await expect(
			service.summary(CONTEXT, { ...QUERY, toDate: '2026-02-30' }),
		).rejects.toMatchObject({
			status: 400,
		});
		expect(run).not.toHaveBeenCalled();
	});

	it('hides database failures behind a stable unavailable response', async () => {
		groupBy.mockRejectedValue(new Error('private database detail'));
		await expect(service.summary(CONTEXT, QUERY)).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
	});
});
