# Third-Party Integrations

## Standards

Place providers behind narrow infrastructure adapters. Validate all responses/webhooks, authenticate
requests, set deadlines, classify retries, use idempotency, circuit/backpressure controls, versioned
contracts, sandbox fixtures, secret rotation, and observability. Persist provider identifiers needed
for reconciliation without exposing them unnecessarily.

## Forbidden practices

No SDK calls in controllers, credentials in code/logs, blind retries, unsigned webhooks, arbitrary
callback URLs, assumptions about provider success, or provider DTOs as public API contracts.

## Example and checklist

Verify a payment signature and replay key before state change. Review auth, timeout, retry, validation,
idempotency, SSRF, rate limit, outage, sandbox, data sharing, and exit strategy.
