# Module Boundaries

## Current modules

- `HealthModule`: process liveness only; it owns no dependency readiness claim.
- `ConfigModule`: validated process configuration.
- `common`: HTTP filters, middleware, interceptors, DTO infrastructure, constants, and types.
- `docs`: OpenAPI construction, not business behavior.

## Planned feature modules

Authentication/session, principals, organizations, branches, staff, members, attendance, gym-member
billing, platform subscriptions, entitlements, audit, notifications, and integrations will each own
their controller, application service, DTOs, policies, and tests. They may depend on narrow public
contracts, never each other’s controllers or private persistence details.

Platform billing and gym-member billing remain distinct. Notifications and payment providers live
behind `src/infrastructure/` adapters. Cross-module workflows should use explicit application contracts
or domain events only when a concrete need exists.

## Database boundary

Modules consume the published `@nexcoderw/gym-db` public API. They never import private paths, generate
Prisma, or run migrations. API response DTOs remain independent from generated database models.
