# KD GYM production historical member import

This runbook is specific to KD GYM organization `f6e417be-b93e-40ef-b028-d9d03666e69f` in
production database `neondb` on the approved Neon endpoint. The historical dataset covers
2025-10-18 through 2026-11-12. It expects one existing member, 823 generated members, and 824 total
after import. The existing member is never updated and its gender or joining date is never inferred.

The workflow is offline by default. Preflight and dry run use a PostgreSQL read-only transaction.
The importer has a separate explicit APPLY mode; Codex must never execute it. The only allowed
production writes are 823 `OrganizationMember` rows. No plans, subscriptions, payments, or reminders
are created.

## Required local private artifacts

Obtain independent written approval for the exact production organization, endpoint, historical
date range, dataset checksum, one-member baseline and 824 final total. The approval must explicitly
acknowledge that all generated rows are synthetic and must attest the business start date as
2025-10-18. Do not derive this date from `Organization.createdAt`. The operator and approval
reference must be recorded.

First generate and validate the deterministic fixture set, then capture the SHA-256 value of
`dataset.manifestSha256` from the offline report. Place these JSON files locally under
`scripts/synthetic-data/private/`, which is gitignored. Create that directory with mode 0700 and
each artifact with mode 0600. Never commit, upload to source control, or include credentials in
either artifact.

`production-approval.json` must have this shape and exact values (replace the checksum, reference,
operator and timestamp with approved values):

```json
{
  "version": 1,
  "organizationId": "f6e417be-b93e-40ef-b028-d9d03666e69f",
  "productionDatabase": {
    "host": "ep-rapid-violet-b4txcgks-pooler.c-6.us-east-2.aws.neon.tech",
    "name": "neondb"
  },
  "historicalBusinessStartDateAttestation": {
    "date": "2025-10-18",
    "operatorAttested": true
  },
  "dateRange": {
    "from": "2025-10-18",
    "to": "2026-11-12",
    "timezone": "Africa/Kigali"
  },
  "datasetManifestSha256": "<64-character-sha256>",
  "expectedExistingMemberCount": 1,
  "expectedGeneratedMemberCount": 823,
  "expectedFinalMemberCount": 824,
  "syntheticRecordsAcknowledged": true,
  "approvalReference": "<approved-reference>",
  "operator": "<operator-name>",
  "approvedAt": "<ISO-8601-timestamp>"
}
```

For a future apply, `production-backup-attestation.json` must independently record `version: 1`,
the exact same `productionDatabase`, `backupVerified: true`, a durable `backupReference`,
`verifiedBy`, and ISO-8601 `verifiedAt`. The tool verifies the format and database identity; the
human operator is responsible for verifying the backup itself and approval authority.

## Offline fixture check

From `api/api`:

```bash
node scripts/synthetic-data/preflight-kd-gym-members.mjs
```

This reads the fixture CSV, JSONL, manifest and generator report. It checks fixture IDs, names,
phones, monthly distributions and all dataset/manifest hashes. It reports aggregates only.

## Read-only production preflight

Load the dedicated `PREFLIGHT_DATABASE_URL` from the protected secrets source into the shell. Do
not put production credentials in `.env.local`, commit them, or rely on `DATABASE_URL`. Set both
identity expectations explicitly. The command refuses any non-production target, different host,
or database. It verifies the approval artifact, organization, exact member baseline, migration and
column history, fixture collisions, and final count within a read-only transaction.

```bash
PREFLIGHT_DATABASE_TARGET=production \
PREFLIGHT_DATABASE_URL="$KD_GYM_PREFLIGHT_DATABASE_URL" \
PREFLIGHT_EXPECTED_DATABASE_HOST=ep-rapid-violet-b4txcgks-pooler.c-6.us-east-2.aws.neon.tech \
PREFLIGHT_EXPECTED_DATABASE_NAME=neondb \
PREFLIGHT_PRODUCTION_READ_ONLY_CONFIRMATION=KD-GYM-READ-ONLY-PREFLIGHT \
node scripts/synthetic-data/preflight-kd-gym-members.mjs \
  --database-target production --allow-production-read-only
```

The expected start date comes solely from the local, checksum-bound attestation. The report also
shows existing gender aggregates without assigning or changing the existing member's gender. A
failed preflight is a hard stop; do not change fixture data or baseline to get a green report.

## Production dry run

The import CLI defaults to DRY RUN, always performs the production preflight, and reports aggregate
validation, blockers and the planned insert count. It performs no write and does not require the
backup attestation:

```bash
PREFLIGHT_DATABASE_TARGET=production \
PREFLIGHT_DATABASE_URL="$KD_GYM_PREFLIGHT_DATABASE_URL" \
PREFLIGHT_EXPECTED_DATABASE_HOST=ep-rapid-violet-b4txcgks-pooler.c-6.us-east-2.aws.neon.tech \
PREFLIGHT_EXPECTED_DATABASE_NAME=neondb \
PREFLIGHT_PRODUCTION_READ_ONLY_CONFIRMATION=KD-GYM-READ-ONLY-PREFLIGHT \
node scripts/synthetic-data/import-kd-gym-members.mjs --database-target production
```

It should show exactly 823 planned inserts only if every check passes. This dry run is not approval
to apply.

## Notification safety

The database has durable member email suppression fields and a paired constraint. Every inserted
synthetic member would have no email address and an email suppression timestamp/reason `MANUAL`;
the API reminder queue and delivery worker honor that suppression. This repository has no member
SMS sender or SMS reminder worker. However, the schema has no durable SMS suppression marker, so
the current importer explicitly blocks APPLY even if an operator acknowledges the risk. The
required future change is a reviewed `gym-db` schema/client migration that stores durable
per-member SMS suppression and an API importer update that sets and verifies it transactionally.
Every SMS-capable external integration must also enforce that stored marker before delivery. Until
those technical controls exist, the production preflight reports
`SMS_NOTIFICATION_SUPPRESSION_UNAVAILABLE` and the planned insert count is zero.

## APPLY — DO NOT RUN YET

Do not run APPLY. It is currently hard-blocked because the database schema has no durable SMS
suppression marker. After a separately reviewed schema/client change adds and validates that
technical safeguard, the human operator must review a successful fresh production dry run, obtain
separate explicit approval, verify a recoverable production backup, and record the backup attestation above. Apply requires a
separate typed confirmation and fresh preflight. It takes a serializable transaction, locks the fixed
organization row, rechecks baseline and collisions, inserts only the 823 member rows with actual
insertion timestamps, and rolls back on any conflict or verification failure. It never skips
conflicts. A durable private import manifest is created before the transaction and finalized after
commit; a leftover `PREPARED` manifest requires manual reconciliation and blocks rerun by checksum.

```bash
PREFLIGHT_DATABASE_TARGET=production \
PREFLIGHT_DATABASE_URL="$KD_GYM_PREFLIGHT_DATABASE_URL" \
PREFLIGHT_EXPECTED_DATABASE_HOST=ep-rapid-violet-b4txcgks-pooler.c-6.us-east-2.aws.neon.tech \
PREFLIGHT_EXPECTED_DATABASE_NAME=neondb \
PREFLIGHT_PRODUCTION_READ_ONLY_CONFIRMATION=KD-GYM-READ-ONLY-PREFLIGHT \
node scripts/synthetic-data/import-kd-gym-members.mjs \
  --database-target production --apply \
  --confirm-production-import KD-GYM-PRODUCTION-IMPORT-824
```

The actual APPLY command above is provided for future human operation only. It was not run as part
of implementation.

## Tests and static verification for the human developer

From `api/api`:

```bash
npm run test:unit -- --runTestsByPath \
  test/unit/synthetic-kd-gym-members-preflight.spec.ts \
  test/unit/synthetic-kd-gym-members-import.spec.ts
npm run format:check
npm run lint
npm run typecheck
```

Tests must use mocks and local ignored fixture output only. They must never connect to production.
The implementation agent does not run tests, builds, formatting, lint, typecheck, or database
commands for this task.

## Remaining external checks

- Confirm the local fixture checksum has been independently approved and the two private artifacts
  have exact permissions.
- Confirm backup recoverability and external SMS/email integrations' suppression behavior.
- Review generated SQL behavior of the published database client and the transaction lock/isolation
  behavior in a non-production review environment before approving any production write.
- No gender dashboard or aggregation endpoint was added; existing member records and aggregate
  reporting remain queryable, while dedicated gender reporting can be scoped as a future feature.
