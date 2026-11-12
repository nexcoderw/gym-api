# KD GYM historical member import preflight

The preflight validates the generated member files locally by default. It does not open a database
connection unless a database target is explicitly selected. It never imports members, subscriptions
or payments.

## Offline file validation

From `api/api`, run:

```bash
node scripts/synthetic-data/preflight-kd-gym-members.mjs
```

The command reads the four files in `scripts/synthetic-data/output/`, validates the CSV and JSONL
records against the generator's validation rules, independently checks the dataset's fixed counts
and constraints, compares CSV and JSONL contents, verifies both fixture hashes against the manifest,
and checks that the validation report has no failed checks. Its report contains aggregate counts
only. It does not print fixture names or phone numbers. A successful offline validation is not an
import readiness decision because it has not checked the database baseline.

## Optional read-only database preflight

Use an explicitly selected non-production target first. Provide the dedicated URL and expected
identity through a protected environment or secrets manager; this command does not load `.env` files
and does not fall back to `DATABASE_URL`.

```bash
PREFLIGHT_DATABASE_TARGET=development \
PREFLIGHT_DATABASE_URL="$KD_GYM_PREFLIGHT_DATABASE_URL" \
PREFLIGHT_EXPECTED_DATABASE_HOST=127.0.0.1 \
PREFLIGHT_EXPECTED_DATABASE_NAME=kd-gym-development \
node scripts/synthetic-data/preflight-kd-gym-members.mjs --database-target development
```

Production selection requires all of the following: `--database-target production`,
`PREFLIGHT_DATABASE_TARGET=production`,
`PREFLIGHT_PRODUCTION_READ_ONLY_CONFIRMATION=KD-GYM-READ-ONLY-PREFLIGHT`, and explicit expected
host and database-name values that match the supplied preflight URL. The regular `DATABASE_URL` is
never consulted. No credentials are included in the JSON report or error output.

The database transaction begins with PostgreSQL `SET TRANSACTION READ ONLY` and sets
transaction-local organization scope to the fixed KD GYM organization ID. It then performs aggregate
or count queries. Every member collision query includes the organization ID. The report includes
target identity, migration and column checks, the existing member baseline, month/gender aggregates,
and collision counts. A collision, missing organization, missing migration/column, an unverified
business start date, or a baseline mismatch blocks readiness. Database errors fail closed without
printing SQL, credentials, member names, phone numbers or stack traces.

The current published `Organization` schema does not expose a configured business start-date field.
Until that value is available through the database contract and verified to match the approved
historical plan, database preflight will report `ORGANIZATION_BUSINESS_START_DATE_UNAVAILABLE` and
will not declare the dataset ready. `createdAt` is not treated as the organization's business start
date.

## Example aggregated report

The following is an illustrative shape, not a result from a database run:

```json
{
  "preflight": "kd-gym-historical-member-import",
  "dataset": {
    "valid": true,
    "recordCount": 823,
    "genderCounts": { "male": 709, "female": 114 },
    "dateRange": {
      "from": "2025-10-18",
      "to": "2026-11-12",
      "timezone": "Africa/Kigali"
    }
  },
  "database": {
    "performed": false,
    "safeToProceedToSeparatelyApprovedImport": false,
    "note": "Local file validation only; no database target was selected."
  }
}
```

## Provenance and later importer prerequisites

The fixture's `synthetic`, `generationCategory` and `generationBatch` properties are generator
metadata; they are not columns on `OrganizationMember` and must not be written there. For a later,
separately approved importer, retain an immutable, access-controlled audit artifact containing the
organization ID, generation batch, dataset SHA-256 hashes, imported fixture UUIDs, operator and
approval reference and import timestamp. Store the artifact in an encrypted location with retention
and object-lock controls and link it to the import audit record. That artifact supplies the exact
cleanup manifest without changing the member schema. The importer itself still needs a reviewed
transaction plan, production approval, collision remediation decisions, rollback procedure and human
verification of the existing-member baseline.

## Focused tests and human verification

From `api/api`, the developer may run:

```bash
npm run test:unit -- --runTestsByPath test/unit/synthetic-kd-gym-members-preflight.spec.ts
npm run format:check
npm run lint
npm run typecheck
```

These commands were not run as part of this change. The unit tests create generated fixtures only
under the gitignored `scripts/synthetic-data/output/` directory and use mocked database interfaces;
they never connect to a live database.
