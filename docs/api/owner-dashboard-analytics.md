# Owner dashboard analytics contract

The backend analytics endpoint is implemented. The manager dashboard will consume it in a later
task. The existing `GET /api/v1/owner/organizations/:organizationId/dashboard` remains an
owner-identity response, not this financial dashboard.

## Request and authorization

Route: `GET /api/v1/owner/dashboard/analytics`. It requires an authenticated active gym owner and
resolves the organization from the verified session and portal origin. No organization ID, tenant
header or arbitrary sort field is accepted from the browser. Responses use
`Cache-Control: no-store`.

Optional `fromDate` and `toDate` must be supplied together as valid `YYYY-MM-DD` calendar dates.
They are inclusive days in `Africa/Kigali`. With neither supplied, use the first day of the current
Kigali month through the current Kigali day. The end date cannot be in the future, and a selected
range cannot exceed 366 days. Database time filters use the first day at Kigali midnight as an
inclusive UTC bound and midnight following the final day as an exclusive UTC bound.

The comparison is the immediately preceding range with **the same number of calendar days**. It is
not labelled "last month" unless those dates really are last month. The response includes both
date pairs so a manager can see exactly what is compared. Time is supplied by the server; no
client-side date arithmetic determines a financial period.

## Metrics

All money is whole RWF serialized as decimal strings. Counts are non-negative integers. A comparison
has a direction (`UP`, `DOWN`, `UNCHANGED` or `NEW`) and a signed percentage rounded to one decimal.
When the previous value is zero and the current value is positive, the direction is `NEW` and the
percentage is `null`; two zero values are `UNCHANGED` at `0%`.

| Field               | Meaning                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `netCollected`      | Original settled value of payments occurring in the range, less confirmed refunds linked to those payments as of generation. This must use the same settled-status and refund policy as payment reports.                                                                                                                                                                |
| `settledPayments`   | Count of payments occurring in the range currently marked confirmed, partially refunded or refunded. Pending, failed and voided payments are excluded.                                                                                                                                                                                                                  |
| `newMembers`        | Count of distinct member profiles created in the selected range, whether or not they purchased another plan later.                                                                                                                                                                                                                                                      |
| `activeSubscribers` | Count of distinct members whose profile was not archived by the end of the range and who had a subscription already registered by then and effective on that day (`startDate <= day <= endDate`, with no cancellation by that day's end). This is a point-in-time count, not the number of sales during the range. The comparison uses the end of the comparison range. |

The revenue series shows selected-period gross, confirmed refunds and net using the same payment
occurrence-date attribution as `netCollected`. Its points must sum exactly to that metric's current
value. Use daily buckets for up to 45 days, consecutive seven-day buckets for 46–180 days, and
calendar-month buckets for 181–366 days; partial edge buckets are allowed. Empty buckets carry
`"0"` totals.

The plan breakdown uses the immutable plan name captured when a subscription was registered, and
**gross settled payment allocations before refunds**, matching payment reports. Limit it to the top
five plans and group the remainder as `Other plans`. Payment-method totals also represent **gross
settled value before refunds** and settled-payment counts. Neither breakdown should be mistaken for
the net-collected figure. No member names, email addresses, phone numbers or individual payment rows
belong in this analytics response.

Historical amounts are a **current-state view**: a later confirmed refund can change an earlier
period's net value. The response therefore includes `generatedAt` in UTC. There is no attendance
or receivables source in the current schema, so visits and outstanding-balance figures are omitted.

## Response shape

`OwnerDashboardAnalyticsResponseDto` is the typed response contract. It has `period`, `currency`,
`metrics`, `revenueSeries`, `planTotals`, `methodTotals` and `generatedAt`. A period with no data
returns zero-valued metrics and empty plan/method breakdowns, never fictional values. The series
still contains zero-valued buckets for the requested dates.

The backend groups payments by Kigali day and status across the bounded selected and comparison
ranges before building the displayed buckets; it does not return individual payments. Queries for
payments, refunds, plan allocations, members and subscriptions all use the authenticated organization
ID inside a tenant transaction.
Invalid dates return `400`; an absent session returns `401`; inactive or non-owner access returns
`403`; an aggregation failure returns `503 DASHBOARD_ANALYTICS_UNAVAILABLE` without partial data.

## Database verification and performance gate

`test/integration/owner-dashboard-analytics-postgres.integration.spec.ts` is an explicit opt-in
test. It refuses to write unless `TEST_DATABASE_URL` points to the restricted `gym_test` role and
the connected database has the matching disposable-test marker from `TEST_DATABASE_MARKER`.
It creates only fictional fixtures inside a transaction that always rolls back. Run it only after the
test migrations and reviewed test-role grants are applied:

```bash
cd api/api
OWNER_DASHBOARD_POSTGRES_TESTS=1 npm run test:integration -- --testPathPattern=owner-dashboard-analytics-postgres
```

The operator must supply `TEST_DATABASE_URL` and `TEST_DATABASE_MARKER` through the dedicated test
environment; never substitute the development or production URL. The test reconciles dashboard
net and settled counts with the payment report for both selected and comparison periods. It also
checks confirmed refunds, pending-payment exclusion, new and active members, chart/breakdown sums,
and exclusion of another gym's much larger payment.

Before enabling the manager dashboard in production, profile the three raw dashboard SELECTs in
`owner-dashboard-analytics.service.ts` on a representative **test** database using
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` with a 366-day range and the same tenant predicate.
Record cold and warm timings, rows scanned, buffer reads, and whether the payment time/status and
subscription indexes are used. Also measure end-to-end p50/p95 for default month-to-date and the
maximum range under expected concurrency. Do not set a latency claim or add an index based only on
the tiny integration fixture; review the measured plan first. If a query exceeds the API's timeout
or scans an unbounded cross-tenant set, optimize it before the frontend rollout.
