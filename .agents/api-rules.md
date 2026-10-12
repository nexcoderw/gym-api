# REST API Rules

## Standards

Use `/api/v1`, plural kebab-case resources, correct HTTP verbs/statuses, bounded pagination, allowlisted
sorting/filtering, explicit request/response DTOs, stable errors, and idempotency for retry-sensitive
commands. Expose business capabilities, not automatic CRUD or database shapes.

## Forbidden practices

No state-changing GET, secrets in URLs, unrestricted lists, Prisma responses, client-selected internal
fields, or undocumented behavior.

## Example and checklist

`POST /api/v1/memberships/:id/cancellations` may express an audited command. Review method, URI,
status, DTOs, tenant/permission checks, pagination, errors, Swagger, and tests.
