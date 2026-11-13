# KD GYM staging member seed

This standalone command seeds the existing 823 validated KD GYM fixture members into the staging
database. It requires the already-created files under `scripts/synthetic-data/output/`; it never
regenerates them. It inserts only `OrganizationMember` rows and creates no subscriptions, payments,
or reminders. The existing organization member is preserved.

Run from the API project (`api/api`) after confirming `.env.local` contains the disposable staging
database's `DATABASE_URL`:

```bash
cd /Users/test/Desktop/project/gym/api/api
node --env-file=.env.local scripts/synthetic-data/seed-kd-gym-staging.mjs --apply
```

The explicit `--apply` flag is required. The script uses the standard `@nexcoderw/gym-db`
configuration, validates the fixture set, then performs schema, organization, baseline, batch, and
collision checks inside one serializable transaction. All 823 inserts roll back together on failure.
An exact already-imported batch is reported without inserting duplicates; partial batches and ID,
normalized-name, or phone collisions stop the transaction.

The expected successful summary is:

```json
{
  "database": "neondb",
  "organization": "KD GYM",
  "existingMembersPreserved": 1,
  "syntheticMembersInserted": 823,
  "totalMembers": 824,
  "maleSyntheticMembers": 709,
  "femaleSyntheticMembers": 114,
  "earliestJoiningDate": "2025-10-18",
  "latestJoiningDate": "2026-11-12",
  "transactionStatus": "INSERTED"
}
```

An idempotent rerun reports `syntheticMembersInserted: 0` and
`transactionStatus: "ALREADY_SEEDED"`. This staging seeder does not invoke the production approval
artifact or production import workflow.
