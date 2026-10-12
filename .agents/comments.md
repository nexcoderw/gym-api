# Comments and TSDoc

## Standards

Document public reusable contracts and non-obvious security, authorization, tenant, entitlement,
idempotency, retry, calculation, and integration decisions. Explain why, keep comments near behavior,
and update them in the same change.

## Forbidden practices

No syntax narration, commented-out code, credentials, personal data, stale guarantees, or TODOs without
an issue/owner.

## Example and checklist

Explain why a tenant header cannot establish authorization. Confirm comments preserve intent that code
alone cannot express and do not reveal sensitive information.
