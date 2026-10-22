import { randomUUID } from 'node:crypto';

import {
	MemberPeriodUnit,
	OrganizationPaymentMethod,
	OrganizationPaymentRefundStatus,
	OrganizationPaymentStatus,
	OrganizationStatus,
	PrismaService,
	type Prisma,
	type TenantTransactionService,
} from '@nexcoderw/gym-db';

import { OwnerDashboardAnalyticsService } from '../../src/modules/owner/dashboard/owner-dashboard-analytics.service.js';
import { OwnerPaymentReportsService } from '../../src/modules/owner/reports/owner-payment-reports.service.js';

// Never connect during the ordinary suite. The opt-in target must be the marked gym_test DB.
const postgresDescribe =
	process.env.OWNER_DASHBOARD_POSTGRES_TESTS === '1' ? describe : describe.skip;
jest.setTimeout(120_000);

postgresDescribe('owner dashboard aggregates in disposable PostgreSQL', () => {
	let prisma: PrismaService;
	const gymId = randomUUID();
	const otherGymId = randomUUID();
	const actorId = randomUUID();
	const memberIds = [randomUUID(), randomUUID(), randomUUID()] as const;
	const planIds = [randomUUID(), randomUUID(), randomUUID()] as const;
	const subscriptionIds = [randomUUID(), randomUUID(), randomUUID()] as const;
	const paymentIds = [
		randomUUID(),
		randomUUID(),
		randomUUID(),
		randomUUID(),
		randomUUID(),
	] as const;
	const allocationIds = [
		randomUUID(),
		randomUUID(),
		randomUUID(),
		randomUUID(),
		randomUUID(),
	] as const;
	const refundId = randomUUID();
	const context = { organizationId: gymId, actorUserId: actorId, requestId: randomUUID() };
	let verified = false;
	let disconnect: (() => Promise<void>) | undefined;

	beforeAll(async () => {
		const databaseUrl = process.env.TEST_DATABASE_URL;
		const marker = process.env.TEST_DATABASE_MARKER;
		if (databaseUrl === undefined || marker === undefined) {
			throw new Error('TEST_DATABASE_URL and TEST_DATABASE_MARKER are required.');
		}
		const target = new URL(databaseUrl);
		const databaseName = decodeURIComponent(target.pathname.slice(1));
		const databaseUser = decodeURIComponent(target.username);
		if (
			!['postgres:', 'postgresql:'].includes(target.protocol) ||
			databaseName !== 'gym_test' ||
			!databaseUser.includes('test') ||
			!/^[-0-9a-f]{36}$/iu.test(marker) ||
			/(?:prod|production|live)/iu.test(`${target.hostname}/${databaseUser}`)
		) {
			throw new Error('A restricted, marked gym_test database is required.');
		}
		for (const name of ['DATABASE_URL', 'DIRECT_DATABASE_URL', 'SHADOW_DATABASE_URL']) {
			const value = process.env[name];
			if (value === undefined) continue;
			const reference = new URL(value);
			if (
				reference.hostname.replace('-pooler.', '.') === target.hostname.replace('-pooler.', '.') &&
				decodeURIComponent(reference.pathname) === decodeURIComponent(target.pathname)
			) {
				throw new Error(`TEST_DATABASE_URL must be separate from ${name}.`);
			}
		}
		prisma = new PrismaService({
			databaseUrl,
			poolMax: 3,
			connectionTimeoutMilliseconds: 30_000,
		});
		disconnect = () => prisma.$disconnect();
		await prisma.$connect();
		const identity = await prisma.$queryRaw<
			{
				name: string;
				role: string;
				comment: string | null;
				privileged: boolean;
			}[]
		>`
			SELECT current_database() AS name, current_user AS role,
				pg_catalog.shobj_description(d.oid, 'pg_database') AS comment,
				(r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
					OR r.rolbypassrls OR has_database_privilege(current_user, current_database(), 'CREATE')
					OR has_schema_privilege(current_user, 'public', 'CREATE')) AS privileged
			FROM pg_catalog.pg_database AS d
			JOIN pg_catalog.pg_roles AS r ON r.rolname = current_user
			WHERE d.datname = current_database()
		`;
		if (identity.length !== 1) {
			throw new Error('Connected database failed the disposable test database safety check.');
		}
		const connected = identity[0];
		if (
			connected.name !== databaseName ||
			connected.role !== databaseUser ||
			connected.comment !== `nexcode-gym:disposable-integration-test:${marker}` ||
			connected.privileged
		) {
			throw new Error('Connected database failed the disposable test database safety check.');
		}
		verified = true;
	}, 60_000);

	afterAll(async () => {
		await disconnect?.();
	});

	it('reconciles selected and comparison totals while excluding another gym', async () => {
		if (!verified) throw new Error('The test database was not verified.');
		const rollback = new Error('ROLL_BACK_DASHBOARD_FIXTURE');
		let assertionsCompleted = false;
		try {
			await prisma.$transaction(
				async (transaction) => {
					await seedFixture(transaction);
					await transaction.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
					// Both services must read the same uncommitted fixture; the ledger is append-only.
					const tenants = {
						run: async <T>(
							scope: { organizationId: string },
							operation: (client: Prisma.TransactionClient) => Promise<T>,
						): Promise<T> => {
							await transaction.$queryRaw`
							SELECT set_config('app.current_organization_id', ${scope.organizationId}, true)
						`;
							return operation(transaction);
						},
					} as unknown as TenantTransactionService;
					const dashboard = new OwnerDashboardAnalyticsService(tenants);
					const reports = new OwnerPaymentReportsService(tenants);
					const query = { fromDate: '2026-10-01', toDate: '2026-10-10' };
					const result = await dashboard.get(context, query, new Date('2026-10-22T08:00:00Z'));
					const selectedReport = await reports.summary(context, query);
					const comparisonReport = await reports.summary(context, {
						fromDate: result.period.comparisonFromDate,
						toDate: result.period.comparisonToDate,
					});

					expect(result.metrics.netCollected.currentRwf).toBe(selectedReport.netRwf);
					expect(result.metrics.netCollected.previousRwf).toBe(comparisonReport.netRwf);
					expect(result.metrics.settledPayments.current).toBe(selectedReport.settledPaymentCount);
					expect(result.metrics.settledPayments.previous).toBe(
						comparisonReport.settledPaymentCount,
					);
					expect(selectedReport.paymentCount).toBe(3);
					expect(result.metrics.netCollected.currentRwf).toBe('28000');
					expect(result.metrics.netCollected.previousRwf).toBe('5000');
					expect(result.metrics.newMembers).toMatchObject({ current: 1, previous: 1 });
					expect(result.metrics.activeSubscribers).toMatchObject({ current: 2, previous: 1 });
					expect(result.planTotals.reduce((sum, row) => sum + BigInt(row.grossRwf), 0n)).toBe(
						30000n,
					);
					expect(result.methodTotals.reduce((sum, row) => sum + BigInt(row.grossRwf), 0n)).toBe(
						30000n,
					);
					expect(result.revenueSeries.reduce((sum, row) => sum + BigInt(row.netRwf), 0n)).toBe(
						28000n,
					);
					expect(result.revenueSeries).toHaveLength(10);
					expect(result.planTotals).toHaveLength(2);
					expect(result.methodTotals).toHaveLength(2);
					assertionsCompleted = true;
					throw rollback;
				},
				{ maxWait: 30_000, timeout: 120_000 },
			);
		} catch (error: unknown) {
			if (error !== rollback) throw error;
		}
		expect(assertionsCompleted).toBe(true);
	});

	async function seedFixture(transaction: Prisma.TransactionClient): Promise<void> {
		const september = new Date('2026-09-25T08:00:00Z');
		const october = new Date('2026-10-02T08:00:00Z');
		await transaction.organization.createMany({
			data: [gymId, otherGymId].map((id) => ({
				id,
				name: 'Fictional Dashboard Test Gym',
				slug: `dashboard-test-${id}`,
				status: OrganizationStatus.ACTIVE,
				activatedAt: september,
				createdAt: september,
				updatedAt: september,
			})),
		});
		await transaction.user.create({
			data: { id: actorId, email: `${actorId}@example.invalid`, displayName: 'Test Operator' },
		});
		await transaction.organizationMembershipPlan.createMany({
			data: [
				{
					id: planIds[0],
					organizationId: gymId,
					name: 'Bronze',
					normalizedName: 'bronze',
					priceRwf: 10000n,
				},
				{
					id: planIds[1],
					organizationId: gymId,
					name: 'Gold',
					normalizedName: 'gold',
					priceRwf: 20000n,
				},
				{
					id: planIds[2],
					organizationId: otherGymId,
					name: 'Other',
					normalizedName: 'other',
					priceRwf: 900000n,
				},
			].map((plan) => ({
				...plan,
				createdAt: september,
				updatedAt: september,
			})),
		});
		await transaction.organizationMember.createMany({
			data: [
				{
					id: memberIds[0],
					organizationId: gymId,
					name: 'Member One',
					normalizedName: 'member one',
					phoneNumber: '+250700000101',
					createdAt: september,
					updatedAt: september,
				},
				{
					id: memberIds[1],
					organizationId: gymId,
					name: 'Member Two',
					normalizedName: 'member two',
					phoneNumber: '+250700000102',
					createdAt: october,
					updatedAt: october,
				},
				{
					id: memberIds[2],
					organizationId: otherGymId,
					name: 'Other Member',
					normalizedName: 'other member',
					phoneNumber: '+250700000103',
					createdAt: october,
					updatedAt: october,
				},
			],
		});
		await transaction.organizationMemberSubscription.createMany({
			data: [
				{
					id: subscriptionIds[0],
					memberId: memberIds[0],
					membershipPlanId: planIds[0],
					planName: 'Bronze',
					priceRwf: 10000n,
					startDate: new Date('2026-09-25'),
					endDate: new Date('2026-10-24'),
					createdAt: september,
					updatedAt: september,
				},
				{
					id: subscriptionIds[1],
					memberId: memberIds[1],
					membershipPlanId: planIds[1],
					planName: 'Gold',
					priceRwf: 20000n,
					startDate: new Date('2026-10-02'),
					endDate: new Date('2026-11-01'),
					createdAt: october,
					updatedAt: october,
				},
				{
					id: subscriptionIds[2],
					memberId: memberIds[2],
					membershipPlanId: planIds[2],
					planName: 'Other',
					priceRwf: 900000n,
					startDate: new Date('2026-10-02'),
					endDate: new Date('2026-11-01'),
					createdAt: october,
					updatedAt: october,
				},
			].map((subscription, index) => ({
				...subscription,
				organizationId: index === 2 ? otherGymId : gymId,
				periodUnit: MemberPeriodUnit.MONTHS,
				periodCount: 1,
				idempotencyKey: randomUUID(),
				requestFingerprint: 'a'.repeat(64),
				createdByUserId: actorId,
			})),
		});
		const payments = [
			{
				id: paymentIds[0],
				organizationId: gymId,
				memberId: memberIds[0],
				amountRwf: 5000n,
				method: OrganizationPaymentMethod.CASH,
				status: OrganizationPaymentStatus.CONFIRMED,
				occurredAt: new Date('2026-09-28T08:00:00Z'),
			},
			{
				id: paymentIds[1],
				organizationId: gymId,
				memberId: memberIds[0],
				amountRwf: 10000n,
				method: OrganizationPaymentMethod.CASH,
				status: OrganizationPaymentStatus.PARTIALLY_REFUNDED,
				occurredAt: new Date('2026-10-03T08:00:00Z'),
			},
			{
				id: paymentIds[2],
				organizationId: gymId,
				memberId: memberIds[1],
				amountRwf: 20000n,
				method: OrganizationPaymentMethod.MOBILE_MONEY,
				status: OrganizationPaymentStatus.CONFIRMED,
				occurredAt: new Date('2026-10-04T08:00:00Z'),
			},
			{
				id: paymentIds[3],
				organizationId: otherGymId,
				memberId: memberIds[2],
				amountRwf: 900000n,
				method: OrganizationPaymentMethod.CASH,
				status: OrganizationPaymentStatus.CONFIRMED,
				occurredAt: new Date('2026-10-05T08:00:00Z'),
			},
			{
				id: paymentIds[4],
				organizationId: gymId,
				memberId: memberIds[1],
				amountRwf: 7000n,
				method: OrganizationPaymentMethod.CASH,
				status: OrganizationPaymentStatus.PENDING,
				occurredAt: new Date('2026-10-06T08:00:00Z'),
			},
		] as const;
		await transaction.organizationPayment.createMany({
			data: payments.map((payment) => ({
				...payment,
				receiptNumber:
					`PAY-${payment.occurredAt.toISOString().slice(0, 10).replaceAll('-', '')}` +
					`-${payment.id.slice(0, 8).toUpperCase()}`,
				providerReference: payment.method === OrganizationPaymentMethod.CASH ? null : payment.id,
				confirmedAt:
					payment.status === OrganizationPaymentStatus.PENDING ? null : payment.occurredAt,
				createdAt: payment.occurredAt,
				updatedAt: payment.occurredAt,
				idempotencyKey: randomUUID(),
				requestFingerprint: 'b'.repeat(64),
				recordedByUserId: actorId,
			})),
		});
		await transaction.organizationPaymentAllocation.createMany({
			data: [
				{
					id: allocationIds[0],
					paymentId: paymentIds[0],
					memberId: memberIds[0],
					memberSubscriptionId: subscriptionIds[0],
					amountRwf: 5000n,
				},
				{
					id: allocationIds[1],
					paymentId: paymentIds[1],
					memberId: memberIds[0],
					memberSubscriptionId: subscriptionIds[0],
					amountRwf: 10000n,
				},
				{
					id: allocationIds[2],
					paymentId: paymentIds[2],
					memberId: memberIds[1],
					memberSubscriptionId: subscriptionIds[1],
					amountRwf: 20000n,
				},
				{
					id: allocationIds[3],
					paymentId: paymentIds[3],
					memberId: memberIds[2],
					memberSubscriptionId: subscriptionIds[2],
					amountRwf: 900000n,
				},
				{
					id: allocationIds[4],
					paymentId: paymentIds[4],
					memberId: memberIds[1],
					memberSubscriptionId: subscriptionIds[1],
					amountRwf: 7000n,
				},
			].map((allocation, index) => ({
				...allocation,
				organizationId: index === 3 ? otherGymId : gymId,
			})),
		});
		await transaction.organizationPaymentRefund.create({
			data: {
				id: refundId,
				organizationId: gymId,
				paymentId: paymentIds[1],
				memberId: memberIds[0],
				amountRwf: 2000n,
				status: OrganizationPaymentRefundStatus.CONFIRMED,
				reason: 'Fictional test adjustment',
				idempotencyKey: randomUUID(),
				requestFingerprint: 'c'.repeat(64),
				requestedByUserId: actorId,
				confirmedAt: new Date('2026-10-06T08:00:00Z'),
				createdAt: new Date('2026-10-06T08:00:00Z'),
				updatedAt: new Date('2026-10-06T08:00:00Z'),
			},
		});
	}
});
