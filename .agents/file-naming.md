# File and Symbol Naming

## Standards

Use kebab-case files, Nest suffixes (`.controller.ts`, `.service.ts`, `.module.ts`, `.guard.ts`),
descriptive `.dto.ts` contracts, `.spec.ts` unit/integration tests, and `.e2e-spec.ts` HTTP tests. Use
PascalCase classes/types, camelCase values, SCREAMING_SNAKE_CASE constants, plural kebab-case routes,
and explicit permission strings such as `members.read`.

## Forbidden practices

No `utils.ts`, unclear abbreviations, model names as public DTO names, or version numbers in symbols.

## Example and checklist

Prefer `organization-membership.guard.ts` and `OrganizationMembershipGuard`. Names must reveal scope,
behavior, and transport role without opening the file.
