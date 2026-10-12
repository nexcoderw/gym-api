# Background Jobs

## Standards

Jobs carry stable organization/branch context, actor/system purpose, schema version, idempotency key,
attempt count, and trace ID. Re-authorize sensitive work at execution time, use bounded exponential
backoff with jitter, dead-letter handling, visibility timeouts, quotas, and graceful worker shutdown.

## Forbidden practices

No serialized credentials, unbounded retries, tenantless payloads, assumed request authorization,
large personal payloads, or non-idempotent handlers without deduplication.

## Example and checklist

A reminder job stores member ID and organization ID, then reloads authorized data. Review ownership,
deduplication, retry classification, expiry, observability, cancellation, and poison-message handling.
