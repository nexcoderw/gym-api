# Folder Structure

## Standards

Use feature-first modules under `src/modules/<feature>/` with cohesive controller, service, DTO, and
types. Put cross-cutting transport code in `src/common/`, environment parsing in `src/config/`, provider
adapters in `src/infrastructure/`, and Swagger setup in `src/docs/`. Separate unit, integration, and e2e
tests. Keep architecture, API, security, ADRs, and runbooks under `docs/`.

## Forbidden practices

No generic dumping-ground helpers, deep layering without behavior, Prisma directories, or business
features inside `common`.

## Example and checklist

`src/modules/organizations/dto/create-organization.dto.ts` belongs to its feature. Confirm each file
has one owner, dependencies point inward, and no circular import is introduced.
