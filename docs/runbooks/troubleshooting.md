# Troubleshooting

- **Startup rejects CORS:** production requires comma-separated absolute HTTP(S) origins without paths.
- **Swagger is missing:** it defaults off in production; use an isolated environment or approved access.
- **Unexpected 429:** inspect the configured window/limit and proxy client-IP handling before tuning.
- **Request cannot be correlated:** send a safe `X-Request-ID`; invalid values are replaced server-side.
- **Unknown properties return 400:** DTO whitelisting intentionally rejects them; update the explicit
  contract instead of disabling validation.
- **Database package cannot install:** confirm it has been published to GitHub Packages, configure
  `@nexcoderw` registry access, and use the approved exact version.
- **Database model is missing:** request a `gym-db` schema/package release; never add Prisma here.
- **Tests or build fail after this foundation:** return the exact command output. Do not suppress strict
  errors, loosen validation, or edit the lockfile manually.
