# Authorization

## Standards

Default deny. Evaluate platform, organization, branch, resource ownership, explicit permissions, and
feature entitlement at the backend. Permissions such as `members.read` are authoritative only when
loaded from trusted membership state. Privileged support access is separate, time-bounded, justified,
and audited.

## Forbidden practices

No role-only `ADMIN` shortcuts, client-submitted permissions, controller-only protection, cross-branch
assumptions, or normal tenant paths for platform administration.

## Example and checklist

A trainer with `members.read` for Remera cannot read Kimihurura financial records. Test 401, 403,
cross-organization, cross-branch, revoked membership, and escalation paths.
