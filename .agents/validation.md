# Validation

## Standards

Use class DTOs with explicit validators, global whitelist and forbid-non-whitelisted behavior, bounded
strings/arrays/numbers, normalized enums, and domain validation in services. Parse headers, query,
webhooks, and provider responses as untrusted. Avoid implicit coercion for security-sensitive values.

## Forbidden practices

No interface-only DTO validation, unbounded payloads, arbitrary object pass-through, client-controlled
authorization fields, mass assignment, or sanitization as a substitute for validation.

## Example and checklist

An invitation DTO validates email and branch ID shape; the service separately proves branch ownership.
Test missing, extra, malformed, boundary, nested, and malicious values.
