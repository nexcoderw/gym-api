# Notifications

## Standards

Queue delivery, verify recipient relationship and tenant branding, use the controlled
`notify.mucyora.rw` domain, maintain suppression/unsubscribe rules, quotas, delivery state,
idempotency, provider webhook signatures, and safe templates. Proposed sender: `Soho Gym via Mucyora
<reminders@notify.mucyora.rw>` after domain verification.

## Forbidden practices

No arbitrary sender domains, synchronous bulk sends, recipient enumeration, real addresses in tests,
unsigned delivery events, or repeated reminders without deduplication.

## Example and checklist

Use `member@example.com` in examples. Review consent, authorization, tenant branding, injection,
suppression, quota, retries, status, privacy, and abuse controls.
