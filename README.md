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
- Two-stage, operator-controlled first platform-owner bootstrap with encrypted TOTP enrollment
- Unit, integration, and e2e foundation tests

Tenant authentication, tenant resolution, organization authorization, readiness checks, feature
entitlements, queues, payments, notifications, ongoing administrator management, password recovery,
and general MFA enrollment remain future work.

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

Keep workflow settings out of the everyday application file:

| Local file                  | Consumer                               | Purpose                                                                          |
| --------------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| `.env.local`                | Local API                              | Runtime database and authentication settings; bootstrap disabled                 |
| `.env.bootstrap.local`      | Interactive first-owner CLI only       | Dedicated operator `DATABASE_URL`, explicit target fingerprint and authorization |
| `.env.bootstrap-test.local` | `npm run test:bootstrap:postgres` only | Restricted disposable bootstrap-test URL and independently provisioned marker    |

Each has a tracked `.example` template. Copy a template only when its real file does not exist, fill
in the reviewed values, and protect it with `chmod 600`. Never commit the real files. Local operator
configuration takes precedence over `.env.local` within the CLI; authentication keys are shared with
the application so enrolled factors remain usable. Never replace the application's runtime URL with
an operator/test URL. Keep the operator flag false except during an approved interactive operation.
Production (`NODE_ENV=production`) and test application contexts do not load local dotenv files;
production operators must supply the full temporary configuration through protected managed secrets.

The opt-in real PostgreSQL command is:

```bash
npm run test:bootstrap:postgres
```

It uses Node's dotenv parser, not shell `source`, and requires both `.env.local` and
`.env.bootstrap-test.local`. The runtime file supplies reference targets for the existing isolation
checks; the test file must not override those targets or contain operator/migration credentials.
The test profile supplies `NODE_ENV=test`, disables operator bootstrap, and explicitly opts into
fixture writes with `BOOTSTRAP_POSTGRES_TESTS=1`. Normal unit/integration/e2e commands remain unchanged
and do not load that profile. Skipped PostgreSQL tests are not a successful database verification.
CI/managed execution uses `npm run test:bootstrap:postgres:managed` with externally supplied test
credentials, marker, reference URLs and `BOOTSTRAP_POSTGRES_TESTS=1`; it loads no local profiles.

Already exported shell variables take precedence over dotenv files. Use a fresh terminal or unset
conflicting workflow variables before running local commands. Do not `source .env.local`.
Database migrations and their separate privileged configuration remain exclusively in `../db`;
see that package's README for `.env.migrations.local`, `.env.test.local`, and test migration deployment.

### Two Neon branches

Normal local operation uses `development / gym_dev`. The interactive owner CLI uses that same
database with the restricted `gym_bootstrap` role, while `.env.local` uses `gym_app`. The separate
`gym_bootstrap_test` database lives on the same development branch and is used only by the opt-in
PostgreSQL test command. Database-package integration tests and Prisma shadowing use `gym_test` and
`gym_shadow` on that branch. Production uses `production / gym_prod` with independently provisioned
credentials and authentication keys. `NODE_ENV=development` does not redirect a production URL.

When replacing an empty Neon project, retain the authentication implementation, migrations, test
safety checks, and workflow profiles. Update all real URLs, password-free reference URLs, approved
operator fingerprints, and independently provisioned markers before running commands. Do not copy
old pending-owner records or reuse disposable test enrollment secrets for your development owner.
Do not delete the old project until the new targets and human-operated checks have been verified.

| Variable                                            | Default                           | Requirement                                                             |
| --------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `NODE_ENV`                                          | `development`                     | `development`, `test`, or `production`                                  |
| `HOST`                                              | `127.0.0.1`                       | Explicit production bind address recommended                            |
| `PORT`                                              | `3000`                            | Integer from 1 through 65535                                            |
| `CORS_ORIGINS`                                      | admin 4000 / manager 4001 locally | Required comma-separated origins in production                          |
| `SWAGGER_ENABLED`                                   | true outside production           | Defaults false in production                                            |
| `RATE_LIMIT_TTL_MS`                                 | `60000`                           | Window from 1000 through 3600000 ms                                     |
| `RATE_LIMIT_LIMIT`                                  | `100`                             | Requests per window from 1 through 100000                               |
| `DATABASE_URL`                                      | local disposable URL              | Least-privilege runtime database URL                                    |
| `PLATFORM_ADMIN_ORIGIN`                             | `http://localhost:4000`           | Exact browser Origin for platform authentication                        |
| `PLATFORM_AUTH_COOKIE_SECURE`                       | false outside production          | Must be true in production                                              |
| `PLATFORM_AUTH_TOKEN_PEPPER`                        | development-only test key         | Managed base64 32-byte secret in production                             |
| `PLATFORM_TOTP_KEYRING`                             | development-only test keyring     | Managed `key-id=base64-key` rotation keyring                            |
| `PLATFORM_AUTH_SINGLE_INSTANCE`                     | true outside production           | Required production acknowledgement until distributed throttling exists |
| `PLATFORM_TOTP_ACTIVE_KEY_ID`                       | `local-v1` outside production     | Keyring entry used only for new encrypted TOTP enrollments              |
| `PLATFORM_OWNER_BOOTSTRAP_ENABLED`                  | false                             | Temporary explicit authorization for the operator-only CLI              |
| `PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_HOST`   | none                              | Exact Neon hostname required while bootstrap is enabled                 |
| `PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_NAME`   | none                              | Exact PostgreSQL database name required while bootstrap is enabled      |
| `PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_ROLE`   | none                              | Dedicated restricted bootstrap role; checked against the connected user |
| `PLATFORM_OWNER_BOOTSTRAP_EXPECTED_DATABASE_MARKER` | none                              | Provisioned database comment; checked on the connected backend          |

First-owner bootstrap now checks the actual connected database and restricted operator role inside a
transaction before privileged writes. Provision the operator marker and role before enabling it;
`neondb_owner` is rejected. See the [bootstrap runbook](docs/runbooks/platform-owner-bootstrap.md) for
Neon setup, transaction-lock behavior, and the separate opt-in disposable PostgreSQL test suite.

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
created automatically or through HTTP. The first owner requires the separate, two-stage interactive
CLI described in the [platform owner bootstrap runbook](docs/runbooks/platform-owner-bootstrap.md).

See [Platform authentication](docs/security/platform-authentication.md) for configuration, deployment,
key rotation, and verification details.

## Platform dashboard summary

`GET /api/v1/platform/dashboard/summary` returns read-only platform identity and authorization
statistics. Both existing guards are mandatory: the session guard revalidates the live administrator
and MFA-authenticated session, then the permission guard requires `platform.dashboard.read` from
current database role assignments. A role named `platform.owner` is not a bypass. Tenant IDs, gym
ownership, and client-provided permission headers do not authorize this endpoint.

The response is HTTP 200 JSON with `Cache-Control: no-store`. Fictional example:

```json
{
	"generatedAt": "2026-10-13T08:00:00.000Z",
	"globalUsers": { "total": 1 },
	"platformStaff": { "total": 1, "pending": 0, "active": 1, "suspended": 0, "revoked": 0 },
	"platformRoles": { "total": 1 },
	"platformPermissions": { "total": 1 }
}
```

- `globalUsers.total`: all global identity accounts, regardless of status; not gym members.
- `platformStaff`: all staff assignments grouped by their database status. An active assignment is
  not necessarily a logged-in administrator or an otherwise eligible user.
- `platformRoles.total`: all platform roles, whether assigned or not.
- `platformPermissions.total`: all registered platform permissions, whether assigned or not.
- `generatedAt`: ISO 8601 UTC response generation time after reading the database; not a snapshot ID.

The existing `PrismaService` performs three counts and one staff-status `groupBy` inside a single
repeatable-read transaction. Staff total is the sum of all status groups. Missing groups become zero.
Only aggregate values are fetched; no user lists, related identities, or authentication secrets are
returned. The service performs no writes. Existing session authentication may still refresh session
idle expiry or revoke invalid sessions; this is unchanged authentication behavior, not dashboard
business mutation. Permission validation and statistics run in separate transactions: this is not
an atomic guarantee against permission revocation occurring during an already authorized request.
Database failures use the established safe error envelope rather than fabricated zero statistics.

No gym, branch, subscription, payment, membership, or revenue statistics are implemented. Future
metrics require separately reviewed database-domain changes in `gym-db` and explicit API permission
design. No schema, migration, dependency, or authentication policy was changed for this endpoint.

Verification from `api/api`:

```bash
npm run format
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm test
npm run build
```

Dashboard unit and module integration tests use an explicitly fake Prisma adapter and never open
PostgreSQL. HTTP tests exercise the actual session service, cookie handling, permission guards,
exception boundary and global rate limiter while faking only persistence. These tests are not proof
of PostgreSQL aggregate execution or transaction isolation; a real-database dashboard smoke check
remains a human verification task against an independently verified disposable target. Existing
opt-in bootstrap PostgreSQL tests remain separate and do not validate dashboard statistics.
Swagger tests check cookie security, permission documentation, schemas, the fictional example,
cache headers, and 200/401/403/429/500 responses. No new package installation is needed for the
dashboard when the inspected local package is already linked; release packaging must still resolve
the private dependency and lockfile inconsistency described below.

## Database package integration

The API registers `DatabaseModule` once and consumes only public exports from the exact database
package dependency. It never runs migrations at startup. The current source package reports `0.1.1`,
but has no release tag proving that the registry artifact contains the Step 4 models. Before install,
the human must verify the immutable tarball or publish a new SemVer version and update this manifest.
See [ADR 0003](docs/adr/0003-database-package-boundary.md).

## Engineering rules

All contributors and agents must read `AGENTS.md` and `.agents/README.md`. Git suggestions follow one
file per commit, and agents never perform Git writes.
