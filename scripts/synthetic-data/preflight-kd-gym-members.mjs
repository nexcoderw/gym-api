import {
	inspectDatabase,
	loadProductionApprovalArtifact,
	PreflightConfigurationError,
	resolveDatabaseTarget,
	validateFixtureFiles,
} from './kd-gym-members-preflight.mjs';

const HELP = [
	'Validate KD GYM historical member fixtures locally without database access.',
	'',
	'Usage:',
	'  node scripts/synthetic-data/preflight-kd-gym-members.mjs',
	'  node scripts/synthetic-data/preflight-kd-gym-members.mjs --database-target TARGET',
	'  TARGET: production only for this historical import',
	'',
	'Database mode also requires PREFLIGHT_DATABASE_TARGET, PREFLIGHT_DATABASE_URL,',
	'PREFLIGHT_EXPECTED_DATABASE_NAME and PREFLIGHT_EXPECTED_DATABASE_HOST.',
	'Production additionally requires the private approval artifact, --allow-production-read-only and',
	'PREFLIGHT_PRODUCTION_READ_ONLY_CONFIRMATION=KD-GYM-READ-ONLY-PREFLIGHT.',
	'DATABASE_URL is never read. No mode writes to the database.',
].join('\n');

async function main(arguments_) {
	if (arguments_.length === 1 && arguments_[0] === '--help') {
		process.stdout.write(`${HELP}\n`);
		return;
	}

	const fixture = validateFixtureFiles();
	const report = {
		preflight: 'kd-gym-historical-member-import',
		dataset: fixture.report,
		database: {
			performed: false,
			safeToProceedToSeparatelyApprovedImport: false,
			note: 'Local file validation only; no database target was selected.',
		},
	};
	const requestsDatabase = arguments_.some(
		(argument) => argument === '--database-target' || argument === '--allow-production-read-only',
	);
	if (arguments_.length > 0 && !requestsDatabase) {
		throw new Error('Unknown preflight option.');
	}
	if (requestsDatabase && fixture.report.valid) {
		const target = resolveDatabaseTarget(arguments_);
		const approval = loadProductionApprovalArtifact(fixture.report.manifestSha256);
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
			report.database = await inspectDatabase(
				prisma,
				target,
				fixture.members,
				fixture.report,
				approval,
			);
		} finally {
			await application.close();
		}
	} else if (requestsDatabase) {
		report.database.note =
			'Database inspection was refused because local fixture validation failed.';
	}

	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (
		!fixture.report.valid ||
		(report.database.performed && !report.database.safeToProceedToSeparatelyApprovedImport)
	) {
		process.exitCode = 2;
	}
}

main(process.argv.slice(2)).catch((error) => {
	const configurationError = error instanceof PreflightConfigurationError;
	process.stderr.write(
		`${JSON.stringify(
			{
				preflight: 'kd-gym-historical-member-import',
				failed: true,
				blockers: [configurationError ? error.code : 'PREFLIGHT_ABORTED'],
				...(configurationError ? { message: error.message } : {}),
				safeToProceedToSeparatelyApprovedImport: false,
			},
			null,
			2,
		)}\n`,
	);
	process.exitCode = 2;
});
