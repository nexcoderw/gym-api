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
