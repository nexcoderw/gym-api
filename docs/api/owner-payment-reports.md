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

## PDF export

`GET /api/v1/owner/reports/payments/pdf?fromDate=2026-01-01&toDate=2026-01-31`

The PDF uses the same required, inclusive Kigali payment dates and owner-session authorization as
the summary endpoint. It downloads as `payments-2026-01-01-to-2026-01-31.pdf` with
`Content-Type: application/pdf`, `Content-Disposition: attachment` and `Cache-Control: no-store`.
No `page`, `cursor` or `limit` parameter is accepted. The backend reads the selected gym's rows in
small database batches, but the PDF includes the entire selected list in chronological order.

Each row shows the Kigali payment time, receipt, member name, method, status, original amount,
confirmed refund amount and current net value. The totals in the PDF are calculated from those
same rows; pending, failed and voided rows are present for audit context but have zero settled net
value. The export does not include email addresses, phone numbers, provider references or internal
payment identifiers.

An export exceeding 10,000 payments returns `413 PAYMENT_REPORT_TOO_LARGE` before sending any PDF
bytes. Select a shorter date range to obtain complete, non-truncated exports. Database or PDF
generation failures return a safe `503 PAYMENT_REPORT_UNAVAILABLE` response. Generated PDFs are
returned directly to the authorized caller and are not stored by the API.
