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

## Internal planner-helper authorization

`probes/planner-helper-permissions.sql` runs after `walls-workflow-cases.sql`.
It adds only synthetic identities/grants in a transaction that rolls back. It
verifies that direct conflict recomputation is denied to every client role while
guarded SECURITY DEFINER generation, input/section save and approval still work.
The matrix includes a viewer, scoped editor, approve-only scoped user, dedicated
publisher, unassigned/disabled users, and the existing synthetic manager. It also
checks that denied viewer calls leave the planner snapshot/audit unchanged.

```sh
node scripts/validate-planner-rebuild-privileges.mjs
psql -X --set ON_ERROR_STOP=1 -f tests/integration/probes/planner-helper-permissions.sql
```

This is not an assigned-only employee implementation or hosted account rollout.
See `EMPLOYEE-ACCESS-ROLLOUT.md` for the separate future identity/mapping contract,
deployment preflight and explicit production-authorization boundary.

The combined candidate incorporates the reviewed shared-modal and employee-lookup fixes. CI requires both `EXPECT_PLANNER_DRAFT_PRESERVED=1` and `EXPECT_MODAL_SAVE_RESET=1`: unsaved drafts must survive async names and delivery-to-installation Save must work without a reload workaround. The historical diagnostic workaround is forbidden by those flags.

## Mandatory-version and confirmation regressions

`probes/mandatory-version-tokens.mjs` executes eight existing write APIs as the
synthetic authenticated user: production reschedule, both inventory corrections,
planner save/approve, and installation activity/scope/resource writes. NULL,
stale, and (where defaulted) omitted tokens fail without changing rows, children,
or audit events; exact versions save once. Reader access remains denied. New-row
creation and APIs whose tokens were explicitly optional retain their semantics.

`probes/agent-confirmation-guards.mjs` exercises explicit confirmation, authenticated
requester ownership, valid inventory/production actions, stale/expired previews,
duplicate confirms, and a fixture-only incomplete pending preview. Tests never
replace permission checks or send email. `probes/billing-history-roundtrip.sql`
verifies the actual snapshot RPC retains four synthetic invoice-bearing rows after
source completion is cleared and after the source disappears; the frontend remains
responsible for retaining those rows before sending its snapshot.

All new fixtures roll back. Run after the SQL lifecycle fixture, against the same
loopback-only `superior_workflow_test` database:

```sh
node scripts/validate-integrity-guard-migrations.mjs
node tests/integration/probes/migration-prerequisite.mjs
node --test --test-concurrency=1 tests/integration/probes/mandatory-version-tokens.mjs tests/integration/probes/agent-confirmation-guards.mjs
psql -X --set ON_ERROR_STOP=1 -f tests/integration/probes/billing-history-roundtrip.sql
```

The guard validator checks each replacement against its effective preceding
migration: only the reviewed comparisons/authentication guard differ. It also
rejects unrelated top-level SQL, including data and permission changes. These are
prepared repository repairs, not proof of hosted deployment or hosted ACL parity.

The version migration refuses to apply until both allocation-mutex function
definitions are present. `migration-prerequisite.mjs` verifies both missing-
prerequisite cases in local rollback fixtures, restoring every function definition
and ACL after each test. Apply existing migrations in order; do not use this
follow-on migration as an alternative deployment of a prerequisite.
