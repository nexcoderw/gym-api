import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	loadStagingFixtures,
	makeStagingSummary,
	seedStagingMembers,
	StagingSeedError,
} from './kd-gym-members-staging.mjs';

let writesMayHaveStarted = false;
let currentStage = 'arguments';
let databaseCloseFailed = false;

async function main(arguments_) {
	if (arguments_.length === 1 && arguments_[0] === '--help') {
		process.stdout.write(
			'KD GYM staging-only member seeder. Usage: node scripts/synthetic-data/seed-kd-gym-staging.mjs --apply\n',
		);
		return;
	}
	if (arguments_.length !== 1 || arguments_[0] !== '--apply') {
		throw new StagingSeedError(
			'APPLY_FLAG_REQUIRED',
			'This staging seeder requires exactly the explicit --apply option.',
		);
	}
	currentStage = 'database_configuration';
	assertStagingDatabaseConfiguration(process.env.DATABASE_URL);

	currentStage = 'fixture_validation';
	const fixture = loadStagingFixtures();
	currentStage = 'database_client_load';
	const { NestFactory } = await import('@nestjs/core');
	const { DatabaseModule, PrismaService, loadDatabaseConfig } = await import('@nexcoderw/gym-db');
	currentStage = 'database_configuration';
	const databaseConfig = loadDatabaseConfig({
		DATABASE_URL: process.env.DATABASE_URL,
		DATABASE_POOL_MAX: '1',
	});
	currentStage = 'database_startup';
	const application = await NestFactory.createApplicationContext(
		DatabaseModule.forRoot(databaseConfig),
		{ logger: false },
	);
	let seedFailed = false;
	try {
		currentStage = 'database_preflight';
		const result = await seedStagingMembers(
			application.get(PrismaService),
			fixture.members,
			new Date(),
			() => {
				writesMayHaveStarted = true;
				currentStage = 'database_write';
			},
		);
		currentStage = 'summary';
		process.stdout.write(`${JSON.stringify(makeStagingSummary(result, fixture.members), null, 2)}\n`);
	} catch (error) {
		seedFailed = true;
		throw error;
	} finally {
		if (seedFailed) {
			try {
				await application.close();
			} catch {
				databaseCloseFailed = true;
			}
		} else {
			currentStage = 'database_shutdown';
			await application.close();
		}
	}
}

export function assertStagingDatabaseConfiguration(databaseUrl) {
	let parsedUrl;
	try {
		parsedUrl = new URL(databaseUrl);
	} catch {
		throw new StagingSeedError(
			'DATABASE_URL_INVALID',
			'A valid PostgreSQL DATABASE_URL for the staging database is required.',
		);
	}
	let databaseName;
	try {
		databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
	} catch {
		throw new StagingSeedError('DATABASE_NAME_INVALID', 'The staging database name is invalid.');
	}
	if (
		!['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
		parsedUrl.hostname.length === 0 ||
		databaseName !== 'neondb'
	) {
		throw new StagingSeedError(
			'DATABASE_IDENTITY_INVALID',
			'DATABASE_URL must identify the configured PostgreSQL neondb staging database.',
		);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).catch((error) => {
		const failureCode =
			error instanceof StagingSeedError
				? error.code
				: `STAGING_${currentStage.toUpperCase()}_FAILED`;
		const failureMessage =
			error instanceof StagingSeedError
				? error.message
				: stageFailureMessage(currentStage);
		process.stderr.write(
			`${JSON.stringify({
				seeder: 'kd-gym-staging-member-seed',
				failed: true,
				stage: currentStage,
				code: failureCode,
				writesMayHaveCommitted: writesMayHaveStarted,
				databaseCloseFailed,
				message: failureMessage,
			})}\n`,
		);
		process.exitCode = 2;
	});
}

function stageFailureMessage(stage) {
	switch (stage) {
		case 'arguments':
			return 'Check the explicit --apply option.';
		case 'database_configuration':
			return 'Check that DATABASE_URL is a valid PostgreSQL URL for neondb.';
		case 'fixture_validation':
			return 'Check that the local fixture files exist and pass offline validation.';
		case 'database_client_load':
			return 'Check that the API database package can be loaded.';
		case 'database_startup':
			return 'Check database connectivity and the configured staging database.';
		case 'database_preflight':
			return 'Check the schema, KD GYM baseline, and fixture collisions.';
		case 'database_write':
			return 'Inspect staging records before retrying; the transaction outcome may be uncertain.';
		case 'summary':
			return 'The database operation completed; inspect the staging member totals before retrying.';
		case 'database_shutdown':
			return 'The database operation may have completed; inspect staging member totals.';
		default:
			return 'KD GYM staging seed failed; internal details were withheld.';
	}
}
