# API Conventions

Use `/api/v1`, JSON, plural kebab-case resources, UTC ISO 8601 instants, and explicit response DTOs.
GET reads; POST creates or commands; PATCH partially changes; PUT replaces when truly supported; DELETE
deletes where business rules allow. Never mutate through GET.

Collections use bounded cursor pagination with an allowlisted sort. Filters and search are explicit,
validated, tenant-scoped, and indexed before release. Retry-sensitive financial or integration commands
require an idempotency key whose scope includes tenant and operation.

Errors return stable code, safe message, request ID, timestamp, path, and optional field details.
Expected statuses include 400 validation, 401 authentication, 403 authorization/entitlement, 404 safe
absence, 409 conflict/idempotency mismatch, and 429 rate limit. Do not expose Prisma models, stack
traces, SQL, provider payloads, or credentials.

Examples use fictional Soho Gym, Kimihurura/Remera branches, `member@example.com`, RWF whole-franc
amounts, and Africa/Kigali schedules.

## Owner invitation delivery and preview

`POST /platform/organizations/:organizationId/owner-invitations/:invitationId/delivery` under
`/api/v1` requires a live platform session and the exact
`platform.organizations.owners.send-invitation` permission, administrator Origin and CSRF proof.
It accepts no request fields (absent body or `{}`), validates both UUIDs, and returns 202 with only
`{ status, message }`. Queueing and its ownership audit commit together; no provider is contacted in
that transaction. Existing reservations return their current status without a new token/audit. A
202 is not a claim of email receipt. UNCERTAIN explicitly requires operator review, not repeating the
request as a resend. Disabled delivery or missing database protections returns 503 without mutation.

`POST /owner-invitations/preview` is the only public invitation route. It accepts a 43-character
opaque token in a strictly validated body, never a URL parameter. It is limited to 10 requests per
minute per request IP and returns no-store on success/errors. Eligible unexpired SENT invitations
return `{ valid: true, organizationName }`. Other bounded tokens share `OWNER_INVITATION_INVALID`
(401), malformed or extra fields return 400, and exhaustion returns 429. No recipient/account details,
cookies, membership/role activation, sessions or acceptance proof are returned or created.

Swagger documents both operations and safe DTOs. Domain responses never expose the delivery
reservation, envelope, digest, provider payload or key. Guards are tested through HTTP rather than
replaced with permissive stubs. Live PostgreSQL correctness remains separately verified in gym-db.
