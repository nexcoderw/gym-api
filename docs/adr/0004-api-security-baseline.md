# ADR 0004: Apply Security Controls at Application Bootstrap

- Status: Accepted
- Date: 2026-10-12

All routes receive URI versioning, Helmet, exact CORS, DTO whitelist validation, rate limiting, request
IDs, bounded logging, and centralized safe errors. Swagger defaults off in production. These controls
are baseline defenses and do not replace authentication, authorization, tenant checks, CSRF, or edge
protections.
