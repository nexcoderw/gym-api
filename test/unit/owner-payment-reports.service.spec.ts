import { jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
	OrganizationPaymentMethod,
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
const PAYMENT = {
	id: '44444444-4444-4444-8444-444444444444',
	receiptNumber: 'PAY-20260101-EXAMPLE',
	amountRwf: 15_000n,
	method: OrganizationPaymentMethod.CASH,
	status: OrganizationPaymentStatus.CONFIRMED,
	occurredAt: new Date('2026-01-01T09:00:00.000Z'),
	member: { name: 'Example Member' },
	refunds: [{ amountRwf: 2_000n }],
};

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
	const findUnique = jest.fn<() => Promise<{ name: string } | null>>();
	const findMany = jest.fn<() => Promise<(typeof PAYMENT)[]>>();
	const queryRaw =
		jest.fn<() => Promise<{ planId: string | null; planName: string; grossRwf: bigint }[]>>();
	const transaction = {
		organization: { findUnique },
		organizationPayment: { groupBy, findMany },
		organizationPaymentRefund: { aggregate },
		$queryRaw: queryRaw,
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
		queryRaw.mockResolvedValue([
			{
				planId: '55555555-5555-4555-8555-555555555555',
				planName: 'Gold Plan',
				grossRwf: 20_000n,
			},
		]);
		findUnique.mockResolvedValue({ name: 'Soho Gym' });
		findMany.mockResolvedValue([PAYMENT]);
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
		expect(queryRaw).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({
			...QUERY,
			currency: 'RWF',
			paymentCount: 3,
			settledPaymentCount: 2,
			grossRwf: '30000',
			refundedRwf: '5000',
			netRwf: '25000',
			planTotals: [
				{
					planId: '55555555-5555-4555-8555-555555555555',
					planName: 'Gold Plan',
					grossRwf: '20000',
				},
			],
		});
		expect(Number.isNaN(Date.parse(result.generatedAt))).toBe(false);
	});

	it('returns zero totals for an empty date range', async () => {
		groupBy.mockResolvedValue([]);
		aggregate.mockResolvedValue({ _sum: { amountRwf: null } });
		queryRaw.mockResolvedValue([]);
		await expect(service.summary(CONTEXT, QUERY)).resolves.toMatchObject({
			paymentCount: 0,
			settledPaymentCount: 0,
			grossRwf: '0',
			refundedRwf: '0',
			netRwf: '0',
			planTotals: [],
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

	it('does not expose a failed plan aggregate as an incomplete report', async () => {
		queryRaw.mockRejectedValue(new Error('private database detail'));
		await expect(service.summary(CONTEXT, QUERY)).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
	});

	it('exports all selected rows with confirmed refunds and tenant-scoped batches', async () => {
		const buffer = await service.pdf(CONTEXT, QUERY);
		expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
		expect(run).toHaveBeenCalledWith(CONTEXT, expect.any(Function), {
			maxWait: 5_000,
			timeout: 60_000,
		});
		expect(findUnique).toHaveBeenCalledWith({
			where: { id: CONTEXT.organizationId },
			select: { name: true },
		});
		expect(findMany).toHaveBeenCalledWith({
			where: {
				organizationId: CONTEXT.organizationId,
				occurredAt: {
					gte: new Date('2025-12-31T22:00:00.000Z'),
					lt: new Date('2026-01-31T22:00:00.000Z'),
				},
			},
			select: {
				id: true,
				receiptNumber: true,
				amountRwf: true,
				method: true,
				status: true,
				occurredAt: true,
				member: { select: { name: true } },
				refunds: {
					where: { status: OrganizationPaymentRefundStatus.CONFIRMED },
					select: { amountRwf: true },
				},
			},
			orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
			take: 201,
		});
	});

	it('continues the PDF export past an internal database batch', async () => {
		const firstBatch = Array.from({ length: 201 }, (_, index) => ({
			...PAYMENT,
			id: `payment-${String(index)}`,
			receiptNumber: `PAY-20260101-${String(index)}`,
		}));
		findMany.mockResolvedValueOnce(firstBatch).mockResolvedValueOnce([firstBatch[200] ?? PAYMENT]);
		const buffer = await service.pdf(CONTEXT, QUERY);
		expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
		expect(findMany).toHaveBeenCalledTimes(2);
		expect(findMany).toHaveBeenLastCalledWith(
			expect.objectContaining({ cursor: { id: 'payment-199' }, skip: 1 }),
		);
	});

	it('rejects an oversized export without returning a truncated PDF', async () => {
		findMany.mockResolvedValue(
			Array.from({ length: 201 }, (_, index) => ({ ...PAYMENT, id: `payment-${String(index)}` })),
		);
		await expect(service.pdf(CONTEXT, QUERY)).rejects.toMatchObject({ status: 413 });
	});
});
