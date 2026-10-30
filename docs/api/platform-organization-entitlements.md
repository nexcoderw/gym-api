# Platform organization entitlement contract

Platform superadministrators control which reviewed manager capabilities are available to each
organization. These routes never replace platform authentication, manager permissions, organization
membership, lifecycle checks, or tenant isolation.

## List capabilities

`GET /api/v1/platform/organizations/:organizationId/entitlements` requires
`platform.organizations.entitlements.read`. It returns every key from the database package’s reviewed
catalog. A missing persisted row is returned as disabled with version `0`, preserving the
default-deny policy. Responses are not cached.

## Change one capability

`PATCH /api/v1/platform/organizations/:organizationId/entitlements/:featureKey` requires
`platform.organizations.entitlements.manage`, the platform CSRF token, and an `If-Match` header with
the quoted version returned by the last read. Use `"0"` only when the catalog key has no persisted
row. Unknown keys, stale versions, archived organizations, no-op changes, and invalid activation
windows are rejected.

The body accepts at least one of `enabled`, `startsAt`, or `expiresAt`, plus a required bounded audit
reason. `null` clears a time boundary. When both timestamps exist, `startsAt` must be earlier than
`expiresAt`. Effective status distinguishes disabled, scheduled, currently enabled, and expired
states.

State and an append-only audit event commit in one serializable transaction. Audit evidence records
the server-established platform staff identity and request ID, previous and resulting state, reason,
and resulting version. Audit failure rolls back the capability change and returns a safe `503` error.

## Deployment order

Deploy and verify the database entitlement migration first, regenerate and build the database package,
then refresh the API’s local file dependency before checking or deploying this API. Owner endpoints
must not activate entitlement enforcement against a database without the reviewed catalog rows.
