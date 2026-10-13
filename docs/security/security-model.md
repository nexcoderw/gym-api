# Security Model

The API assumes all requests, identifiers, headers, uploads, webhooks, and provider responses are
untrusted. Edge TLS and abuse controls complement application Helmet headers, exact credentialed CORS,
rate limits, strict validation, centralized safe errors, and redacted correlation logging.

Platform-administrator authentication uses password plus mandatory TOTP or recovery-code MFA. The API
stores only keyed digests of opaque challenge, recovery, and session credentials. Browser sessions use
host-only HttpOnly cookies, exact Origin checks, and CSRF tokens; current roles and permissions are
loaded from PostgreSQL for every authenticated request. Authorization remains permission-based rather
than role-name-based.

Secrets live in managed configuration, rotate, and never enter logs or Git. Webhooks require signature,
timestamp/replay, idempotency, and payload validation before state change. Outbound integrations use
allowlisted endpoints and deadlines to reduce SSRF and resource exhaustion.

Tenant authentication, tenant resolution, database readiness, administrator enrollment, distributed
authentication throttling, and tamper-resistant audit persistence remain future work. Ordinary
security logs must not be represented as an audit system.
