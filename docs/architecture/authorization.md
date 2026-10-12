# Authorization Architecture

Authentication identifies a principal; it does not grant tenant access. Authorization defaults deny
and evaluates platform scope, active organization membership, branch restriction, resource ownership,
explicit permission, organization status, and feature entitlement.

Examples include `organizations.manage`, `branches.create`, `staff.invite`, `members.read`,
`attendance.check_in`, `payments.refund`, and `reports.finance.read`. Roles may group permissions but
must not replace operation-specific checks. Client claims never authoritatively supply roles or
permissions.

Guards can establish coarse prerequisites; application services must protect the actual resource and
state transition to prevent guard/controller bypass. Platform support access is separate, justified,
time-limited, least-privilege, and audited. Delegation cannot grant permissions the delegating actor
does not possess.

Every protected endpoint requires tests for unauthenticated, forbidden, cross-tenant, cross-branch,
revoked membership, suspended organization, missing entitlement, and permitted cases as applicable.
