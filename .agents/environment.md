# Environment and Secrets

## Standards

Validate environment before accepting traffic. Production supplies values from managed secrets and
sets explicit CORS origins; local templates contain placeholders only. Keep UTC timestamps and apply
Africa/Kigali at business scheduling/display boundaries. Separate local, test, staging, and production
resources and credentials.

## Forbidden practices

No committed `.env`, production defaults, silent fallback for security settings, shared test databases,
or tokens in npm configuration.

## Example and checklist

Production fails startup when `CORS_ORIGINS` is absent. Review required/default values, parser bounds,
secret source, rotation, environment isolation, and documentation.
