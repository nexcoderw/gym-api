import { randomUUID } from 'node:crypto';
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
	EXPECTED_PRODUCTION_DATABASE_HOST,
	EXPECTED_PRODUCTION_DATABASE_NAME,
	KD_GYM_ORGANIZATION_ID,
	PRODUCTION_APPROVAL_DIRECTORY,
	SMS_NOTIFICATION_SUPPRESSION_SUPPORTED,
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
		!approval.syntheticRecordsAcknowledged ||
		!approval.notificationSuppressionVerification?.verified
	) {
		throw new Error(
			'Fresh validated fixtures, production approval and backup attestation are required.',
		);
	}
	if (!SMS_NOTIFICATION_SUPPRESSION_SUPPORTED) {
		throw new Error(
			'APPLY is blocked until durable database-backed SMS suppression is available for synthetic members.',
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
			const verified = await transaction.organizationMember.count({
				where: {
					organizationId: KD_GYM_ORGANIZATION_ID,
					id: { in: members.map(({ id }) => id) },
					reminderEmailSuppressionReason: 'MANUAL',
					reminderEmailSuppressedAt: insertedAt,
				},
			});
			if (verified !== 823) {
				throw new Error('Inserted synthetic member verification failed.');
			}
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
		return {
			id: member.id,
			organizationId: KD_GYM_ORGANIZATION_ID,
			name: member.name,
			normalizedName: member.normalizedName,
			phoneNumber: member.phoneNumber,
			email: null,
			gender: member.gender,
			joinedOn: new Date(`${member.joinedOn}T00:00:00.000Z`),
			createdAt: insertedAt,
			updatedAt: insertedAt,
			reminderEmailSuppressedAt: insertedAt,
			reminderEmailSuppressionReason: 'MANUAL',
		};
	});
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
