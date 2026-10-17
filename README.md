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

### Automatic superadmin permissions

An active staff member with a live database assignment to the system role `platform.owner`
(`isSystem=true`) is the platform superadmin. After all session eligibility checks, Nest grants this
principal every permission declared in `platform-permission.constants.ts`. This currently includes
dashboard read, all six organization-management permissions and all four owner-invitation
permissions. Existing owners receive these effective
permissions on their next successful session check; no SQL grants, owner reinitialization or
frontend role bypass is needed. New platform capabilities must register their permission in the
same catalog before an endpoint requires it; all system owners then receive it automatically.

Ordinary staff retain only their explicit database role-permission links. Matching an email,
display name, user-provided header or a non-system role named `platform.owner` cannot elevate
access. The policy performs no permission writes during login or GET requests. Bootstrap retains
its original persisted dashboard-only allowlist for compatibility with pending owner activation;
active-owner effective permissions are resolved separately. Database permission counts continue
to count stored catalog records, not computed owner capabilities.

Removing individual permission links does not restrict a system owner under this policy. Remove
the owner-role assignment, suspend/revoke the staff account, or revoke its session to remove access.
The next live check enforces that change. MFA, email verification, password state, session expiry,
Origin/CSRF, tenant boundaries, entitlements and durable audit gates are unchanged. In particular,
full organization permission never bypasses a failed durable audit insert.

Email verification is an opt-in, weaker fallback than authenticator MFA. Set
`PLATFORM_AUTH_EMAIL_OTP_ENABLED=true`, `RESEND_API_KEY` (a sending-only key), and
`RESEND_FROM_EMAIL` (the bare, Resend-verified sender shared by every API email) in the API's ignored
`.env.local` only after reviewing that tradeoff. No Resend credential belongs in either frontend.
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

Session validation retries at most two confirmed serializable conflicts (`P2034`), using bounded
randomized backoff, inside an
18-second total budget, reducing the retry's acquisition/execution limits to preserve the BFF
deadline. Expiry is rechecked using elapsed time on retry. Other transaction timeouts
are not blindly retried. Known database availability errors return 503 without revoking a valid
session. Safe operational logs contain request ID, HTTP error code and Prisma machine code, not
SQL or provider messages. Investigate the emitted `databaseCode`: `P2028` indicates transaction
timing, `P2034` contention, and `P2021/P2022` missing schema. The previous redacted log alone cannot
establish which database failure occurred.

Session reads always resolve live identity, revocation, expiry, roles and permissions. Activity
writes are coalesced: idle expiry and lastSeenAt refresh only when the new idle deadline advances
by at least the smaller of 30 seconds or one tenth of the idle TTL. This reduces competing row
writes during parallel navigation without caching authorization; it can shorten, never lengthen,
the effective idle window by that interval. Acquisition uses DATABASE_CONNECTION_TIMEOUT_MS capped
at 10 seconds; execution is capped at 10 seconds and reduced to fit the remaining 18-second budget.
These bounds do not guarantee remote availability. Investigate persistent P2028 failures rather
than disabling session checks or retrying uncertain writes. Access logs now use response finish,
after exception filters, so a failed mutation is logged with its actual 503 rather than a premature 201.

Organization persistence failures also retain their cause internally. The exception filter emits
only an allowlisted Prisma `databaseCode` alongside `ORGANIZATION_PERSISTENCE_UNAVAILABLE` and the
request ID. Clients never receive provider messages, SQL, credentials or error metadata. Diagnose
the active API database, not the disposable test database: `P2021/P2022` require checking deployed
migrations and the rebuilt local database package; `P1010` requires checking application-role
access; `P2028` requires investigating transaction acquisition/execution and pool pressure. Do not
fix these distinct conditions with blanket grants, automatic migrations or unlimited retries.

`P2039` is an unmapped driver error, not proof of a timeout. Its original PostgreSQL code is
logged only as a five-character `sqlState`, extracted from adapter metadata rather than from the
provider's rendered message. `42501` indicates insufficient privileges; `42P01` indicates an
undefined table; `42703` indicates an undefined column. Verify the live database and role before
making a targeted correction. Neither SQLSTATE nor provider metadata is included in HTTP responses.

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
current database role assignments and the explicit system-owner policy. An untrusted role name is
not a bypass. Tenant IDs, gym
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
no tenant-wide query helper, frontend adapter or new dependency is added. The archival audit enum
expansion belongs to the sibling gym-db package and requires the rollout described below.

| Method/path under /api/v1/platform/organizations | Permission                      | Current behavior                          |
| ------------------------------------------------ | ------------------------------- | ----------------------------------------- |
| GET /                                            | platform.organizations.read     | Bounded safe listing                      |
| GET /:id                                         | platform.organizations.read     | Safe details or 404, with updatedAt ETag  |
| POST /                                           | platform.organizations.create   | Atomic audit and 201/PENDING              |
| PATCH /:id                                       | platform.organizations.update   | Atomic audit and name-only 200            |
| POST /:id/activation                             | platform.organizations.activate | Atomic audit and ACTIVE/200               |
| POST /:id/suspension                             | platform.organizations.suspend  | Atomic audit and SUSPENDED/200            |
| POST /:id/archival                               | platform.organizations.archive  | Retained record and history; ARCHIVED/200 |

Every endpoint reuses live platform session and explicit permission guards. System owners receive
the declared organization permissions through the backend policy. A non-system owner name,
dashboard.read alone, tenant cookies and caller-provided permission hints grant nothing. Normal auth
session validation may refresh idle expiry or revoke invalid sessions. Organization writes and
their audit events share one transaction. Reads and all error responses are no-store. Writes additionally
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
cursor, and returns `{ items, nextCursor }`, with null when no additional row is observed. With no
status filter it excludes ARCHIVED; an explicit status=ARCHIVED lists retained records. Ordering
is createdAt DESC, id ASC. The UUID cursor is resolved by PostgreSQL/Prisma, preserving timestamptz
microseconds rather than rounding an encoded timestamp in JavaScript. Cursor lookup and listing
share a bounded repeatable-read transaction. Missing/deleted/filter-mismatched cursors return 400;
restart with the same filter. Pages are separate snapshots, not a frozen export: concurrent inserts
and lifecycle/filter changes can change later pages. The status-leading database index supports
filtered ordering; unfiltered listings need measured query-plan review before production scale.

Safe responses contain only id/name/slug/status and lifecycle/record timestamps, never Prisma
relations, credentials or tenant-private data. Ordinary profile updates accept only name; UUID,
slug and status cannot be assigned. PATCH requires If-Match with the quoted updatedAt ETag
from details. Lifecycle actions take only `{ "expectedUpdatedAt": "2026-10-13T12:00:00.000Z" }`.
Activation allows PENDING/SUSPENDED to ACTIVE and records activatedAt; suspension allows ACTIVE to
SUSPENDED and records suspendedAt. Existing history is retained. Archived activation, repeated
activation/suspension and suspension of pending/archived records yield 409 with a current precondition.
Stale or concurrently changed snapshots yield 412; absent resources yield 404. Archival accepts
PENDING/ACTIVE/SUSPENDED, sets archivedAt, preserves all history and reserves the existing slug.
Archived records cannot be renamed, activated, suspended or archived again (409). Details remain
available to authorized readers. There is no hard-delete, restoration, slug-change or entitlement workflow.

Updates use serializable transactions and a conditional id/status/updatedAt update with
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

The registered DurableOrganizationAudit appends to organization_audit_events using only the mutation's
transaction client. A failed insert throws ORGANIZATION_AUDIT_UNAVAILABLE and aborts the transaction;
there is no success fallback or bypass switch. The unavailable provider is retained only as a
negative-test adapter. Events explicitly map action, actor, request ID, organization, event time,
prior/resulting status and allowed changed fields. Names are recorded only for create/rename.
recordedAt is database-controlled. Request logs are not audit records. Never persist credentials,
tokens, connection URLs or arbitrary bodies. Driver causes remain protected operational diagnostics.

Before running this API version, generate and review a NEW gym-db migration adding the archive audit
enum value and extending the metadata CHECK; never edit applied history. Follow the archival rollout
section in the DB README, including existing audit prerequisites and targeted gym_app privileges.
Regenerate and build the sibling DB package before API typechecking/building. No GitHub Packages
lookup is required. No migration, grant, generated client, build or live write was run by the agent.
The backend endpoint is consumed by the separately reviewed admin archival action. The UI must
re-read the current record before confirmation, submit its exact expectedUpdatedAt, and never retry
an ambiguous mutation automatically. No permanent deletion endpoint or UI exists.

The first-owner persisted bootstrap allowlist remains dashboard.read only, while eligible system
owners now automatically receive all declared platform permissions through the live policy above.
For ordinary staff, permission provisioning remains a separate privileged human operation:

1. Approve the required permission registrations in the database catalog, including descriptions.
   The existing organization-manager provisioning contract covers five permissions; archival requires
   separate explicit approval for ordinary staff and is not silently added to that contract.
2. Review a dedicated platform.organization-operator role with only approved subsets; do not grant
   it automatic system-owner privileges. Preserve the bootstrap's exact persisted allowlist contract.
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
npm run migration:create -- --name enforce_organization_integrity_permissions
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
DB integration tests exercise real mutation/audit rollback and archival retention after reviewed
constraints, enum migration, triggers and disposable test-role grants are deployed. These tests
remain human-run and have not been executed for this change.

Manual smoke, on an approved isolated development target: authenticate a fictional operator with
explicit read permission; list at limit 1/20/50, follow nextCursor with the same filter, inspect UUID
details/ETag, test bad input and missing resources, then remove permission and verify next-request 403. Check safe no-store errors and denied tenant/dashboard-only identities. For an independently
provisioned operator with mutation permissions and valid Origin/CSRF/DTO, create, rename, activate,
suspend and archive a disposable organization. Verify one matching audit per committed mutation,
default-list exclusion after archival and explicit archived-list/detail access. In an isolated test
transaction, make the audit insert fail and verify no organization change commits. A reported 503
must never be treated as success or cause a blind creation retry.
Keep credentials outside shell arguments, logs and test artifacts. Existing auth/dashboard suites
remain regression checks. No commands or live tests were executed by the agent.

Production also needs an approved reproducible package strategy (immutable publication or pinned
sibling builds), deployment topology/rate-limit review and authorization/audit retention review.

## Step 17: secure organization-owner invitations

Owner invitation administration is a platform control-plane workflow under one organization. It
creates an offer to begin future onboarding; it does not send email, generate or return a token,
accept an invitation, create a user or membership, assign the OWNER role, or grant tenant access.

| Method/path under `/api/v1/platform/organizations/:organizationId/owner-invitations` | Permission                                        | Behavior                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `POST /`                                                                             | `platform.organizations.owners.invite`            | Creates `PENDING_DELIVERY` plus its durable audit atomically                           |
| `GET /`                                                                              | `platform.organizations.owners.read`              | Lists one organization’s invitations with bounded cursor pagination                    |
| `POST /:invitationId/revocation`                                                     | `platform.organizations.owners.revoke-invitation` | Revokes only `PENDING_DELIVERY` or `SENT`, clears token material and audits atomically |

All routes require a live platform session and their exact permission. Mutations additionally
require the configured admin Origin and matching CSRF cookie/header. Eligible system owners inherit
the permissions from the central backend catalog; ordinary staff need explicit database role links.
Organization and invitation UUIDs are always part of the persistence predicate, so a valid UUID from
another organization returns 404 instead of crossing the tenant boundary.

Create accepts only `displayName` and `email`. The API trims meaningful display names, normalizes
email to lowercase, and relies on the database for the final citext and integrity contract. Only
`PENDING` and `ACTIVE` organizations accept invitations. The database partial unique index permits
at most one outstanding invitation for an organization/email pair across `PENDING_DELIVERY` and
`SENT`; a concurrent duplicate maps to 409. A successful response contains only the invitation ID,
organization ID, display name, email, status and lifecycle timestamps. It never exposes token
digests, actors, audit internals, relations or future persistence fields.

List defaults to 20 and caps at 50. It accepts an optional allowlisted invitation status and UUID
cursor, orders by `createdAt DESC, id ASC`, and returns `{ items, nextCursor }`. Cursor lookup and the
page query use the same organization and status filter in a bounded repeatable-read transaction.
Keep the same filter while following a cursor; stale, foreign or filter-mismatched cursors return 400.
All responses use `Cache-Control: no-store`.

Revocation is a serializable conditional update from the previously read status. Repeated revocation,
accepted invitations and concurrent state changes return 409. Successful revocation sets `REVOKED`,
records `revokedAt`, clears `tokenDigest`, and appends `INVITATION_REVOKED` through the same transaction
client. Creation similarly appends `INVITATION_CREATED`. If durable audit insertion is unavailable,
the transaction fails closed with 503 and no successful mutation is confirmed.

There is no invitation idempotency key or automatic mutation retry. After a timeout or ambiguous
network outcome, reconcile through the organization-scoped list before deciding whether to submit a
new invitation. PostgreSQL’s partial unique index remains the final concurrent-duplicate authority.

Delivery source is described in Step 21 below and remains release-gated. Acceptance still requires
independent recipient identity verification. External email requests
must not run inside the database transaction. Platform MFA OTPs must never be reused as invitation
codes, and no URL should be generated until a reviewed acceptance route actually exists.

Before enabling these routes, a human must review and deploy the forward DB hardening migration,
regenerate/build the sibling database package, and apply only the table/column grants documented in
the DB README. Never edit applied migration history, use `db push`, grant broad schema ownership, or
turn a 503 into an automatic retry. The adapter-fake API suites verify policy and HTTP boundaries but
do not prove PostgreSQL constraints, trigger behavior, rollback or actual grants; those require the
database package’s opt-in live integration workflow against the marked disposable test database.
No registry artifact/version is invented. No frontend, branch, owner membership, subscription,
payment, tenant login, domain provisioning or operator provisioning CLI is included.

## Step 21: release-gated owner invitation delivery

**Source implemented; database deployment, human verification and production operation are not
confirmed. Delivery is disabled by default. No worker starts with the HTTP API.** No owner account,
password, enrollment proof, membership, role, tenant session or acceptance endpoint is created.
The admin application is unchanged; its delivery control must remain disabled.

### Release prerequisites and configuration

The last authorized migration-status inspection found
`20261015235222_owner_enrollment_acceptance_foundation` pending on `gym_dev`. Do not run create-only
generation while that earlier migration can apply unexpectedly. Its independent Step 19 SQL review
is not part of enabling this feature. Preserve both applied delivery and committed enrollment SQL.
The DB README contains the forward repair proposal and PostgreSQL coverage, **not an approved or
deployed repair migration**. Have the human reconcile history and review a newly generated forward
draft before disposable deployment. Never reset, use `db push`, edit applied history or ship an empty
repair. The final repair must use the reviewed **4096-byte** encrypted-payload bound.

Enable only after all of these are independently verified:

- The forward delivery repair, six validated CHECKs, enabled guards, queue audit metadata, PUBLIC
  revocations, role ownership/inheritance and compatible generated/built sibling `gym-db` package.
- A real owner-facing acceptance page and fragment-token handling reviewed by security. Configuring
  an origin or entering a review identifier is an operator attestation, not proof a page exists.
- A Resend-verified `RESEND_FROM_EMAIL` sender shared by MFA and invitations, a managed Resend key,
  separate random 256-bit invitation HMAC and
  encryption secrets, controlled expiry/retention, provider idempotency tests and worker monitoring.
- Successful isolated database, unit, module and real-guard HTTP checks, followed by an approved
  fictional-recipient end-to-end provider test. None was run by the agent.

The `.env.*.example` files list all settings with delivery OFF and approval false. Enabling requires
`OWNER_INVITATION_DELIVERY_ENABLED=true`, `OWNER_INVITATION_DELIVERY_DATABASE_APPROVED=true`, a completed
`OWNER_INVITATION_ACCEPTANCE_REVIEW_ID` and fixed `OWNER_INVITATION_ACCEPTANCE_PATH`. Local development
uses the exact `ORGANIZATION_PORTAL_ORIGIN`; production derives each invitation origin from the stored
organization slug and `ORGANIZATION_PORTAL_BASE_DOMAIN`. These attestations must never be copied blindly
into production. Production requires HTTPS, rejects localhost/development key IDs, and has no bypass.
No wildcard, credentials, query, fragment, client-selected destination or unvalidated Host-derived
link is accepted.

Use `OWNER_INVITATION_TOKEN_HMAC_SECRET` for a separately managed canonical base64 32-byte key.
`OWNER_INVITATION_ENCRYPTION_KEYRING` is up to four comma-separated `key-id=base64-key` entries;
`OWNER_INVITATION_ENCRYPTION_ACTIVE_KEY_ID` must exist. These secrets must not reuse one another or
platform token/TOTP keys. There are no invitation development-key defaults. Manage secrets outside
Git; do not paste their values into shell history, chat, screenshots or diagnostics.

Expiry is 300–604800 seconds (default 86400); leases 30–120 seconds (default 60); attempts 1–10
(default 3); worker concurrency 1–4 (default 1). Enabled startup requires validated shared
`RESEND_API_KEY` and a bare `RESEND_FROM_EMAIL` on the controlled verified sender domain. The MFA
`sendOtp()` adapter is not reused. Runtime database preflight separately rejects missing checks,
guards, queue-audit metadata, the older ciphertext bound and PUBLIC table/column/type/function grants.

### Administrative reservation and public preview

`POST /api/v1/platform/organizations/:organizationId/owner-invitations/:invitationId/delivery`
requires a live MFA platform session, exact `platform.organizations.owners.send-invitation`, exact
administrator Origin and valid CSRF. Trusted system owners inherit the registered permission;
ordinary staff need its persisted role link. Both IDs are UUIDs. Body absent or `{}` only: recipient,
URL, sender and token overrides are rejected. Disabled delivery returns safe 503 before mutation.

The service locks organization then invitation, proves the association and PENDING/ACTIVE organization
state, and inserts one QUEUED reservation plus `INVITATION_DELIVERY_QUEUED` in one short transaction.
Invitation status remains PENDING_DELIVERY. Audit failure rolls back the reservation. Repeated calls
return its existing safe status without generating a token or audit again. Revoked/accepted invitations
conflict. One organization/invitation uniqueness constraint is the final duplicate authority.

A 202 response contains only `status` and `message`. QUEUED means reserved, PROCESSING means claimed,
CONFIRMED means provider acceptance plus database finalization (not inbox receipt), FAILED means known
failure and UNCERTAIN requires operator review. It never returns a token, digest, envelope, recipient,
provider identifier or internal failure. A failed/uncertain reservation is not overwritten by requeueing.

`POST /api/v1/owner-invitations/preview` accepts only `{ "token": "<opaque token>" }`, is public and
limited to 10 requests/minute per trusted request IP. It uses `Cache-Control: no-store`, sets no
session cookies and returns only `{ "valid": true, "organizationName": "Soho Gym" }`. Database time,
SENT status, expiry, null revocation/acceptance timestamps and an eligible organization are checked.
Invalid digests, expired/revoked/accepted invitations and suspended/archived organizations share the
same generic invalid response. Malformed/extra fields are rejected by validation. Account existence,
email, identity, OWNER permissions and enrollment proofs are never returned or mutated. Configure
trusted edge IP handling and distributed public throttling before multi-instance operation.

### Token envelope and transport

Tokens are 32 cryptographically random bytes in canonical base64url (43 characters), not UUIDs,
sessions or MFA codes. HMAC-SHA256 covers JSON `["gym-owner-invitation-v1", token]` with the distinct
invitation key. Invitations store the digest only when finalization commits SENT.

Temporary delivery material uses AES-256-GCM with independent keys, random 12-byte IV and 16-byte tag.
Associated data binds purpose, format version 1, delivery ID, organization ID and invitation ID. The
4096-byte maximum encrypted JSON envelope freezes the token and minimal recipient/gym/sender/fixed
destination snapshot so retries cannot change the provider payload after a gym rename. Only the
explicit worker decrypts it. Missing keys, unknown versions, wrong identities/tags or corrupt data
fail closed without plaintext errors. Do not remove old keys while any live envelope or approved
backup still needs them. HMAC rotation invalidates old tokens; schedule rotation after the maximum
issued lifetime or use an independently reviewed revocation/incident plan. Protect retained backups,
erase recoverable live material at confirmed/terminal cleanup and retire keys only after backup
retention review. JavaScript plaintext exists briefly in worker memory, never logs or persistence.

The dedicated Resend adapter uses one fixed endpoint, subject and escaped template, a fragment token
at the reviewed path, stable `owner-invitation-delivery:<reservation UUID>` key, 8-second deadline,
redirect rejection, 4096-byte response bound and strict UUID provider-ID validation. Payload and
expiry text are identical on retries. A sender/destination configuration change closes delivery as
a known failure; it does not silently send a different payload. Provider 429 is a known retryable
rejection; allowlisted permanent 4xx are terminal. Network/timeouts, 409, 5xx, malformed or lost
responses are UNCERTAIN. No raw provider body or recipient is logged or returned.

[Resend idempotency](https://resend.com/changelog/idempotency-keys) retains keys for 24 hours and
requires the same payload. Automatic retries are limited to known rejections, the same reservation
and encrypted payload, the attempt/expiry bounds, exponential backoff with jitter and a conservative
23-hour window from reservation creation. There is no exactly-once guarantee across PostgreSQL and
the provider. Unknown outcomes are never resubmitted automatically, even with a stable key.

### Worker operation, privileges and recovery

Only an explicitly started CLI processes reservations. It uses a stable unique
`OWNER_INVITATION_WORKER_ID`, bounded candidates/concurrency and PostgreSQL row locks in organization,
invitation, delivery order, with conditional status/attempt/lease-owner updates. There is no in-memory
lock, startup worker or provider call inside a database transaction. Workers reauthorize the current
requesting staff/user and current send permission at claim, before submission and finalization;
they also recheck organization, invitation, token expiry and lease ownership. A short remaining lease
is not enough to submit another provider request.

The CLI uses a dedicated Nest module, not the HTTP AppModule. Neither the worker nor its Resend
adapter is registered in the HTTP container. The managed worker reads injected process environment
only and does not construct authentication providers or require platform session/TOTP secrets. Its
explicit local-development npm wrapper is the sole exception: it preloads the ignored `.env.local`
and supplies a fixed local identity. Set `NODE_ENV` explicitly for managed execution. Provision a
restricted worker database role and invitation/provider keys; deployed API and worker processes must
not share a privileged connection or generic environment export.

Provider acceptance finalization conditionally changes PENDING_DELIVERY to SENT with matching digest,
expiry and sentAt, then CONFIRMED with provider ID and erased token envelope in the same transaction.
If either conditional write fails, the transaction rolls back. Revocation remains the existing audited
authority; a race may send an unusable external email, but cannot resurrect a revoked invitation or
produce a valid preview after revocation. A provider-accepted email cannot be unsent.

Expired PROCESSING leases become UNCERTAIN, not queued. Database failure after submission also attempts
to record uncertainty; if persistence is unavailable the lease remains for recovery. SIGINT/SIGTERM
stop new batches and settle bounded in-flight work; forced termination leaves leases for conservative
recovery. The worker erases expired uncertain envelopes while retaining the non-secret uncertainty
record. Known terminal failures erase secrets immediately; confirmed records are immutable.

An unresolved per-record persistence operation stops the explicit CLI after the bounded batch rather
than hot-looping a poison reservation. Protected operational logging allowlists only safe codes and
record/worker IDs; it does not print arbitrary Nest/driver bootstrap exceptions.

Operator recovery must correlate the protected reservation's provider key/message with provider-side
evidence, exact payload and recipient, then review the unexpired invitation and organization again.
No automated reconciliation/resend endpoint is supplied. Never generate a new token, requeue UNCERTAIN,
or assume a timeout means failure. Use the DB README's independently reviewed transition/cleanup
procedure. Unresolved outcomes stay UNCERTAIN, including after expiry/erasure. A disabled or failed
worker must alert operations; logs contain safe operation codes and record IDs, never secrets.

Review separate API/worker grants in the DB README. API queueing needs SELECT/INSERT on delivery plus
append-only ownership audit access and parent locking privileges. Worker access is limited to scoped
platform organization/invitation/delivery reads, current staff/user/RBAC reads and approved column
UPDATEs. No DELETE, TRUNCATE, CREATE, table ownership, BYPASSRLS, unrestricted tenant role or password/
session/MFA access is needed. Read-only/public preview must not gain mutating capabilities.

### Human verification and startup

First resolve the **pending enrollment migration** through a separate reviewed migration-ordering plan.
Follow the DB README checkpoint, generate a forward repair only when no earlier migration can apply,
stop to review its SQL and grants, then deploy to the independently marked disposable test database.
Only after approval, from the database directory:

```bash
cd /Users/dvniels/Desktop/projects/gym/api/db
npm run migration:test:deploy
npm run prisma:generate
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

Apply separate disposable-test grants before integration tests; never copy fixture DELETE privileges
to runtime roles. Review the local generated/built sibling package before API verification:

```bash
cd /Users/dvniels/Desktop/projects/gym/api/api
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
```

Authored coverage includes token/config/envelope tampering and rotation, fake provider transport,
reservation deduplication/audit rollback, worker retries/leases/finalization/revocation, module worker
isolation and HTTP with actual session/permission/Origin/CSRF/throttling guards. PostgreSQL locking,
constraints, concurrency, ACLs and durable rollback remain the database package suite's responsibility;
stateful API fakes are not evidence those PostgreSQL guarantees passed.

Negative HTTP cases intentionally exercise 503 responses and can emit safe Nest error logs; assess
the test assertions and final suite result, not those expected log lines alone.

After the disposable suite passes, use a separately approved development deployment window, verify
the migration credentials target `gym_dev` (not the test/shadow/production database), confirm every
earlier migration was reviewed and the repair SQL is non-empty, then have the human run:

```bash
cd /Users/dvniels/Desktop/projects/gym/api/db
npm run migration:status
npm run migration:deploy
npm run migration:status
```

Review development runtime grants and the exact database used by the API/worker again. Production
deployment is a separate managed-credential approval, never this local command copied blindly.
Do not enable delivery merely because migrations passed; the acceptance page, provider, keys,
monitoring and security prerequisites still apply.

For reviewed local development only, after every delivery prerequisite is configured in the ignored
`.env.local`, build and start the worker with the explicit local command. It loads `.env.local` and
supplies a fixed development-only worker identity:

```bash
cd /Users/dvniels/Desktop/projects/gym/api/api
npm run build
npm run worker:owner-invitations
```

Do not use that local command in a deployment. Once every release prerequisite is approved, inject
managed environment secrets and a separate restricted worker database role, then start explicitly:

```bash
cd /Users/dvniels/Desktop/projects/gym/api/api
OWNER_INVITATION_WORKER_ID=invitation-worker-01 npm run worker:owner-invitations:managed
```

The identifier must be stable and unique among live workers. Do not put keys, tokens or database URLs
in that command. Review process grace periods, provider tests, quotas, IP rate limiting, monitoring,
retention, acceptance-page referrer/analytics behavior and incident procedures before production.

## Owner enrollment and organization portal

Step 22 adds a separate global-User owner boundary. It never reuses the platform session cookie,
token pepper, CSRF token or authorization guard. Owner login requires an active verified non-platform
User with a live active membership carrying the exact organization-scoped `owner` role. Every session
read revalidates password-change time, idle/absolute expiry, membership, role and organization state.

The invitation flow creates a short-lived purpose-scoped enrollment proof. Existing recipients must
authenticate; new recipients create their own Argon2id password after invitation mailbox proof.
Acceptance validates identity binding again and atomically consumes invitation/proof, activates only a
safe pending membership, assigns the system owner role and inserts recipient audit evidence. A pending
gym may finish enrollment but remains operationally restricted. Suspended and archived gyms receive
no portal operations.

Local portal configuration uses `ORGANIZATION_PORTAL_ORIGIN=http://localhost:4001`, non-Secure local
owner cookies, and independent canonical base64 32-byte owner session/enrollment peppers. Production
uses `ORGANIZATION_PORTAL_BASE_DOMAIN=mucyora.rw`, requires one valid organization slug label, HTTPS,
Secure host-only cookies and independent managed secrets. The Origin/Host-derived slug is routing input;
live membership and stored organization scope remain authoritative. Deploy and grant the reviewed
owner-session migration in `gym_dev` before starting this API; see the database README. Delivery must
remain disabled until the Resend sender, tenant-domain acceptance flow, worker, monitoring and real
portal deployment are reviewed together.
