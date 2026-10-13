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

Live platform-session validation retains serializable isolation with an explicit 5-second transaction
acquisition limit and a separate 10-second execution limit. The admin BFF allows 20 seconds per
upstream request so it does not abort inside that budget. These limits accommodate remote database
latency; they are not performance targets or retries. Acquisition/execution failures remain errors,
never cached or anonymous principals. Investigate recurring failures and slow queries rather than
continually raising timeouts. Central API error logs retain request correlation metadata without raw
provider messages or stacks, which can contain SQL or credentials.

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

Email verification is an opt-in, weaker fallback than authenticator MFA. Set
`PLATFORM_AUTH_EMAIL_OTP_ENABLED=true`, `RESEND_API_KEY` (a sending-only key), and
`RESEND_FROM_EMAIL` (a bare address on your Resend-verified domain) in the API's ignored `.env.local`
only after reviewing that tradeoff. No Resend credential belongs in the admin frontend.
`POST /api/v1/platform/auth/mfa/email` requires the live password challenge, trusted Origin and
CSRF proof. It never accepts a recipient or issues cookies. A fixed HTTPS adapter sends one email;
there is no SDK dependency or automatic delivery retry. Codes expire within five minutes or at
challenge expiry, whichever comes first. Only keyed digests bound to challenge and verified mailbox
are stored. Resends replace the old code; each challenge permits three sends, including failed
deliveries, with a durable 60-second cooldown. Verification uses the existing failed-attempt budget
and atomically consumes the code and challenge before creating a session. Confirmed authenticator
or recovery enrollment remains required. Disabling the flag immediately blocks email verification.

Before deploying this API change, the human must generate, review and deploy the DB expansion
migration adding `emailOtp*` fields to `PlatformMfaChallenge`, then regenerate and rebuild the DB
package. Never edit an applied migration or use `db push`. Existing challenges have no email code
and retain their original factors. Run provider-fake unit, integration and HTTP tests, then verify
real Resend delivery using a disposable development account. Provider acceptance is not proof of
inbox delivery. Keep email fallback disabled by default, especially in production.

Session validation retries at most one confirmed serializable conflict (`P2034`) inside an
18-second total budget, reducing the retry's acquisition/execution limits to preserve the BFF
deadline. Expiry is rechecked using elapsed time on retry. Other transaction timeouts
are not blindly retried. Known database availability errors return 503 without revoking a valid
session. Safe operational logs contain request ID, HTTP error code and Prisma machine code, not
SQL or provider messages. Investigate the emitted `databaseCode`: `P2028` indicates transaction
timing, `P2034` contention, and `P2021/P2022` missing schema. The previous redacted log alone cannot
establish which database failure occurred.

`POST /api/v1/platform/auth/login` validates password and administrator eligibility but creates only
a short-lived MFA challenge. `POST /api/v1/platform/auth/mfa/verify` atomically consumes that
challenge plus a TOTP step, recovery code or enabled email OTP before setting the session cookie. `GET
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

The API registers `DatabaseModule` once and consumes only public exports from the database package.
It never runs migrations at startup. The approved local development dependency is `file:../db`,
recorded in both manifest and lockfile; the installed sibling package reports 0.1.1. Install/generate/
build the database repository before the API, preserving the sibling layout. A local source version
does not prove an immutable registry release exists. Production needs either a separately approved
immutable artifact/version or a reproducible pinned two-repository build/deployment process.

## Engineering rules

All contributors and agents must read `AGENTS.md` and `.agents/README.md`. Git suggestions follow one
file per commit, and agents never perform Git writes.

## Step 9 authentication integration verification

Future first-owner passwords must satisfy the normal login DTO's 12–1024-character validation and
the existing 1024-byte UTF-8 hashing bound. The shared policy uses class-validator's length checks,
not Buffer length or JavaScript UTF-16 length as a substitute for the minimum. Invalid UTF-8, C0/C1
controls, DEL and the owner's email are rejected before hashing or a database transaction. Passwords
are never trimmed or Unicode-normalized; approved Argon2id settings remain unchanged. Existing
hashes are untouched. An older owner with an 8–11-character password needs separately authorized
credential recovery, not a weaker login DTO or repeated initialization.

The manifest and lockfile now agree on `@nexcoderw/gym-db: file:../db`, resolving the earlier missing
lockfile dependency. The installed sibling-source symlink is not proof of a published artifact.
Its public exports and generated declarations contain
PasswordCredential, PlatformAdminSession, PlatformMfaChallenge, PlatformTotpCredential and
PlatformRecoveryCode. The identity and authentication migrations exist; current applied status must
be checked by the human on the intended database. Do not modify schemas or migration history here.

Check the local dependency from api/api without querying GitHub Packages:

```bash
npm ls @nexcoderw/gym-db
```

Do not run npm view against npm.pkg.github.com to verify this local setup: that checks an unrelated
remote artifact and can return E404 while the local dependency works. Keep public-package imports;
do not copy schema/generated sources into the API. Registry publication, if chosen later, requires
the maintainer's reviewed release process; never guess a version, overwrite a release or commit
credentials. Verify clean builds of both pinned source revisions before any deployment. Lockfiles
are produced only by human npm execution, not edited manually by agents.

From `api/db`, verify the configured direct migration target before this read-only database command:

```bash
npm run migration:status
```

Do not deploy/reset migrations automatically to clear a verification failure. After prerequisites,
run the existing formatting, lint, typecheck, unit, integration, E2E, full-test and build commands
listed above. Run opt-in PostgreSQL bootstrap tests only against the independently marked disposable
bootstrap-test database, never the ordinary development or production owner database.

### BFF rate limiting and remaining deployment risks

The API uses its socket peer for login attempt tracking; behind Next this is the BFF, not necessarily
the browser. Administrators sharing a BFF peer can share IP throttles, including the login/MFA
10-per-minute route quotas. Per-account protections remain, but do not provide deployment-wide
atomic limits: the current limiter/storage are process-local. The production single-instance
acknowledgment is a configuration gate, not proof of actual replica count. Verify topology before
release; multiple API instances are blocked until shared atomic limiting and a reviewed trusted
proxy/source-identity design exist. Never trust or blindly forward browser X-Forwarded-For claims.
Shared-peer denial of service must also be evaluated for the intended single-instance capacity.

Current OWASP MFA guidance identifies real-time phishing/reverse proxies as a remaining TOTP risk;
TOTP is not phishing-resistant. Keep MFA mandatory and secrets out of logs. Phishing-resistant
authenticators and shared limiting require separately scoped work, not an unreviewed Step 9 rewrite.
See [OWASP MFA guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).
Source inspection is not a vulnerability scan, live integration result or deployment approval.

The human full-stack smoke procedure is in the admin README. No agent executed development tooling,
database operations, bootstrap, registry checks, package publishing, browser automation or Git writes.

## Step 11: platform organization management

This is the NEXCODE control plane, not tenant CRUD. The feature imports the existing platform auth
module and the one globally registered PrismaService. Services are private to their feature module;
no tenant-wide query helper, schema, migration, client, frontend adapter or new dependency is added.

| Method/path under /api/v1/platform/organizations | Permission                      | Current behavior                          |
| ------------------------------------------------ | ------------------------------- | ----------------------------------------- |
| GET /                                            | platform.organizations.read     | Bounded safe listing                      |
| GET /:id                                         | platform.organizations.read     | Safe details or 404, with updatedAt ETag  |
| POST /                                           | platform.organizations.create   | Audit-blocked 503; prepared 201/PENDING   |
| PATCH /:id                                       | platform.organizations.update   | Audit-blocked 503; prepared name-only 200 |
| POST /:id/activation                             | platform.organizations.activate | Audit-blocked 503; prepared 200           |
| POST /:id/suspension                             | platform.organizations.suspend  | Audit-blocked 503; prepared 200           |

Every endpoint reuses live platform session and explicit permission guards. An owner role alone,
dashboard.read alone, tenant cookies and caller-provided permission hints grant nothing. Normal auth
session validation may refresh idle expiry or revoke invalid sessions, but the organization audit
gate prevents organization writes. Reads and all error responses are no-store. Writes additionally
require the configured administrative Origin and matching CSRF cookie/header via the existing guard.
The auth module exports the existing Origin/CSRF guard and token provider for consuming feature DI;
no second authentication mechanism is introduced. Global whitelist/unknown-field rejection and
existing Express JSON limits remain in effect; there is no bulk or arbitrary Prisma-input endpoint.

Creation accepts only `{ "name": "Soho Gym", "slug": "soho" }`. Name edges are trimmed using
the database whitespace policy; meaningful Unicode names are permitted up to the existing validator
bound. Slugs must already be lowercase ASCII in the approved 3–63-character grammar: this API rejects
rather than silently lowercases them. Reserved names match Step 10's reviewed list. Database checks
remain authoritative; API validation is not their replacement. Duplicate slugs map to 409, including
concurrent creation and slugs held by archived organizations. No identity, branch, membership,
subscription, payment account, entitlement or platform privilege is created automatically.

Listing defaults to 20 rows, caps at 50, accepts an optional OrganizationStatus filter and UUID
cursor, and returns `{ items, nextCursor }`, with null when no additional row is observed. Ordering
is createdAt DESC, id ASC. The UUID cursor is resolved by PostgreSQL/Prisma, preserving timestamptz
microseconds rather than rounding an encoded timestamp in JavaScript. Cursor lookup and listing
share a bounded repeatable-read transaction. Missing/deleted/filter-mismatched cursors return 400;
restart with the same filter. Pages are separate snapshots, not a frozen export: concurrent inserts
and lifecycle/filter changes can change later pages. The status-leading database index supports
filtered ordering; unfiltered listings need measured query-plan review before production scale.

Safe responses contain only id/name/slug/status and lifecycle/record timestamps, never Prisma
relations, credentials or tenant-private data. Ordinary profile updates accept only name; UUID,
slug and status cannot be assigned. Prepared PATCH requires If-Match with the quoted updatedAt ETag
from details. Lifecycle actions take only `{ "expectedUpdatedAt": "2026-10-13T12:00:00.000Z" }`.
Activation allows PENDING/SUSPENDED to ACTIVE and records activatedAt; suspension allows ACTIVE to
SUSPENDED and records suspendedAt. Existing history is retained. Archived activation, repeated
activation/suspension and suspension of pending/archived records yield 409 with a current precondition.
Stale or concurrently changed snapshots yield 412; absent resources yield 404. There is no archival,
slug-change or entitlement workflow.

Prepared updates use serializable transactions and a conditional id/status/updatedAt update with
count=1; API writes advance updatedAt monotonically by at least one millisecond. A serialization
conflict becomes 412, not an automatic retry. This is not an immutable database version field:
raw writers can violate timestamp discipline, and sub-millisecond raw timestamps may conservatively
fail the millisecond precondition. Before enabling mutations, review all writer paths and migrate
to a durable monotonic revision/precise token if external writers cannot honor the policy. Do not
claim ordinary last-write-wins or timestamp-only concurrency is universally reliable.

There is no durable idempotency storage in the inspected schema. Do not blindly retry a timed-out
creation; an operator with read permission must reconcile the requested slug through authorized
bounded reads, or inspect a known returned ID, before deciding whether another attempt is appropriate.
No process-local idempotency cache or public privilege-assignment endpoint is implemented.

### Durable audit gate and permission provisioning

The registered UnavailableOrganizationAudit always fails closed with ORGANIZATION_AUDIT_UNAVAILABLE
before starting an organization mutation transaction. There is no environment switch that bypasses
it. A prepared transaction invokes the audit provider before committing and never returns success
when recording fails. Request logs are not audit events; mocked test providers are not production
audit implementations.

Separate gym-db work is required before replacing this provider: an append-only audit-event model
with UUID ID, restricted actor platform-staff and organization foreign keys, action, correlation ID,
UTC event time, previous/resulting status and a constrained safe changed-field allowlist. Review
failure-event recording separately from the transaction that rolls back successful-event writes.
Restrict tenant/read access, forbid ordinary audit UPDATE/DELETE, establish integrity/retention and
tamper-resistance controls, and verify that organization mutation and success event commit atomically.
Never persist cookies, passwords, MFA/recovery material, tokens, connection URLs or arbitrary bodies.
Review its migration, exports, runtime grants and real rollback tests before production installation.

The first-owner permission allowlist remains dashboard.read only. No existing account/role gains
organization access automatically. Permission provisioning is a separate privileged human operation:

1. Approve the five named permission registrations in the database catalog, including descriptions.
2. Review a dedicated platform.organization-operator role with only approved subsets; do not silently
   broaden platform.owner or every administrator. Preserve the bootstrap's exact allowlist contract.
3. Independently verify the chosen active platform staff UUID and active user before explicit role
   assignment; record approval and a durable privileged audit through the approved operational process.
4. In one reviewed transaction, register missing permission records and approved role links; retain
   existing IDs and do not overwrite unrelated roles/permissions. No startup seed is implemented here.
5. Confirm next-request live permissions, negative dashboard-only/tenant cases and a rollback/revoke
   procedure. Do not reinitialize existing owners to obtain access or treat UI navigation as authority.

### Database gates and human verification

Inspected source: organization schema and generated public exports exist, and package/lockfile agree
on file:../db. The committed 20261013195500_create_organizations SQL contains table/type/indexes but
not the three required CHECK constraints or PUBLIC-access revocation. Prior human output reported
the original migration applied somewhere; never rewrite it. Live applied state/grants are not known.
Production rollout and database-backed organization verification remain blocked by forward checks,
privilege review and audit persistence. Do not expose platform-wide reads to tenant runtime roles.

From `/Users/dvniels/Desktop/projects/gym/api/db`, inspect both reviewed targets:

```bash
npm run prisma:format
npm run prisma:validate
npm run migration:status
npx prisma migrate status --config prisma.test.config.ts
npm run migration:create -- --name enforce_organization_integrity
```

Stop and review the new unapplied forward SQL, using the database README's exact name/slug/reserved
checks. Do not repeat create_organizations, accept reset prompts, use db push or change applied SQL.
The earlier harden_organization_constraints draft was empty and already applied somewhere; preserve
it unchanged. The new draft must be populated and reviewed before deployment, not applied empty.
Verify existing records satisfy the checks; corrections require separate approval. After SQL approval
only, deploy to the independently marked disposable target and apply approved table-specific test
grants with the correct restricted test role, then generate/build and test the owning package:

```bash
npm run migration:test:deploy
npm run prisma:generate
npm run test:unit
npm run test:integration
npm run lint
npm run typecheck
npm run build
```

These commands do not approve deployment to the runtime/production database. Each target needs a
separate reviewed migration/grant window. Platform runtime needs approved SELECT and, only after
durable audit readiness, INSERT/UPDATE; no normal DELETE, ownership, CREATE, BYPASSRLS, broad PUBLIC
or inherited tenant grants. Review table default privileges and distinct platform/tenant roles.
A transaction-local tenant UUID alone is not authentication or RLS. No role changes are made here.

From `/Users/dvniels/Desktop/projects/gym/api/api`, after the sibling package build:

```bash
npm ls @nexcoderw/gym-db
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
```

Review formatting diffs before committing. New unit/module/HTTP tests mock only persistence/audit
boundaries, retain actual session/permission/Origin/CSRF guards and make no PostgreSQL connections.
They do not establish uniqueness, CHECK enforcement, actual transaction rollback or audit durability.
Real PostgreSQL mutation/rollback tests remain blocked until the required audit migration/provider
exists. Step 10's database tests cover organization integrity after its reviewed migration is deployed.

Manual smoke, on an approved isolated development target: authenticate a fictional operator with
explicit read permission; list at limit 1/20/50, follow nextCursor with the same filter, inspect UUID
details/ETag, test bad input and missing resources, then remove permission and verify next-request 403. Check safe no-store errors and denied tenant/dashboard-only identities. For an independently
provisioned operator with mutation permissions, valid Origin/CSRF/DTO must still return audit 503 with
no organization changes. Do not bypass the gate to obtain a happy-path creation screenshot.
Keep credentials outside shell arguments, logs and test artifacts. Existing auth/dashboard suites
remain regression checks. No commands or live tests were executed by the agent.

Production also needs an approved reproducible package strategy (immutable publication or pinned
sibling builds), deployment topology/rate-limit review and authorization/audit retention review.
No registry artifact/version is invented. No frontend, branch, owner membership, subscription,
payment, tenant login, archival, domain provisioning or Step 12 implementation is included.
