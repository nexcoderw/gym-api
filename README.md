# @nexcoderw/gym-api

Shared NestJS backend for NEXCODE Gym Management SaaS. One modular-monolith deployment serves NEXCODE
platform operations and independently authorized gym organizations and branches through `api.gym.rw`.

## Implemented foundation

- URI versioning under `/api/v1`
- Strict environment validation before bootstrap
- DTO whitelist validation with stable field-error responses
- Helmet security headers and allowlisted credentialed CORS
- Global rate limiting
- Server-established request IDs and redacted request logging
- Central exception responses without stack, SQL, or provider leakage
- Swagger/OpenAPI, enabled by default outside production
- `GET /api/v1/health/live`, which reports process liveness only
- Unit, integration, and e2e foundation tests

Authentication, tenant resolution, authorization, database registration, business modules, readiness
checks, feature entitlements, queues, payments, and notifications are documented future work—not
implemented behavior.

## Architecture

The application begins as a feature-first modular monolith. HTTP and application behavior belong here;
PostgreSQL schema, migrations, client generation, and connection lifecycle belong exclusively to the
private `@nexcoderw/gym-db` package. This repository must never contain `prisma/schema.prisma`.

Read:

- [System overview](docs/architecture/system-overview.md)
- [Module boundaries](docs/architecture/module-boundaries.md)
- [Tenant resolution](docs/architecture/tenant-resolution.md)
- [Authorization](docs/architecture/authorization.md)
- [Feature entitlements](docs/architecture/feature-entitlements.md)
- [Security model](docs/security/security-model.md)

## Prerequisites

- Node.js `^20.19.0`, `^22.12.0`, or `>=24.0.0`
- npm 10 or later
- The exact approved `@nexcoderw/gym-db` version before persistence work begins
- PostgreSQL and Redis only when modules requiring them are introduced

NestJS 11 is retained for compatibility with the current local database-package peer contract. A
future Nest major upgrade must be coordinated across both packages.

## Environment

Copy `.env.local.example` to ignored `.env.local` for development. Production values come from managed
deployment configuration, not committed files.

| Variable            | Default                           | Requirement                                      |
| ------------------- | --------------------------------- | ------------------------------------------------ |
| `NODE_ENV`          | `development`                     | `development`, `test`, or `production`           |
| `HOST`              | `127.0.0.1`                       | Explicit production bind address recommended     |
| `PORT`              | `3001`                            | Integer from 1 through 65535                     |
| `CORS_ORIGINS`      | local frontend outside production | Required comma-separated origins in production   |
| `SWAGGER_ENABLED`   | true outside production           | Defaults false in production                     |
| `RATE_LIMIT_TTL_MS` | `60000`                           | Window from 1000 through 3600000 ms              |
| `RATE_LIMIT_LIMIT`  | `100`                             | Requests per window from 1 through 100000        |
| `DATABASE_URL`      | none                              | Future database-package integration prerequisite |

`CORS_ORIGINS` accepts origins only, such as `https://admin.gym.rw`, with no path. CORS does not prove
tenant identity or authorization.

## Human-operated setup and checks

From `api/api`:

```bash
npm install
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm test
npm run build
npm run start:dev
```

Agents are prohibited from running these commands. `npm install` must legitimately regenerate
`package-lock.json` after the foundation dependency changes.

## API behavior

Swagger UI is available at `/docs` when enabled; the Nest Swagger JSON endpoint is `/docs-json`. Do not
expose either publicly in production without authentication/network controls. API conventions and the
controlled JSON export strategy are documented in [Swagger](docs/api/swagger.md).

Errors use this shape:

```json
{
	"error": {
		"code": "VALIDATION_FAILED",
		"message": "Request validation failed",
		"requestId": "9a14de53-a456-4b8d-9676-106cc5caa2ad",
		"details": [{ "field": "email", "message": "email must be an email" }]
	},
	"timestamp": "2026-10-12T10:30:00.000Z",
	"path": "/api/v1/members"
}
```

## Database package integration

Do not add a local Prisma dependency or schema. Once the package is published, the human will install
an exact version, inspect its actual public exports, register its documented module once, and add a
database readiness indicator. No migration runs during API startup. See
[ADR 0003](docs/adr/0003-database-package-boundary.md).

## Engineering rules

All contributors and agents must read `AGENTS.md` and `.agents/README.md`. Git suggestions follow one
file per commit, and agents never perform Git writes.
