# API Security

## Standards

Apply OWASP API risks: object/object-property authorization, validation, rate limits, Helmet, strict
CORS, CSRF for cookie auth, least privilege, parameterized persistence, secret management, redaction,
webhook verification/replay defense, audit logs, and separated administrative paths. Treat all external
input and files as hostile.

## Forbidden practices

No wildcard credentialed CORS, stack/SQL leakage, mass assignment, disabled production controls,
shared secrets in source, unaudited support access, or arbitrary outbound URLs.

## Example and checklist

Allowlisted CORS is browser policy, never tenant authorization. Threat-model authentication, BOLA,
mass assignment, SSRF, abuse, secrets, dependencies, integrations, and privileged actions.
