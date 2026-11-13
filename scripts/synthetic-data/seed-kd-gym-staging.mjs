import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	loadStagingFixtures,
	makeStagingSummary,
	seedStagingMembers,
} from './kd-gym-members-staging.mjs';

let writesMayHaveStarted = false;

async function main(arguments_) {
	if (arguments_.length === 1 && arguments_[0] === '--help') {
		process.stdout.write(
			'KD GYM staging-only member seeder. Usage: node scripts/synthetic-data/seed-kd-gym-staging.mjs --apply\n',
		);
		return;
	}
	if (arguments_.length !== 1 || arguments_[0] !== '--apply') {
		throw new Error('This staging seeder requires exactly the explicit --apply option.');
	}
	assertStagingDatabaseConfiguration(process.env.DATABASE_URL);

	const fixture = loadStagingFixtures();
	const { NestFactory } = await import('@nestjs/core');
	const { DatabaseModule, PrismaService, loadDatabaseConfig } = await import('@nexcoderw/gym-db');
	const databaseConfig = loadDatabaseConfig({
		DATABASE_URL: process.env.DATABASE_URL,
		DATABASE_POOL_MAX: '1',
	});
	const application = await NestFactory.createApplicationContext(
		DatabaseModule.forRoot(databaseConfig),
		{ logger: false },
	);
	try {
		writesMayHaveStarted = true;
		const result = await seedStagingMembers(application.get(PrismaService), fixture.members);
		process.stdout.write(`${JSON.stringify(makeStagingSummary(result, fixture.members), null, 2)}\n`);
	} finally {
		await application.close();
	}
}

export function assertStagingDatabaseConfiguration(databaseUrl) {
	let parsedUrl;
	try {
		parsedUrl = new URL(databaseUrl);
	} catch {
		throw new Error('A valid PostgreSQL DATABASE_URL for the staging database is required.');
	}
	let databaseName;
	try {
		databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
	} catch {
		throw new Error('The staging database name is invalid.');
	}
	if (
		!['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
		parsedUrl.hostname.length === 0 ||
		databaseName !== 'neondb'
	) {
		throw new Error('DATABASE_URL must identify the configured PostgreSQL neondb staging database.');
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).catch(() => {
		process.stderr.write(
			`${JSON.stringify({
				seeder: 'kd-gym-staging-member-seed',
				failed: true,
				writesMayHaveCommitted: writesMayHaveStarted,
				message: 'KD GYM staging member seed failed; inspect database state before retrying.',
			})}\n`,
		);
		process.exitCode = 2;
	});
}
