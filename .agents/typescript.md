# TypeScript

## Standards

Keep strict mode, NodeNext resolution, explicit public return types, readonly public contracts,
discriminated unions, `unknown` with narrowing, type-only imports, exhaustive decisions, and real DTO
classes where runtime validation metadata is required.

## Forbidden practices

No `any`, unsafe assertions, `@ts-ignore`, casual non-null assertions, interface-only validation DTOs,
unhandled promises, or untyped external payloads.

## Example and checklist

Parse a webhook body from `unknown` through a verified schema before use. Strict compilation should
succeed without suppressions and nullable/optional states must be handled deliberately.
