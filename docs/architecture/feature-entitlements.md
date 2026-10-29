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

This foundation does not yet apply declarations to member, membership, payment, reminder, report, or
dashboard endpoints. It also does not replace manager permissions. Deployment requires the reviewed
database migration before guard activation and a regenerated `@nexcoderw/gym-db` package before the
API is built.
