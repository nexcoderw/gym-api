# Environment and Secrets

## Standards

Validate environment before accepting traffic. Production supplies values from managed secrets,
sets exact non-tenant CORS origins, and validates tenant origins against one explicit DNS base domain;
local templates contain placeholders only. Keep UTC timestamps and apply Africa/Kigali at business
scheduling/display boundaries. Separate local, test, staging, and production resources and credentials.

## Forbidden practices

No committed `.env`, production defaults, silent fallback for security settings, shared test databases,
or tokens in npm configuration.

## Example and checklist

Production fails startup when `CORS_ORIGINS` or `ORGANIZATION_PORTAL_BASE_DOMAIN` is absent. Review
required/default values, parser bounds, reserved subdomains, secret source, rotation, environment
isolation, and documentation.
