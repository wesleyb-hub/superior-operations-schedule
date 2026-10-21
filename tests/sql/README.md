# Production-release regression

The GitHub Actions `Production release SQL regression` job uses a disposable PostgreSQL 16 service with test-only credentials. It applies a minimal dependency fixture, the actual additive migration, and behavioral assertions in one session; the fixture is rolled back at the end. It does not connect to Supabase or apply the full historical migration chain.

Coverage: all six legal transitions reject eight missing/null/incomplete release payloads (48 rejection cases), all six accept `Complete`, an absent schedule row is rejected (55 release cases total), rejected transitions leave stages/events unchanged, and existing permission/stage-order checks still reject invalid calls. Auth and permission helpers are deliberate stubs; this test does **not** validate Supabase JWT/RLS configuration, full migration replay, concurrency, or live data.

Run only against a disposable, empty local PostgreSQL database:

```sh
psql -X -h 127.0.0.1 -U postgres -d production_release_test \
  --set ON_ERROR_STOP=1 \
  -f tests/sql/production-release-fixture.sql \
  -f supabase/migrations/20261021201500_production_release_fail_closed.sql \
  -f tests/sql/production-release-cases.sql
```

`node scripts/validate-production-release-migration.mjs` separately verifies that the copied function changes only its nullable release comparison. That static check is not a substitute for the PostgreSQL job.
