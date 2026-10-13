# ADR 0003: Consume an Exclusive Database Package

- Status: Accepted
- Date: 2026-10-12

Schema, migrations, client generation, and connection lifecycle belong solely to `gym-db`. This API
consumes an exact published `@nexcoderw/gym-db` version through public exports, translates models to
DTOs, and never migrates on startup. `DatabaseIntegrationModule` registers the package once and makes
its exported services available without creating another client.

The database package exposes ESM-only output, so the API also emits ESM under its existing NodeNext
configuration. Relative TypeScript imports use `.js` runtime specifiers, and Jest maps those specifiers
back to TypeScript sources. The registry artifact must be verified to contain the Step 4 models before
installation; the source version alone is not proof of an immutable release.
