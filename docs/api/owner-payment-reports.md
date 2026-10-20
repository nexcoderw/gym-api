# Owner payment reports

## Summary endpoint

`GET /api/v1/owner/reports/payments/summary?fromDate=2026-01-01&toDate=2026-01-31`

Only an authenticated owner of the active gym can request this report. The organization is resolved
from the verified owner session and portal origin, never from a query parameter. Both dates are
required, valid `YYYY-MM-DD` calendar dates and inclusive in Africa/Kigali. The endpoint returns
`Cache-Control: no-store` and does not return individual member or payment records.

The response includes the selected dates, `RWF` currency, generation timestamp, payment count,
settled payment count, and gross, confirmed-refund and net amounts. Money totals are decimal strings
representing whole Rwandan francs so large sums retain precision. An empty period returns zero counts
and `"0"` totals.

`paymentCount` includes all ledger rows whose payment occurrence falls in the range. Only payments
currently marked confirmed, partially refunded or refunded contribute their original amount to
`grossRwf`. Pending, failed and voided payments do not contribute settled value. `refundedRwf`
includes confirmed refunds linked to those selected payments, even if the refund was recorded after
the selected period. `netRwf` is gross less those confirmed refunds. This is a current-state view of
payments that occurred in the selected period, not a historical as-of-period accounting snapshot.

For example, a fictional Soho Gym report may return:

```json
{
	"fromDate": "2026-01-01",
	"toDate": "2026-01-31",
	"currency": "RWF",
	"paymentCount": 2,
	"settledPaymentCount": 1,
	"grossRwf": "15000",
	"refundedRwf": "0",
	"netRwf": "15000",
	"generatedAt": "2026-02-01T08:00:00.000Z"
}
```

The full-list PDF export is not part of this endpoint and remains a later task.
