# Testing

## Standards

Use unit tests for policy/domain logic, integration tests for module/provider contracts, and e2e tests
for real HTTP behavior. Every endpoint covers success, DTO failures, 401, 403, 404, 409, relevant 429,
tenant/branch denial, permissions, entitlement, pagination, infrastructure failure, and idempotency.
Use isolated test databases and provider fakes at adapter boundaries.

## Forbidden practices

No production credentials/data, order dependence, authorization mocked away in e2e, blanket snapshots,
or completion claims without endpoint tests and Swagger.

## Example and checklist

Fictional Soho and Power Gym fixtures prove cross-tenant denial. Confirm cleanup, deterministic time,
failure paths, response contracts, headers, and provider isolation.
