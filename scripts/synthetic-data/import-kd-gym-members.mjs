import {
	inspectDatabase,
	loadProductionApprovalArtifact,
	PreflightConfigurationError,
	resolveDatabaseTarget,
	validateFixtureFiles,
} from './kd-gym-members-preflight.mjs';
import { applyHistoricalMembers } from './kd-gym-members-import.mjs';

const APPLY_CONFIRMATION = 'KD-GYM-PRODUCTION-IMPORT-824';

async function main(args) {
	let apply = false;
	let confirmation;
	const targetArgs = [];
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === '--apply') {
			apply = true;
		} else if (args[index] === '--confirm-production-import') {
			confirmation = args[index + 1];
			index += 1;
		} else {
			targetArgs.push(args[index]);
		}
	}
	const fixture = validateFixtureFiles();
	if (!fixture.report.valid) {
		const failedChecks = Object.entries(fixture.report.checks)
			.filter(([, passed]) => passed !== true)
			.map(([name]) => `FIXTURE_${name.toUpperCase()}`);
		printReport({
			mode: apply ? 'APPLY' : 'DRY_RUN',
			dataset: fixture.report,
			blockers: failedChecks.length > 0 ? failedChecks : ['FIXTURE_VALIDATION_FAILED'],
			plannedInsertCount: 0,
			writesPerformed: false,
		});
		process.exitCode = 2;
		return;
	}
	const target = resolveDatabaseTarget([...targetArgs, '--allow-production-read-only']);
	const approval = loadProductionApprovalArtifact(
		fixture.report.manifestSha256,
		target.databaseMarker,
	);
	const backup = apply ? approval.productionBackupVerification : null;
	if (apply && confirmation !== APPLY_CONFIRMATION) {
		throw new PreflightConfigurationError(
			'PRODUCTION_APPLY_CONFIRMATION_REQUIRED',
			`APPLY requires --confirm-production-import ${APPLY_CONFIRMATION}.`,
		);
	}
	const { NestFactory } = await import('@nestjs/core');
	const { DatabaseModule, PrismaService, loadDatabaseConfig } = await import('@nexcoderw/gym-db');
	const databaseConfig = loadDatabaseConfig({
		DATABASE_URL: target.databaseUrl,
		DATABASE_POOL_MAX: '1',
	});
	const application = await NestFactory.createApplicationContext(
		DatabaseModule.forRoot(databaseConfig),
		{ logger: false },
	);
	try {
		const prisma = application.get(PrismaService);
		const preflight = await inspectDatabase(
			prisma,
			target,
			fixture.members,
			fixture.report,
			approval,
		);
		if (!apply) {
			printReport({
				mode: 'DRY_RUN',
				database: preflight,
				blockers: preflight.blockers,
				plannedInsertCount: preflight.safeToProceedToSeparatelyApprovedImport ? 823 : 0,
				writesPerformed: false,
			});
			if (!preflight.safeToProceedToSeparatelyApprovedImport) process.exitCode = 2;
			return;
		}
		if (!preflight.safeToProceedToSeparatelyApprovedImport) {
			printReport({
				mode: 'APPLY_REFUSED',
				database: preflight,
				blockers: preflight.blockers,
				plannedInsertCount: 0,
				writesPerformed: false,
			});
			process.exitCode = 2;
			return;
		}
		const result = await applyHistoricalMembers(
			prisma,
			target,
			fixture.members,
			fixture.report,
			approval,
			backup,
		);
		printReport({ mode: 'APPLY_COMPLETED', ...result });
	} finally {
		await application.close();
	}
}

function printReport(report) {
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
	const known = error instanceof PreflightConfigurationError;
	process.stderr.write(
		`${JSON.stringify(
			{
				preflight: 'kd-gym-historical-member-import',
				failed: true,
				blockers: [known ? error.code : 'IMPORT_ABORTED'],
				...(known ? { message: error.message } : {}),
				writesMayHaveCommitted: !known && process.argv.includes('--apply'),
			},
			null,
			2,
		)}\n`,
	);
	process.exitCode = 2;
});
