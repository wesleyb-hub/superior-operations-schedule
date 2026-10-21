# Disposable workflow integration

This test applies actual committed SQL migrations to a fresh PostgreSQL17 service,
then runs synthetic jobs through real functions and browser button handlers.
No hosted project, business records, real credentials, or live Auth users are used.
The test server rejects non-loopback hosts and any database except
`superior_workflow_test`; browser network is limited to that local server.

`baseline.sql` is a minimal compatibility fixture for dependencies presumed by the
first committed migration (Auth helpers, roles, legacy schedule tables). It is
inferred from public application references, **not** a complete Supabase schema or
privilege export. Actual committed authorization functions and RLS execute after
migration. This does not certify parity with hosted default privileges.

The browser adapter substitutes only Auth, transport and Realtime providers. RPCs
execute with transaction-local synthetic identity claims under the authenticated
PostgreSQL role; business gates, persistence, version checks and RLS are not mocked.
GoTrue password/JWT validation, Supavisor pooling, Realtime delivery, email and AI
providers are not exercised. Screenshots contain synthetic fixture data only.

Run with PostgreSQL17 and the same environment variables/dependencies as
`.github/workflows/disposable-workflow-integration.yml`.

## Coverage and limitations

- `walls-workflow-cases.sql`: actual plan-review gates, production allocation,
  setup/pour/curing/strip, parallel site/stone preparation, final QC, shipment,
  installation scope/closeout, revision rejection and authenticated-role RLS.
- `workflow-browser.mjs`: Oct26 generation, prior-week employee lookup, staff
  save/reload, eight approvals, immutable packet publication, real held-work
  rejection/correction, mobile layout, sign-out and the authorized agent's
  monthly-completion calculation compared with the Hub.
- `production-browser-lifecycle.mjs`: actual plan-review and master-edit controls,
  production assignment/board/stages, final QC, delivery mapping/status,
  installation activity/scope and closeout forms. Only the initial synthetic job,
  shipment and configured production table are seeded through real SQL RPCs.
- `run-known-probes.mjs`: baseline deliberately reports four **KNOWN FAILURE —
  NOT FIXED** SQL regressions; `--strict` requires corrected behavior. A separate
  delayed employee-provider browser probe records the unsaved-draft regression;
  `EXPECT_PLANNER_DRAFT_PRESERVED=1` makes preservation mandatory after its UI fix.

A green baseline means positive flows passed and known defects were reproduced;
it does **not** mean those defects are fixed. Inspect the mode and individual
results in the synthetic-only workflow artifacts. Screenshot and result files
are retained for seven days by CI.

The fixture includes only the function-EXECUTE defaults documented in Supabase's
[public bootstrap](https://github.com/supabase/postgres/blob/develop/migrations/db/init-scripts/00000000000000-initial-schema.sql),
so authenticated RLS helper calls and historical employee reads run normally.
This is not a hosted privilege export or a certification of hosted ACL parity.
Actual hosted Auth/JWT verification, Realtime delivery, email delivery and the
external model provider remain outside this disposable test.
