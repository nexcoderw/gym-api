# Security Model

The API assumes all requests, identifiers, headers, uploads, webhooks, and provider responses are
untrusted. Edge TLS and abuse controls complement application Helmet headers, exact credentialed CORS,
rate limits, strict validation, centralized safe errors, and redacted correlation logging.

Authentication will use secure browser sessions/BFF patterns and appropriately scoped mobile tokens.
Cookie authentication requires CSRF protection. Privileged accounts require MFA. Authorization is
resource- and tenant-aware, not merely role-based. Object properties are allowlisted through DTOs.

Secrets live in managed configuration, rotate, and never enter logs or Git. Webhooks require signature,
timestamp/replay, idempotency, and payload validation before state change. Outbound integrations use
allowlisted endpoints and deadlines to reduce SSRF and resource exhaustion.

The foundation does not yet implement authentication, CSRF, tenant resolution, database readiness, or
audit persistence. No protected business endpoint should ship until those prerequisites and their
negative tests exist.
