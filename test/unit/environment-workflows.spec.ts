import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

async function readRootFile(name: string): Promise<string> {
	return await readFile(new URL(`../../${name}`, import.meta.url), 'utf8');
}

describe('API workflow environment boundaries', () => {
	it('routes bootstrap startup failures to the CLI handler without enabling raw logs', async () => {
		const cli = await readRootFile('src/cli/platform-owner-bootstrap.ts');
		const options = /createApplicationContext\(PlatformBootstrapCliModule,\s*\{([^}]*)\}/u.exec(
			cli,
		);

		expect(options?.[1]).toContain('logger: false');
		expect(options?.[1]).toContain('abortOnError: false');
	});

	it('keeps operator and test targets out of normal application templates', async () => {
		for (const file of ['.env.local.example', '.env.production.example']) {
			const runtime = parseEnv(await readRootFile(file));
			expect(runtime.PLATFORM_OWNER_BOOTSTRAP_ENABLED).toBe('false');
			expect(runtime.BOOTSTRAP_TEST_DATABASE_URL).toBeUndefined();
			expect(runtime.BOOTSTRAP_TEST_DATABASE_MARKER).toBeUndefined();
			expect(runtime.PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_ROLE).toBeUndefined();
		}
	});

	it('requires separate operator and disposable test configuration', async () => {
		const operator = parseEnv(await readRootFile('.env.bootstrap.local.example'));
		const tests = parseEnv(await readRootFile('.env.bootstrap-test.local.example'));
		expect(operator.PLATFORM_OWNER_BOOTSTRAP_ENABLED).toBe('false');
		expect(operator.PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_ROLE).toBe('gym_bootstrap');
		expect(operator.BOOTSTRAP_TEST_DATABASE_URL).toBeUndefined();
		expect(tests.DATABASE_URL).toBeUndefined();
		expect(tests.BOOTSTRAP_POSTGRES_TESTS).toBe('1');
		expect(tests.NODE_ENV).toBe('test');
		expect(tests.PLATFORM_OWNER_BOOTSTRAP_ENABLED).toBe('false');
	});

	it('offers an explicit PostgreSQL command without loading the operator profile', async () => {
		const manifest: unknown = JSON.parse(await readRootFile('package.json'));
		expect(manifest).toMatchObject({
			scripts: {
				'test:bootstrap:postgres':
					'node --env-file=.env.local --env-file=.env.bootstrap-test.local --experimental-vm-modules ./node_modules/jest/bin/jest.js --config jest.config.cjs --selectProjects integration --runInBand --testPathPattern=platform-bootstrap-postgres',
			},
		});
	});
});
