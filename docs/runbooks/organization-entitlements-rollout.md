# Organization Entitlements Rollout

## Purpose and boundaries

This runbook coordinates the reviewed organization-entitlement release across `gym-db`, `gym-api`,
`gym-admin`, and `gym-manager`. Entitlements supplement authentication, tenant scope, and permissions;
they never replace those controls. Only an authorized operator may deploy or change an organization's
capabilities, and every change requires a bounded reason and the current version.

The manager capability snapshot is presentation data. A hidden navigation item or action is not an
authorization decision. Every owner business endpoint must continue to query live entitlement state
through the API guard before performing work.

## Release prerequisites

1. Record the reviewed commit and artifact version for all four projects. Do not deploy an API built
   against an uncommitted local database package.
2. Confirm a recoverable backup of the target database and the exact Neon environment. Never reuse
   test, shadow, or development credentials in production.
3. Confirm the `add_organization_feature_entitlements` migration and initial capability catalog were
   reviewed. Existing organizations receive the compatibility-preserving initial capabilities; a
   missing row still means denied.
4. Run each repository's formatting, lint, type, test, and build checks. A skipped database-backed
   suite is not passing evidence.
5. Confirm the platform owner has both entitlement administration permissions and MFA. Ordinary
   organization owners must never receive platform administration access.

## Deployment order

### 1. Database package and migration

From `api/db`, the developer verifies the package before deployment:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run prisma:validate
npm run build
npm run migration:status
npm run migration:deploy
```

The integration suite and migration commands require the repository's approved non-production or
target-environment configuration. Inspect the migration status and target before deployment. Do not
use `db push`, create a shadow database, or run migrations from API startup.

Publish or otherwise provide the exact reviewed database package artifact after the migration and
generated client are verified. Confirm the API resolves that artifact, including the reviewed catalog
and tenant transaction types.

### 2. API

From `api/api`, the developer verifies and deploys the API:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
```

The API must start only after the migration is present. Verify the owner capability bootstrap returns
`Cache-Control: no-store`, excludes disabled or out-of-window keys, and rejects unknown persisted keys
with the safe availability error. Direct owner operations must still return the reviewed entitlement
denial when their required capability is unavailable.

### 3. Platform admin

From `app/admin`, the developer verifies and deploys the platform UI:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Verify an MFA-authenticated platform owner can inspect the full catalog, change one capability with a
reason and current version, and see a stale-version conflict instead of overwriting a newer change.

### 4. Organization manager

From `app/manager`, the developer verifies and deploys the organization UI:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Verify the manager hides unavailable destinations and actions, renders a useful unavailable state for
a direct URL, and does not expose another organization's capability snapshot. The API remains the
authority when a stale page still displays an action that was just disabled.

## Production smoke check

Use a fictional or approved non-personal test organization and one low-risk read capability:

1. Record the organization's current capability version and state.
2. Disable the capability through the platform admin with a bounded operational reason.
3. Confirm the next owner capability bootstrap omits it and carries `no-store`.
4. Confirm the corresponding direct owner API request is denied before business work begins.
5. Confirm a newly rendered manager page hides its navigation entry and a direct URL explains that
   the feature is unavailable.
6. Re-enable the capability with the new version, then confirm the next API and manager requests
   reflect the change.
7. Confirm both changes have append-only audit records with the actor, organization, reason, previous
   state, resulting state, and version. Do not copy member, payment, token, or credential data into
   release evidence.

## Failure and rollback

- Manager presentation failure: roll back the manager artifact. API enforcement remains active.
- Admin presentation failure: roll back the admin artifact and pause capability changes. Do not
  mutate entitlement rows manually.
- API failure after deployment: stop manager/admin rollout and restore the previously reviewed API
  artifact. Keep the additive database migration in place while either API version can reference it.
- Migration or catalog failure: stop before deploying the API. Restore through the database
  repository's reviewed recovery process; never edit an applied migration or delete audit history.
- Unexpected denial: inspect effective dates, enabled state, organization scope, version, membership,
  and permission independently. Do not grant a capability as a workaround for an authentication,
  tenant, or permission defect.
- Audit persistence failure: treat the administrative mutation as failed and verify no capability
  state changed before retrying.

After rollback, repeat the applicable verification and smoke steps. A frontend rollback must never be
used to bypass or weaken live API enforcement.
