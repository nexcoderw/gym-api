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
- Platform-administrator password plus MFA authentication under `/api/v1/platform/auth`
- Opaque server-side platform sessions in host-only HttpOnly cookies
- Exact administrative Origin checks, CSRF protection, revocation, idle expiry, and live permissions
- Unit, integration, and e2e foundation tests

Tenant authentication, tenant resolution, organization authorization, readiness checks, feature
entitlements, queues, payments, notifications, administrator bootstrap, password recovery, and MFA
enrollment remain future work.

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
| `DATABASE_URL`      | local disposable URL              | Least-privilege runtime database URL              |
| `PLATFORM_ADMIN_ORIGIN` | `http://localhost:3000`       | Exact browser Origin for platform authentication  |
| `PLATFORM_AUTH_COOKIE_SECURE` | false outside production | Must be true in production                     |
| `PLATFORM_AUTH_TOKEN_PEPPER` | development-only test key | Managed base64 32-byte secret in production       |
| `PLATFORM_TOTP_KEYRING` | development-only test keyring | Managed `key-id=base64-key` rotation keyring      |
| `PLATFORM_AUTH_SINGLE_INSTANCE` | true outside production | Required production acknowledgement until distributed throttling exists |

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

## Platform administrator authentication

`POST /api/v1/platform/auth/login` validates password and administrator eligibility but creates only
a short-lived MFA challenge. `POST /api/v1/platform/auth/mfa/verify` atomically consumes that
challenge plus a TOTP step or recovery code before setting the session cookie. `GET
/api/v1/platform/auth/session` reloads current permissions, status, expiry, idle timeout, and password
state. `POST /api/v1/platform/auth/logout` revokes only the presented session.

Production uses a `__Host-nexcode-platform-session` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`,
`Path=/`, and no `Domain`. The admin frontend sends credentialed requests directly from
`https://admin.gym.rw` to `https://api.gym.rw`; it stores no session token. State-changing requests
must have the exact configured Origin. MFA verification and logout also echo the returned CSRF value
in `X-Platform-CSRF-Token`. Local HTTP uses explicitly non-prefixed, non-Secure cookies and disposable
accounts only; production cookie requirements cannot be disabled.

The current per-account authentication limiter is process-local. Production is restricted to one API
instance through explicit configuration until a distributed limiter is implemented. Operational logs
are redacted security signals, not a complete privileged audit trail. No production administrator is
created automatically; a separately reviewed human bootstrap and MFA enrollment remains mandatory.

See [Platform authentication](docs/security/platform-authentication.md) for configuration, deployment,
key rotation, and verification details.

## Database package integration

The API registers `DatabaseModule` once and consumes only public exports from the exact database
package dependency. It never runs migrations at startup. The current source package reports `0.1.1`,
but has no release tag proving that the registry artifact contains the Step 4 models. Before install,
the human must verify the immutable tarball or publish a new SemVer version and update this manifest.
See [ADR 0003](docs/adr/0003-database-package-boundary.md).

## Engineering rules

All contributors and agents must read `AGENTS.md` and `.agents/README.md`. Git suggestions follow one
file per commit, and agents never perform Git writes.
