import { jest } from '@jest/globals';

import {
	assertBatchMatchesFixtures,
	makeStagingSummary,
	seedStagingMembers,
} from '../../scripts/synthetic-data/kd-gym-members-staging.mjs';
import { assertStagingDatabaseConfiguration } from '../../scripts/synthetic-data/seed-kd-gym-staging.mjs';
import { buildMemberInsertData } from '../../scripts/synthetic-data/kd-gym-members-import.mjs';
import {
	EXPECTED_GENERATION_SEED,
	KD_GYM_ORGANIZATION_ID,
} from '../../scripts/synthetic-data/kd-gym-members-preflight.mjs';

const INSERTED_AT = new Date('2026-11-13T10:00:00.000Z');
const MEMBERS = makeFixtures();
const COLUMNS: Array<[string, string]> = [
	['organizations', 'id'],
	['organizations', 'name'],
	...[
		'id',
		'organization_id',
		'name',
		'normalized_name',
		'phone_number',
		'email',
		'joined_on',
		'gender',
		'is_synthetic',
		'synthetic_batch_id',
		'reminder_email_suppressed_at',
		'reminder_email_suppression_reason',
		'reminder_sms_suppressed_at',
		'reminder_sms_suppression_reason',
		'created_at',
		'updated_at',
	].map((column): [string, string] => ['organization_members', column]),
];

describe('KD GYM staging member seed', () => {
	it('accepts only the named PostgreSQL staging database configuration', () => {
		expect(() =>
			assertStagingDatabaseConfiguration(
				'postgresql://staging-user:test-password@staging.example.invalid/neondb?sslmode=require',
			),
		).not.toThrow();
		expect(() =>
			assertStagingDatabaseConfiguration('postgresql://user:pass@localhost/other'),
		).toThrow();
		expect(() => assertStagingDatabaseConfiguration('https://example.invalid/neondb')).toThrow();
	});

	it('maps fixtures to durable synthetic identity and email/SMS suppression fields', () => {
		const [member] = buildMemberInsertData([MEMBERS[0]], INSERTED_AT);
		expect(member).toMatchObject({
			id: MEMBERS[0].id,
			organizationId: KD_GYM_ORGANIZATION_ID,
			name: MEMBERS[0].name,
			normalizedName: MEMBERS[0].normalizedName,
			phoneNumber: MEMBERS[0].phoneNumber,
			email: null,
			gender: MEMBERS[0].gender,
			isSynthetic: true,
			syntheticBatchId: EXPECTED_GENERATION_SEED,
			createdAt: INSERTED_AT,
			updatedAt: INSERTED_AT,
			reminderEmailSuppressedAt: INSERTED_AT,
			reminderEmailSuppressionReason: 'MANUAL',
			reminderSmsSuppressedAt: INSERTED_AT,
			reminderSmsSuppressionReason: 'MANUAL',
		});
		expect(member?.joinedOn).toEqual(new Date(`${MEMBERS[0].joinedOn}T00:00:00.000Z`));
	});

	it('preserves the existing member and inserts all fixtures in a tenant-scoped transaction', async () => {
		const prisma = makePrisma();
		const result = await seedStagingMembers(prisma, MEMBERS, INSERTED_AT);

		expect(result).toEqual({ status: 'INSERTED', insertedCount: 823, totalCount: 824 });
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: 'Serializable',
			timeout: 120_000,
		});
		expect(prisma.organizationMember.count).toHaveBeenNthCalledWith(1, {
			where: { organizationId: KD_GYM_ORGANIZATION_ID },
		});
		expect(prisma.organizationMember.createMany).toHaveBeenCalledWith({
			data: expect.arrayContaining([expect.objectContaining({ id: MEMBERS[0].id })]),
			skipDuplicates: false,
		});
	});

	it('rolls back if fixture insertion fails', async () => {
		const prisma = makePrisma({ failInsert: true });
		await expect(seedStagingMembers(prisma, MEMBERS, INSERTED_AT)).rejects.toThrow();
		expect(prisma.rollbackObserved()).toBe(true);
	});

	it('treats only an exact complete existing batch as an idempotent rerun', async () => {
		const existing = buildMemberInsertData(MEMBERS, INSERTED_AT);
		const prisma = makePrisma({ existingCount: 824, existingBatch: existing });

		await expect(seedStagingMembers(prisma, MEMBERS, INSERTED_AT)).resolves.toEqual({
			status: 'ALREADY_SEEDED',
			insertedCount: 0,
			totalCount: 824,
		});
		expect(prisma.organizationMember.createMany).not.toHaveBeenCalled();
	});

	it('refuses a partial batch without overwriting member records', async () => {
		const prisma = makePrisma({ existingCount: 2, existingBatch: [{ id: MEMBERS[0].id }] });
		await expect(seedStagingMembers(prisma, MEMBERS, INSERTED_AT)).rejects.toThrow(/partial/u);
		expect(prisma.organizationMember.createMany).not.toHaveBeenCalled();
	});

	it('validates the exact stored batch and prints a concise aggregate summary', () => {
		const inserted = buildMemberInsertData(MEMBERS, INSERTED_AT);
		expect(() => assertBatchMatchesFixtures(inserted, MEMBERS, INSERTED_AT)).not.toThrow();
		expect(
			makeStagingSummary(
				{ status: 'INSERTED', insertedCount: 823, totalCount: 824 },
				MEMBERS,
			),
		).toMatchObject({
			database: 'neondb',
			organization: 'KD GYM',
			existingMembersPreserved: 1,
			syntheticMembersInserted: 823,
			totalMembers: 824,
			maleSyntheticMembers: 709,
			femaleSyntheticMembers: 114,
			earliestJoiningDate: '2025-10-18',
			latestJoiningDate: '2026-11-12',
			transactionStatus: 'INSERTED',
		});
	});
});

function makeFixtures() {
	return Array.from({ length: 823 }, (_, offset) => {
		const index = offset + 1;
		const joinedOn = index === 1 ? '2025-10-18' : index === 823 ? '2026-11-12' : '2026-06-15';
		return {
			id: `00000000-0000-5000-8000-${String(index).padStart(12, '0')}`,
			organizationId: KD_GYM_ORGANIZATION_ID,
			name: `Fixture Member ${index}`,
			normalizedName: `fixture member ${index}`,
			phoneNumber: `+25078${String(index).padStart(7, '0')}`,
			gender: index <= 709 ? 'MALE' : 'FEMALE',
			email: null,
			joinedOn,
			synthetic: true,
			generationBatch: EXPECTED_GENERATION_SEED,
		};
	});
}

function makePrisma({ existingCount = 1, existingBatch = [], failInsert = false } = {}) {
	let rollbackObserved = false;
	const inserted = buildMemberInsertData(MEMBERS, INSERTED_AT);
	const organizationMember = {
		count: jest
			.fn<(args: unknown) => Promise<number>>()
			.mockResolvedValueOnce(existingCount)
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(824),
		findMany: jest
			.fn<(args: unknown) => Promise<unknown[]>>()
			.mockResolvedValueOnce(existingBatch)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(inserted),
		createMany: jest
			.fn<(args: unknown) => Promise<{ count: number }>>()
			.mockImplementation(async () => {
				if (failInsert) throw new Error('simulated insert failure');
				return { count: 823 };
			}),
	};
	const transaction = {
		$queryRaw: jest
			.fn<
				(
					query: TemplateStringsArray,
					...values: unknown[]
				) => Promise<{ table_name: string; column_name: string }[]>
			>()
			.mockResolvedValue(
				COLUMNS.map(([table_name, column_name]) => ({ table_name, column_name })),
			),
		organization: {
			findUnique: jest
				.fn<(args: unknown) => Promise<{ id: string; name: string }>>()
				.mockResolvedValue({ id: KD_GYM_ORGANIZATION_ID, name: 'KD GYM' }),
		},
		organizationMember,
	};
	const $transaction = jest
		.fn<
			(
				operation: (value: typeof transaction) => Promise<unknown>,
				options: { isolationLevel: string; timeout: number },
			) => Promise<unknown>
		>()
		.mockImplementation(async (operation: (value: typeof transaction) => Promise<unknown>) => {
			try {
				return await operation(transaction);
			} catch (error) {
				rollbackObserved = true;
				throw error;
			}
		});
	return {
		$transaction,
		organizationMember,
		rollbackObserved: () => rollbackObserved,
	};
}
