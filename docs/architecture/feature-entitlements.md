# Feature Entitlements

Feature access is the intersection of three controls:

1. The organization’s subscription plan and time-bound entitlement.
2. NEXCODE platform rollout flags and explicit organization overrides.
3. The user’s permission and resource scope.

The backend evaluates all three before work begins and before queued sensitive work executes. Safe
defaults are off for paid or risky capabilities. Trials and overrides have explicit start/end times,
administrative authorization, reason, and audit event. Caches include organization and entitlement
version and have a defined invalidation path.

For example, Soho Gym can receive advanced reports while Power Gym does not, but Soho staff still need
`reports.finance.read`. Flags never bypass authentication, tenant isolation, validation, or payment
integrity.

## Implemented policy foundation

Owner operations can declare reviewed keys from the database package with
`@RequireOwnerEntitlements(...)` and enforce them through `OwnerEntitlementGuard`. The guard requires
one active organization already established by the live owner session and asks
`OwnerEntitlementService` to verify every declared key in one tenant-scoped query. Evaluation is
inclusive at `startsAt`, exclusive at `expiresAt`, and intentionally uncached so a superadmin change
affects the next request. Missing declarations and missing entitlement rows fail closed.

The following owner business boundaries enforce the reviewed matrix:

| Boundary             | Read capability                          | Mutation capability                                                                |
| -------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Dashboard analytics  | `organization.dashboard.read`            | —                                                                                  |
| Membership plans     | `organization.membership-plans.read`     | `organization.membership-plans.manage`                                             |
| Members              | `organization.members.read`              | `organization.members.create`, `.update`, or `.archive` per operation              |
| Member subscriptions | `organization.member-subscriptions.read` | `organization.member-subscriptions.manage`                                         |
| Payments             | `organization.payments.read`             | `organization.payments.create`, `.void`, or `.refund` per operation                |
| Reminders            | `organization.reminders.read`            | `organization.reminders.send`                                                      |
| Payment reports      | `organization.reports.read`              | exports require both `organization.reports.read` and `organization.reports.export` |

Compound commands require all state-changing capabilities: member creation with an initial
subscription requires member-create and subscription-manage; registration with payment additionally
requires payment-create. The complete method-level mapping is centralized in
`owner-operation-entitlements.ts`, and guarded controllers fail closed when a declaration is absent.
The authenticated organization-identity bootstrap endpoint is intentionally outside this matrix so a
manager can enter the portal when dashboard analytics are disabled.

`GET /api/v1/owner/capabilities` is a separate authenticated presentation bootstrap. It requires one
active organization and a live owner role, then returns the currently enabled, effective reviewed
keys for that server-established organization with `Cache-Control: no-store`. The manager validates
the catalog and organization ID before filtering navigation or actions. This snapshot never
authorizes a business request; guarded endpoints independently query live entitlement state again.

Entitlements do not replace manager permissions. Deployment requires the reviewed database migration
before guard activation and a regenerated `@nexcoderw/gym-db` package before the API is built.

Platform superadministrators inspect the complete reviewed catalog and conditionally update one
organization capability through the protected organization-entitlement endpoints. Updates require a
dedicated platform permission, CSRF, an optimistic version, a bounded reason, and an atomic append-only
audit event. Missing rows remain visible as disabled version-zero states and can be provisioned only
through the conditional update contract.
