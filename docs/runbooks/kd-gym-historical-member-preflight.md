# KD GYM production historical member import

This runbook is specific to KD GYM organization `f6e417be-b93e-40ef-b028-d9d03666e69f` in
database `neondb` on the approved Neon production endpoint. Hostname and database name alone cannot
distinguish database environments; the preflight verifies the database's provisioned comment marker
against an independently sourced production marker. The historical dataset covers
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

`production-approval.json` must follow the schema in
[`approval template`](../../scripts/synthetic-data/production-approval.template.json).
The template is intentionally unapproved: empty strings and `false` flags must be replaced only
with details supplied by the authorized approver/operator. Its database marker must come from the
approved production configuration, never the staging database configuration.

Copy the template file to `scripts/synthetic-data/private/production-approval.json`. Leave its
false flags and empty approval fields untouched until the authorized approver and operator provide
the real values. The loader rejects the untouched template.

The checksum, approval, backup verification and notification verification are required. The
notification artifact must identify the reviewed application safeguard version
`kd-gym-member-notification-protection-v1`; the program also independently verifies database
columns, applied migrations, enum support, and validated CHECK constraints.

## Step-by-step: where to run the commands

Run all commands in this runbook from the **API application project**, `api/api`:

```bash
cd /Users/test/Desktop/project/gym/api/api
```

Do not run the preflight, import, or API test commands from `api/db`. This task does not change the
database package or require database-package commands. The script deliberately ignores `.env.local`
and generic `DATABASE_URL` values.

The reported `PREFLIGHT_DATABASE_URL_REQUIRED` error means the command received an empty URL. In
the reported shell, `KD_GYM_PREFLIGHT_DATABASE_URL` was unset, and that dedicated variable is not
defined in either project `.env.local`. Both files contain a generic `DATABASE_URL`, but its value
was not inspected and must not be assumed to identify the approved production target.

1. If the generated fixture output is missing, generate it in `api/api`:

   ```bash
   node scripts/synthetic-data/generate-kd-gym-members.mjs \
     --seed kd-gym-members-2026-11-12-v1
   ```

2. Validate the local files and copy `dataset.manifestSha256` from the output:

   ```bash
   node scripts/synthetic-data/preflight-kd-gym-members.mjs
   ```

3. After independent approval, create `scripts/synthetic-data/private/` with mode 0700 and place
   the approval JSON there as `production-approval.json`, mode 0600. Its checksum must match the
   offline report. Do not put a database URL or password in the artifact.

4. In the same zsh terminal, read the approved production URL without echoing it or saving it in
   shell history. Get it from the protected production secrets source. Obtain the database marker
   from the separately approved production configuration, not an unverified configuration:

   ```zsh
   read -s 'KD_GYM_PREFLIGHT_DATABASE_URL?Paste the approved production PostgreSQL URL: '
   print
   export KD_GYM_PREFLIGHT_DATABASE_URL
   read 'KD_GYM_PRODUCTION_DATABASE_MARKER?Enter the approved production database marker: '
   export KD_GYM_PRODUCTION_DATABASE_MARKER
   if [[ -n "$KD_GYM_PREFLIGHT_DATABASE_URL" ]]; then
     print 'Production URL loaded into this shell.'
   else
     print 'URL is empty; load it before continuing.'
   fi
   ```

   Keep using this terminal and do not print the variable or replace it with `$DATABASE_URL`.
   If the terminal closes, load the secret again. Do not copy a value from `api/db/.env.local`
   without independently confirming that it is the approved production URL.

5. Run the read-only preflight below. It verifies the actual database comment marker, so an
   incorrectly targeted database is rejected even if its host and database name match.

6. Run the dry run below. It reports `plannedInsertCount: 0` while any blocker remains.

7. Run the API tests and checks from `api/api`, as listed at the end of this runbook. The `api/db`
   project is not used for these commands.

## Offline fixture check

From `api/api`:

```bash
node scripts/synthetic-data/preflight-kd-gym-members.mjs
```

This reads the fixture CSV, JSONL, manifest and generator report. It checks fixture IDs, names,
phones, monthly distributions and all dataset/manifest hashes. It reports aggregates only.

## Read-only production preflight

Load the dedicated `PREFLIGHT_DATABASE_URL` from the protected production secrets source. Do not
put production credentials in `.env.local`, commit them, or rely on `DATABASE_URL`. Supply the
approved production database marker separately. The read-only transaction compares the actual
PostgreSQL database comment to that marker and the marker in the approval artifact, then checks the
organization, baseline, migrations, columns, collisions, and expected final count.

```bash
PREFLIGHT_DATABASE_TARGET=production \
PREFLIGHT_DATABASE_URL="$KD_GYM_PREFLIGHT_DATABASE_URL" \
PREFLIGHT_EXPECTED_DATABASE_HOST=ep-rapid-violet-b4txcgks-pooler.c-6.us-east-2.aws.neon.tech \
PREFLIGHT_EXPECTED_DATABASE_NAME=neondb \
PREFLIGHT_EXPECTED_DATABASE_MARKER="$KD_GYM_PRODUCTION_DATABASE_MARKER" \
PREFLIGHT_PRODUCTION_READ_ONLY_CONFIRMATION=KD-GYM-READ-ONLY-PREFLIGHT \
node scripts/synthetic-data/preflight-kd-gym-members.mjs \
  --database-target production --allow-production-read-only
```

The expected start date comes solely from the local, checksum-bound attestation. The report also
shows existing gender aggregates without assigning or changing the existing member's gender. It
requires synthetic identity and email/SMS suppression columns, both suppression enums, the required
migration records, and validated database CHECK constraints. A failed preflight is a hard stop; do
not change fixture data or baseline to get a green report.

## Production dry run

The import CLI defaults to DRY RUN, validates the approval artifact and its backup/notification
attestations, and runs the production preflight. It reports aggregate validation, blockers and the
planned insert count without writing to the database:

```bash
PREFLIGHT_DATABASE_TARGET=production \
PREFLIGHT_DATABASE_URL="$KD_GYM_PREFLIGHT_DATABASE_URL" \
PREFLIGHT_EXPECTED_DATABASE_HOST=ep-rapid-violet-b4txcgks-pooler.c-6.us-east-2.aws.neon.tech \
PREFLIGHT_EXPECTED_DATABASE_NAME=neondb \
PREFLIGHT_EXPECTED_DATABASE_MARKER="$KD_GYM_PRODUCTION_DATABASE_MARKER" \
PREFLIGHT_PRODUCTION_READ_ONLY_CONFIRMATION=KD-GYM-READ-ONLY-PREFLIGHT \
node scripts/synthetic-data/import-kd-gym-members.mjs --database-target production
```

It shows exactly 823 planned inserts only if every check passes. Missing approval, database
protections, schema migrations, constraint validation, baseline, or application safeguard review
keeps the workflow blocked. A dry run is not approval to apply.

Expected states:

- **Blocked:** any missing or mismatched production identity marker, approval field, dataset hash,
  required migration/column/enum/check constraint, application safeguard attestation, baseline
  count, or collision check. Planned insert count stays zero.
- **Ready for separate review:** all read-only checks pass and the dry run reports 823 planned
  inserts. This still does not authorize APPLY.

## Notification safety

The importer marks every generated row with `isSynthetic: true`, the approved deterministic batch
ID, null email, and paired `MANUAL` email and SMS suppression. The database constraints require
synthetic batch identity, no email, both suppression pairs, and prevent a non-synthetic row from
carrying a synthetic batch ID. The importer verifies all 823 rows inside its serializable
transaction before commit. Ordinary member creation explicitly writes `isSynthetic: false`.

Member email delivery filters synthetic members in manual selection and worker queries, safely
skips queued or failed synthetic reminders, rechecks member eligibility immediately before send,
and repeats the guard at the Resend adapter boundary. Email opt-out and suppression checks remain
active. This repository has no SMS provider or SMS sender path. The durable SMS suppression fields
are ready for future integrations; any future SMS adapter must reject synthetic members, members
with SMS suppression, and unverified recipients before provider calls. No live SMS provider was
added.

## APPLY — DO NOT RUN YET

Do not run APPLY as part of implementation or review. A future human operator may use it only after
the authorized approver has supplied all real approval details, a recoverable backup has been
verified, notification safeguards have been reviewed and attested, and the fresh dry run and
read-only preflight both pass. APPLY requires a separate typed confirmation and a fresh
in-transaction preflight. It uses a serializable transaction, locks the fixed organization row,
rechecks baseline and collisions, inserts 823 member rows with actual insertion timestamps, verifies
every inserted field, and rolls back on any conflict or verification failure. It never skips
conflicts. A durable
private import manifest is created before the transaction and finalized after commit; a leftover
`PREPARED` manifest requires manual reconciliation and blocks rerun by checksum.

```bash
PREFLIGHT_DATABASE_TARGET=production \
PREFLIGHT_DATABASE_URL="$KD_GYM_PREFLIGHT_DATABASE_URL" \
PREFLIGHT_EXPECTED_DATABASE_HOST=ep-rapid-violet-b4txcgks-pooler.c-6.us-east-2.aws.neon.tech \
PREFLIGHT_EXPECTED_DATABASE_NAME=neondb \
PREFLIGHT_EXPECTED_DATABASE_MARKER="$KD_GYM_PRODUCTION_DATABASE_MARKER" \
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
  test/unit/synthetic-kd-gym-members-import.spec.ts \
  test/unit/member-reminder-delivery.spec.ts \
  test/unit/resend-member-reminder-email.service.spec.ts \
  test/unit/owner-upcoming-reminders.spec.ts \
  test/unit/member-reminder-reconciler.spec.ts \
  test/unit/owner-members-registration.spec.ts \
  test/unit/owner-payment-registration.spec.ts
npm run test:e2e -- --runTestsByPath test/e2e/owner-members.e2e-spec.ts
npm run format:check
npm run lint
npm run typecheck
```

The preflight tests use mocks and local fixture output only. They must never connect to production.
The implementation agent does not run tests, builds, formatting, lint, typecheck, or database
commands for this task.

## Remaining external checks

- Confirm the local fixture checksum has been independently approved and the two private artifacts
  have exact permissions.
- Confirm backup recoverability and external SMS/email integrations' suppression behavior.
- Confirm the application safeguard version in the approval artifact matches the reviewed code.
- Review generated SQL behavior of the published database client and the transaction lock/isolation
  behavior in a non-production review environment before approving any production write.
- No gender dashboard or aggregation endpoint was added; existing member records and aggregate
  reporting remain queryable, while dedicated gender reporting can be scoped as a future feature.
