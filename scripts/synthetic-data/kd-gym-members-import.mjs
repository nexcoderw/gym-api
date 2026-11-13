import { randomUUID } from 'node:crypto';
import {
	OrganizationMemberEmailSuppressionReason,
	OrganizationMemberSmsSuppressionReason,
} from '@nexcoderw/gym-db';
import {
	closeSync,
	constants as fsConstants,
	fchmodSync,
	fsyncSync,
	lstatSync,
	openSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
	EXPECTED_DATE_RANGE,
	EXPECTED_FINAL_MEMBER_COUNT,
	EXPECTED_GENERATION_SEED,
	APPLICATION_NOTIFICATION_PROTECTION_VERSION,
	EXPECTED_PRODUCTION_DATABASE_HOST,
	EXPECTED_PRODUCTION_DATABASE_NAME,
	KD_GYM_ORGANIZATION_ID,
	PRODUCTION_APPROVAL_DIRECTORY,
	inspectDatabaseTransaction,
} from './kd-gym-members-preflight.mjs';

/**
 * Production-only transactional importer. This function is called only by explicit --apply mode.
 */
export async function applyHistoricalMembers(
	prisma,
	target,
	members,
	datasetReport,
	approval,
	backup,
) {
	assertProductionTarget(target);
	if (
		!datasetReport.valid ||
		datasetReport.recordCount !== 823 ||
		datasetReport.manifestSha256 !== approval.manifestSha256 ||
		members.length !== 823 ||
		backup?.verified !== true ||
		!backup?.reference ||
		!backup?.verifiedBy ||
		!approval.authorizationConfirmed ||
		!approval.approvalReference ||
		!approval.authorizedBy ||
		!approval.operator ||
		!approval.syntheticRecordsAcknowledged ||
		!approval.notificationSuppressionVerification?.verified ||
		!approval.notificationSuppressionVerification.emailSuppression ||
		!approval.notificationSuppressionVerification.smsSuppression ||
		approval.notificationSuppressionVerification.applicationProtectionVersion !==
			APPLICATION_NOTIFICATION_PROTECTION_VERSION
	) {
		throw new Error(
			'Fresh validated fixtures, production approval and backup attestation are required.',
		);
	}
	const manifestPath = join(
		PRODUCTION_APPROVAL_DIRECTORY,
		`import-${datasetReport.manifestSha256}.json`,
	);
	const prepared = {
		version: 1,
		status: 'PREPARED',
		organizationId: KD_GYM_ORGANIZATION_ID,
		productionDatabase: {
			host: EXPECTED_PRODUCTION_DATABASE_HOST,
			name: EXPECTED_PRODUCTION_DATABASE_NAME,
		},
		syntheticBatchId: EXPECTED_GENERATION_SEED,
		dateRange: EXPECTED_DATE_RANGE,
		datasetManifestSha256: datasetReport.manifestSha256,
		approvalReference: approval.approvalReference,
		operator: approval.operator,
		backupReference: backup.reference,
		preparedAt: new Date().toISOString(),
	};
	writeImportManifestOnce(manifestPath, prepared);
	const insertedAt = new Date();
	try {
		const result = await runSerializableImportTransaction(prisma, async (transaction) => {
			await transaction.$executeRaw`SET TRANSACTION READ WRITE`;
			const fresh = await inspectDatabaseTransaction(
				transaction,
				target,
				members,
				datasetReport,
				approval,
				{ expectedReadOnly: false, lockOrganization: true },
			);
			if (!fresh.safeToProceedToSeparatelyApprovedImport) {
				throw new Error('Fresh in-transaction production baseline validation failed.');
			}
			const data = buildMemberInsertData(members, insertedAt);
			const insertion = await transaction.organizationMember.createMany({
				data,
				skipDuplicates: false,
			});
			if (insertion.count !== 823) {
				throw new Error('Unexpected inserted member count; aborting transaction.');
			}
			const finalCount = await transaction.organizationMember.count({
				where: { organizationId: KD_GYM_ORGANIZATION_ID },
			});
			if (finalCount !== EXPECTED_FINAL_MEMBER_COUNT) {
				throw new Error(
					'Post-insert organization member total did not match the approved baseline.',
				);
			}
			const insertedMembers = await transaction.organizationMember.findMany({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					id: { in: members.map(({ id }) => id) },
				},
				select: {
					id: true,
					organizationId: true,
					isSynthetic: true,
					syntheticBatchId: true,
					name: true,
					normalizedName: true,
					phoneNumber: true,
					gender: true,
					joinedOn: true,
					email: true,
					createdAt: true,
					updatedAt: true,
					reminderEmailSuppressedAt: true,
					reminderEmailSuppressionReason: true,
					reminderSmsSuppressedAt: true,
					reminderSmsSuppressionReason: true,
				},
			});
			assertImportedMembersMatchFixtures(insertedMembers, members, insertedAt);
			return { insertedCount: insertion.count, finalMemberCount: finalCount };
		});
		const committed = {
			...prepared,
			status: 'COMMITTED',
			importedAt: insertedAt.toISOString(),
			insertedCount: result.insertedCount,
			finalMemberCount: result.finalMemberCount,
			fixtureIds: members.map(({ id }) => id),
		};
		writePrivateJsonReplace(manifestPath, committed);
		return { ...result, importManifest: manifestPath };
	} catch (error) {
		// PREPARED is intentionally durable: an operator must reconcile ambiguous connection failures.
		throw error;
	}
}

export function buildMemberInsertData(members, insertedAt) {
	return members.map((member) => {
		if (member.organizationId !== KD_GYM_ORGANIZATION_ID || member.synthetic !== true) {
			throw new Error('Fixture organization or synthetic marker did not match the approved scope.');
		}
		if (
			typeof member.generationBatch !== 'string' ||
			member.generationBatch !== EXPECTED_GENERATION_SEED ||
			member.generationBatch.trim().length === 0 ||
			member.generationBatch.length > 120
		) {
			throw new Error('Fixture synthetic batch ID does not match the approved nonempty batch.');
		}
		return {
			id: member.id,
			organizationId: KD_GYM_ORGANIZATION_ID,
			name: member.name,
			normalizedName: member.normalizedName,
			phoneNumber: member.phoneNumber,
			email: null,
			gender: member.gender,
			joinedOn: new Date(`${member.joinedOn}T00:00:00.000Z`),
			isSynthetic: true,
			syntheticBatchId: member.generationBatch,
			createdAt: insertedAt,
			updatedAt: insertedAt,
			reminderEmailSuppressedAt: insertedAt,
			reminderEmailSuppressionReason: OrganizationMemberEmailSuppressionReason.MANUAL,
			reminderSmsSuppressedAt: insertedAt,
			reminderSmsSuppressionReason: OrganizationMemberSmsSuppressionReason.MANUAL,
		};
	});
}

export function assertImportedMembersMatchFixtures(insertedMembers, members, insertedAt) {
	if (insertedMembers.length !== members.length || members.length !== 823) {
		throw new Error('Inserted synthetic member verification failed.');
	}
	const expectedById = new Map(members.map((member) => [member.id, member]));
	for (const inserted of insertedMembers) {
		const fixture = expectedById.get(inserted.id);
		if (
			fixture === undefined ||
			inserted.organizationId !== KD_GYM_ORGANIZATION_ID ||
			inserted.isSynthetic !== true ||
			inserted.syntheticBatchId !== EXPECTED_GENERATION_SEED ||
			inserted.name !== fixture.name ||
			inserted.normalizedName !== fixture.normalizedName ||
			inserted.phoneNumber !== fixture.phoneNumber ||
			inserted.gender !== fixture.gender ||
			inserted.joinedOn?.toISOString().slice(0, 10) !== fixture.joinedOn ||
			inserted.email !== null ||
			inserted.createdAt.getTime() !== insertedAt.getTime() ||
			inserted.updatedAt.getTime() !== insertedAt.getTime() ||
			inserted.reminderEmailSuppressedAt?.getTime() !== insertedAt.getTime() ||
			inserted.reminderEmailSuppressionReason !==
				OrganizationMemberEmailSuppressionReason.MANUAL ||
			inserted.reminderSmsSuppressedAt?.getTime() !== insertedAt.getTime() ||
			inserted.reminderSmsSuppressionReason !== OrganizationMemberSmsSuppressionReason.MANUAL
		) {
			throw new Error('Inserted synthetic member verification failed.');
		}
	}
}

export function runSerializableImportTransaction(prisma, operation) {
	return prisma.$transaction(operation, {
		isolationLevel: 'Serializable',
		timeout: 120_000,
	});
}

export function assertProductionTarget(target) {
	if (
		target?.target !== 'production' ||
		target?.databaseName !== EXPECTED_PRODUCTION_DATABASE_NAME ||
		target?.host !== EXPECTED_PRODUCTION_DATABASE_HOST ||
		!/^nexcode-gym:bootstrap:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
			target?.databaseMarker ?? '',
		)
	) {
		throw new Error('Refusing member import outside the explicitly approved production database.');
	}
}

function validatePrivateDirectory(directory = PRODUCTION_APPROVAL_DIRECTORY) {
	try {
		const metadata = lstatSync(directory);
		if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700)
			throw new Error('unprotected');
	} catch {
		throw new Error('The private import directory must exist with owner-only mode 0700.');
	}
}

export function writeImportManifestOnce(path, value, directory = PRODUCTION_APPROVAL_DIRECTORY) {
	validatePrivateDirectory(directory);
	let descriptor;
	try {
		descriptor = openSync(
			path,
			fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
			0o600,
		);
		writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
		fchmodSync(descriptor, 0o600);
		fsyncSync(descriptor);
		fsyncPrivateDirectory(directory);
	} catch {
		throw new Error(
			'Unable to create a unique private import manifest; duplicate or unsafe import state.',
		);
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
	}
}

function writePrivateJsonReplace(path, value) {
	validatePrivateDirectory();
	const temporary = join(PRODUCTION_APPROVAL_DIRECTORY, `.import-${randomUUID()}.tmp`);
	let descriptor;
	try {
		descriptor = openSync(
			temporary,
			fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
			0o600,
		);
		writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
		fchmodSync(descriptor, 0o600);
		fsyncSync(descriptor);
		closeSync(descriptor);
		descriptor = undefined;
		renameSync(temporary, path);
		fsyncPrivateDirectory();
	} catch {
		throw new Error(
			'Database commit completed but durable manifest finalization failed; reconcile before retry.',
		);
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
	}
}

function fsyncPrivateDirectory(directory) {
	const descriptor = openSync(directory, fsConstants.O_RDONLY);
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}
