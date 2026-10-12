# Error Handling

## Standards

Return a stable machine code, safe message, request ID, timestamp, path, and allowlisted field errors.
Differentiate 400, 401, 403, 404, 409, 429, and infrastructure failures. Centralize translation, retain
safe internal causes, and roll back failed operations. Let domain context decide database error mapping.

## Forbidden practices

No stack traces, SQL/Prisma/provider secrets, raw exception objects, blanket try/catch, swallowed
errors, misleading 200 responses, or infinite retries.

## Example and checklist

Return `VALIDATION_FAILED` with field details; log the internal cause by request ID. Review status,
code stability, disclosure, retryability, logging, and tests.
