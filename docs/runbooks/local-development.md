# Local Development Runbook

From `api/api`, copy `.env.local.example` to ignored `.env.local` and use only disposable credentials.
Then, as the human developer:

```bash
npm install
npm run format
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm run start:dev
```

Inspect `http://127.0.0.1:3001/api/v1/health/live` and, when enabled, `/docs`. The liveness endpoint
does not verify PostgreSQL. Never point local tests at production. When persistence is introduced,
install an approved exact `@nexcoderw/gym-db` version and use an isolated migrated test database.
