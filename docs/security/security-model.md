# Security Model

The API assumes all requests, identifiers, headers, uploads, webhooks, and provider responses are
untrusted. Edge TLS and abuse controls complement application Helmet headers, exact credentialed CORS,
rate limits, strict validation, centralized safe errors, and redacted correlation logging.

Platform-administrator authentication uses password plus mandatory TOTP or recovery-code MFA. The API
stores only keyed digests of opaque challenge, recovery, and session credentials. Browser sessions use
host-only HttpOnly cookies, exact Origin checks, and CSRF tokens; current roles and permissions are
loaded from PostgreSQL for every authenticated request. Authorization remains permission-based rather
than role-name-based.

Secrets live in managed configuration, rotate, and never enter logs or Git. Webhooks require signature,
timestamp/replay, idempotency, and payload validation before state change. Outbound integrations use
allowlisted endpoints and deadlines to reduce SSRF and resource exhaustion.

Tenant authentication, tenant resolution, database readiness, administrator enrollment, distributed
authentication throttling, and tamper-resistant audit persistence remain future work. Ordinary
security logs must not be represented as an audit system.

## Owner invitation delivery boundary

Step 21 adds dormant delivery source, not owner authentication or acceptance. Delivery remains disabled
until the forward PostgreSQL repair/grants, compatible database package, verified sender and an actual
owner-facing acceptance destination are independently approved. A configured origin and review ID
are operator attestations, not evidence a page exists. No production exception bypasses these gates.

The administrative queue operation requires the registered send-invitation permission, current MFA
platform session, exact Origin and CSRF. It creates a reservation and durable ownership audit in one
transaction without sending email. Parent locks and the composite relationship bind each invitation
to its organization. Existing reservations are reported rather than replaced or given another token.

Purpose-separated HMAC-SHA256 invitation digests use a distinct managed 256-bit key. Recoverable
delivery material is temporary AES-256-GCM ciphertext with a separate rotating keyring, random IV,
explicit version and associated data binding purpose/delivery/organization/invitation. The encrypted
email snapshot freezes retry payloads. Only explicit workers decrypt; provider details, addresses,
tokens, payloads and key material must never reach logs, error bodies or admin responses.

Worker claims are database-backed, bounded and leased. Execution-time staff/permission and invitation
eligibility are rechecked before submission and finalization. Transport is outside transactions.
Only provider acceptance followed by atomic matching SENT/CONFIRMED writes confirms submission, not
inbox delivery. Timeouts, unknown responses, expired leases and ambiguous finalization are UNCERTAIN;
no blind resend or token rotation is permitted. Known rejections alone can use bounded same-key,
same-payload retries within the conservative provider-idempotency window. Revocation invalidates the
token even if an external email cannot be recalled; reconciliation cannot resurrect the invitation.

Public POST preview is no-store, rate-limited, generic on invalid tokens and returns the gym name
only. It creates no identity, enrollment proof, OWNER assignment, membership or session, and does not
prove authentication of an existing User. Future acceptance must remove fragment credentials before
analytics/navigation and enforce independently reviewed identity and membership activation rules.
No acceptance UI or workflow is delivered here. Review edge IP trust and shared rate-limit storage
before exposing a multi-instance public endpoint.

Normal application/worker roles must have neither schema authority nor delete/truncate/ownership or
inherited tenant-wide delivery access. Review column ACLs, table ownership, PUBLIC, inheritance and
BYPASSRLS against the DB README. Cleanup/fixture privileges are test-only. Rotate exposed credentials
at their provider; erasing a local envelope does not erase retained backups. Preserve old decryption
keys only for reviewed live-envelope and backup retention periods, then retire them securely.

See the [Step 21 operational guidance](../../README.md#step-21-release-gated-owner-invitation-delivery)
for disabled defaults, human verification, worker operation, uncertainty and outstanding migration
review. Authored tests are not evidence of deployed PostgreSQL protections or provider readiness.
