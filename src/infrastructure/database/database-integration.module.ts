import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '@nexcoderw/gym-db';

import { validateEnvironment } from '../../config/environment.validation.js';

/** Registers the published database package once and exposes its public services application-wide. */
@Global()
@Module({
	imports: [
		DatabaseModule.forRootAsync({
			useFactory: () => {
				const environment = validateEnvironment(process.env);
				return {
					databaseUrl: environment.DATABASE_URL,
					poolMax: environment.DATABASE_POOL_MAX,
					connectionTimeoutMilliseconds: environment.DATABASE_CONNECTION_TIMEOUT_MS,
				};
			},
		}),
	],
	exports: [DatabaseModule],
})
export class DatabaseIntegrationModule {}
