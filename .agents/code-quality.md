# Code Quality

## Standards

Keep controllers thin, services cohesive, dependencies injected, functions explicit, public APIs
narrow, and behavior testable. Separate transport, authorization, persistence, and integrations when
they carry distinct policies. Add abstractions only for demonstrated variation or invariants.

## Forbidden practices

No speculative repositories, circular imports, service locators, hidden global state, swallowed
errors, boolean-flag methods, magic values, or unrelated reformatting.

## Example and checklist

A controller validates DTOs and calls one application operation; it does not construct Prisma queries.
Review responsibility, naming, branching, dependency direction, error behavior, and tests.
