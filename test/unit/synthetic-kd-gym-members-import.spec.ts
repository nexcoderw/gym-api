import { jest } from '@jest/globals';
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	assertImportedMembersMatchFixtures,
	assertProductionTarget,
	buildMemberInsertData,
	applyHistoricalMembers,
	runSerializableImportTransaction,
	writeImportManifestOnce,
} from '../../scripts/synthetic-data/kd-gym-members-import.mjs';
import {
	EXPECTED_PRODUCTION_DATABASE_HOST,
	EXPECTED_PRODUCTION_DATABASE_NAME,
	EXPECTED_GENERATION_SEED,
	KD_GYM_ORGANIZATION_ID,
} from '../../scripts/synthetic-data/kd-gym-members-preflight.mjs';

const TARGET = {
	target: 'production',
	databaseName: EXPECTED_PRODUCTION_DATABASE_NAME,
	host: EXPECTED_PRODUCTION_DATABASE_HOST,
	databaseMarker: 'nexcode-gym:bootstrap:724fbc40-515c-4a30-a4bb-8a6458a24396',
};
const APPROVAL = {
	manifestSha256: 'a'.repeat(64),
	approvalReference: 'APPROVAL-1',
	authorizedBy: 'authorized approver',
	authorizationConfirmed: true,
	operator: 'operator',
	syntheticRecordsAcknowledged: true,
	notificationSuppressionVerification: {
		verified: true,
		emailSuppression: true,
		smsSuppression: true,
		applicationProtectionVersion: 'kd-gym-member-notification-protection-v1',
	},
};
const BACKUP = { verified: true, reference: 'BACKUP-1', verifiedBy: 'operator' };
const DATASET = { valid: true, recordCount: 823, manifestSha256: APPROVAL.manifestSha256 };

describe('KD GYM production member import safeguards', () => {
	it('accepts only the approved production endpoint and database', () => {
		expect(() => {
			assertProductionTarget(TARGET);
		}).not.toThrow();
		expect(() => {
			assertProductionTarget({ ...TARGET, target: 'development' });
		}).toThrow();
		expect(() => {
			assertProductionTarget({ ...TARGET, databaseName: 'another-db' });
		}).toThrow();
		expect(() => {
			assertProductionTarget({ ...TARGET, host: 'localhost' });
		}).toThrow();
		expect(() => {
			assertProductionTarget({ ...TARGET, databaseMarker: undefined });
		}).toThrow();
	});

	it('maps synthetic identity, historical dates and durable email and SMS suppression', () => {
		const insertedAt = new Date('2026-11-13T10:00:00.000Z');
		const [member] = buildMemberInsertData([fixture()], insertedAt);
		expect(member).toMatchObject({
			id: '00000000-0000-5000-8000-000000000001',
			organizationId: KD_GYM_ORGANIZATION_ID,
			gender: 'FEMALE',
			isSynthetic: true,
			syntheticBatchId: EXPECTED_GENERATION_SEED,
			email: null,
			createdAt: insertedAt,
			updatedAt: insertedAt,
			reminderEmailSuppressedAt: insertedAt,
			reminderEmailSuppressionReason: 'MANUAL',
			reminderSmsSuppressedAt: insertedAt,
			reminderSmsSuppressionReason: 'MANUAL',
		});
		expect(member?.joinedOn).toEqual(new Date('2026-10-18T00:00:00.000Z'));
		expect(member).not.toHaveProperty('generationBatch');
		expect(member).not.toHaveProperty('subscription');
		expect(member).not.toHaveProperty('payment');
		expect(member).not.toHaveProperty('reminder');
	});

	it('rejects fixtures assigned to another organization before any transaction starts', async () => {
		const transaction = jest.fn();
		const prisma = { $transaction: transaction };
		expect(() => {
			buildMemberInsertData(
				[{ ...fixture(), organizationId: '11111111-1111-4111-8111-111111111111' }],
				new Date(),
			);
		}).toThrow(/organization/u);
		await expect(
			applyHistoricalMembers(
				prisma,
				{ ...TARGET, target: 'development' },
				[],
				DATASET,
				APPROVAL,
				BACKUP,
			),
		).rejects.toThrow(/production database/u);
		expect(transaction).not.toHaveBeenCalled();
	});

	it('refuses apply when dataset baseline or backup approval no longer matches', async () => {
		const transaction = jest.fn();
		const prisma = { $transaction: transaction };
		await expect(
			applyHistoricalMembers(
				prisma,
				TARGET,
				[],
				{ ...DATASET, recordCount: 822 },
				APPROVAL,
				BACKUP,
			),
		).rejects.toThrow(/fixtures, production approval and backup/u);
		await expect(
			applyHistoricalMembers(prisma, TARGET, [], DATASET, APPROVAL, null),
		).rejects.toThrow(/fixtures, production approval and backup/u);
		expect(transaction).not.toHaveBeenCalled();
	});

	it.each(['', 'wrong-seed', 'x'.repeat(121)])('rejects invalid batch identifiers: %s', (batch) => {
		expect(() => buildMemberInsertData([{ ...fixture(), generationBatch: batch }], new Date())).toThrow(
			/synthetic batch ID/u,
		);
	});

	it('verifies every inserted fixture and rejects altered suppression or joining data', () => {
		const insertedAt = new Date('2026-11-13T10:00:00.000Z');
		const fixtures = Array.from({ length: 823 }, (_, index) => ({
			...fixture(),
			id: `00000000-0000-5000-8000-${String(index + 1).padStart(12, '0')}`,
			joinedOn: '2026-10-18',
		}));
		const inserted = buildMemberInsertData(fixtures, insertedAt);
		expect(() => assertImportedMembersMatchFixtures(inserted, fixtures, insertedAt)).not.toThrow();
		const changed = [...inserted];
		changed[0] = { ...changed[0]!, reminderSmsSuppressedAt: null };
		expect(() => assertImportedMembersMatchFixtures(changed, fixtures, insertedAt)).toThrow(
			/verification failed/u,
		);
	});

	it('rejects apply before transaction when the application safeguard version is not approved', async () => {
		const transaction = jest.fn();
		const members = Array.from({ length: 823 }, (_, index) => ({
			...fixture(),
			id: `00000000-0000-5000-8000-${String(index + 1).padStart(12, '0')}`,
		}));
		await expect(
			applyHistoricalMembers(
				{ $transaction: transaction },
				TARGET,
				members,
				DATASET,
				{
					...APPROVAL,
					notificationSuppressionVerification: {
						...APPROVAL.notificationSuppressionVerification,
						applicationProtectionVersion: 'unreviewed',
					},
				},
				BACKUP,
			),
		).rejects.toThrow(/fixtures, production approval and backup/u);
		expect(transaction).not.toHaveBeenCalled();
	});

	it('creates a private import manifest once and refuses a duplicate checksum manifest', () => {
		const directory = mkdtempSync(join(tmpdir(), 'kd-gym-import-'));
		chmodSync(directory, 0o700);
		const path = join(directory, 'import-test.json');
		try {
			writeImportManifestOnce(path, { status: 'PREPARED' }, directory);
			expect(statSync(path).mode & 0o777).toBe(0o600);
			expect(() => {
				writeImportManifestOnce(path, { status: 'PREPARED' }, directory);
			}).toThrow(/unique private import manifest/u);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('propagates transaction failures so Prisma rolls the whole insert back', async () => {
		const rollback = jest.fn();
		const transactionOptions: unknown[] = [];
		const prisma = {
			$transaction: jest.fn(
				async (operation: (transaction: unknown) => Promise<unknown>, options: unknown) => {
					transactionOptions.push(options);
					try {
						return await operation({});
					} catch (error) {
						rollback();
						throw error;
					}
				},
			),
		};
		await expect(
			runSerializableImportTransaction(prisma, () =>
				Promise.reject(new Error('insert verification failed')),
			),
		).rejects.toThrow('insert verification failed');
		expect(rollback).toHaveBeenCalledTimes(1);
		expect(transactionOptions[0]).toEqual({
			isolationLevel: 'Serializable',
			timeout: 120_000,
		});
	});
});

function fixture() {
	return {
		id: '00000000-0000-5000-8000-000000000001',
		organizationId: KD_GYM_ORGANIZATION_ID,
		name: 'Synthetic Example',
		normalizedName: 'synthetic example',
		phoneNumber: '+250780000001',
		gender: 'FEMALE',
		email: null,
		joinedOn: '2026-10-18',
		synthetic: true,
		generationBatch: EXPECTED_GENERATION_SEED,
	};
}
