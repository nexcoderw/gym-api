# Swagger and OpenAPI

Every endpoint declares a domain tag, operation summary/description, request and response DTOs,
parameters, authentication, authorization/tenant expectations, status codes, and structurally valid
fictional examples. OpenAPI behavior must agree with e2e tests.

Outside production, `SWAGGER_ENABLED` defaults true and exposes `/docs` plus `/docs-json`. Production
defaults false. If production documentation is required, place it behind authenticated administrative
access or network controls; CORS is not protection.

For a controlled static export, a human starts the application in an isolated non-production
environment, retrieves `/docs-json`, reviews it for sensitive/internal endpoints, and publishes it only
to the approved documentation location. Do not commit generated JSON automatically. Cookie and bearer
schemes in the foundation describe future contracts and do not imply authentication is implemented.
