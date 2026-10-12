# System Overview

## Deployment model

`api.gym.rw` is one shared NestJS modular monolith serving many organizations. Public web, platform
admin, and tenant portals are separate clients, not separate backend deployments. The hierarchy is
Platform → Organization → Branch → authorized staff/member.

## Request flow

```text
client/BFF
  -> edge TLS and abuse controls
  -> request ID, security headers, CORS, rate limit
  -> authentication
  -> active organization resolution and membership verification
  -> permission + branch/resource + entitlement checks
  -> feature application service
  -> @nexcoderw/gym-db tenant transaction
  -> PostgreSQL
```

Only the transport foundation and liveness path are currently implemented. Authentication onward is a
required future slice. Cross-cutting guards must default deny; modules remain deployable together until
measured operational needs justify extraction.

## Operational boundaries

Use UTC internally and Africa/Kigali for explicit business schedules. Queue expensive reports and
notifications. Cache only with organization/authorization-aware keys. Emit request IDs, safe logs,
metrics, and traces; do not log bodies, credentials, or personal data by default.
