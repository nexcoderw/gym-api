# Performance

## Standards

Set measurable latency/error targets per operation, bounded pagination and concurrency, tenant-aware
caches, external timeouts, queue expensive reports/batches, avoid N+1 persistence, reuse managed
database connections, emit traces/metrics, and shut down gracefully. Measure before optimizing.

## Forbidden practices

No unbounded lists, private-data cache without tenant/authorization keys, synchronous bulk email,
unlimited provider calls, per-request database clients, or unsupported throughput claims.

## Example and checklist

A member list has a maximum page size and organization-scoped cursor/cache. Review data volume,
queries, timeout, concurrency, memory, cache invalidation, metrics, and load-test plan.
