# Employee projection candidate — not a production rollout

This source candidate supports division-wide **Walls Production and scoped Inventory**.
It does not implement personal assignments, change a user/grant/business row, invite
an employee, or authorize deployment. Keep the frontend navigation candidate separate.

## Authority and compatibility

- Existing Operations admins retain their original full data and write paths.
- Existing independent `walls_production_access.can_view` grants retain the original
  production snapshot/direct-table access. Existing scoped `inventory_user_access`
  grants retain their original scoped inventory rows and event history. These are
  deliberately additive authorities, not constrained by a separate employee row.
- Employee-only production reads require an enabled Auth-UID employee row with exact
  `walls` / `production` scope and the `walls` view. Install-only and Boxes grants
  no longer imply Walls Production. No display-name, editable metadata, or roster
  inference is used.
- Employee app navigation is a deterministic union of actual Production and Inventory
  capabilities; Walls exposes Production, not the master/planning/financial subviews.
  A previously explicit Installation subview plus independent Installation view
  grant is retained; an employee install-area grant alone never grants Field access.
  An existing explicit `weekly-planner` view on a Walls Production employee row may
  expose the separate approved-pack route, never the broad planner RPC. That route
  requires its independently reviewed backend projection and frontend implementation.
- Inventory view/count/manage flags and every write gate remain unchanged. Count
  results now use the same safe item fields as reads for employee-only callers.
  Partial production writers without a full-read supervisor grant receive projected
  command results; a corrupted non-Walls target returns no operational fields.
  Existing independent write authorization is not converted to new scoped-write
  semantics by this migration; production-write pilots need a separate action/scope gate. Employee assistant action responses allowlist the exact target/value/version
  parameters needed for confirmation and omit arbitrary parameters and old result JSON; raw historical rows are unavailable, including after disablement.
  This is **not** approval to grant count, receiving, ordering, or management rights.

## Data contract

Employee master Walls data explicitly includes job identity/model/project/development,
address, production date, linear footage and six height totals, and completion markers.
Only primitive values are retained; objects/arrays under nominally scalar keys are
omitted. There is no raw `data - privateField` or arbitrary nested JSON passthrough.
All other master collections remain empty, and the source editor email is omitted.

Production supports Today, 5-Day Flow, Table Board and Weekly Forecast. It preserves
work times, table/run IDs and labels, heights, quantities, stage/progress, readiness,
review flags, production assignment notes and issue category/description (operational
work and safety instructions). It omits table/admin notes, event history and actors,
customer fields, arbitrary source JSON, and unclassified document links. Forecast
baselines expose only explicit fields and re-aggregate permitted Walls records.
Frozen quantities/dates stay frozen; job/model display labels are read from the current
sanitized job, because old captures may have serialized an arbitrary JSON object
into a string. Historical labels are not an independent employee data authority.

**Document release gate:** legacy job `links` have no per-document classification.
A production-approved job can still contain an unrelated link. Employee document
links therefore remain empty; managers retain their existing links. Before relying
on phone drawings, approve an explicit released-production-document source and test
its access. Do not restore the arbitrary links array just to make a button appear.

**Text release gate:** operational assignment notes and production issue descriptions
are intentionally shared. Review their established use for private/admin content
before pilot; classification cannot be inferred from free text. Master job notes,
plan review, forecast source JSON and resolution notes are not shared.

Inventory has one guarded `get_inventory_snapshot(division, area)` API. Employee items
include ID/code/description/category/unit/count/threshold/ordered/version/update time
and scope; actor/order metadata and event history are absent. No API failure falls
back to raw REST. The response scope and arrays are validated before UI adoption.

Restrictive SELECT policies block employee-only raw schedule metadata, production,
forecast, inventory items/categories/events/outbox and historical assistant action rows. Existing permissive policies and
independent supervisor permissions remain in force. RLS is not column filtering;
these blocks are required even if a browser selects fewer columns.

**Realtime limitation / release gate:** employee UI does not subscribe to raw tables;
use explicit Refresh/navigation reload and confirmed-save refresh. Supabase checks
SELECT RLS for INSERT/UPDATE delivery, but DELETE events are not row-filtered and
can disclose primary keys to a custom subscriber with the shared authenticated
role's table privileges. This candidate does not change publication settings or
certify zero identifier leakage. Inspect deployed publication/replica identities/PK
columns and perform an authorized isolated Realtime negative test before pilot. If
those identifiers are sensitive, obtain an explicit decision on publication/notification
changes before release; do not silently weaken RLS or redesign realtime. Existing
manager/independently granted supervisor subscriptions are retained, including
recovery after an initial load failure and full-read capability transitions.
Reference: https://supabase.com/docs/guides/realtime/postgres-changes

## Validation and release sequence

1. Require the exact candidate's disposable PostgreSQL role-matrix regression and
   existing workflow/browser/security checks. The test database uses synthetic Auth
   stubs, not real GoTrue/JWT validation, hosted Realtime, or a production PostgREST
   schema cache. Passing local SQL is not a hosted-device acceptance test.
2. Compare current deployed function definitions, policies, ACLs and grants for drift
   before application. Check for legacy Walls records with NULL/invalid division:
   employees fail closed rather than silently treating them as Walls. Resolve any
   data-quality discrepancy only with separate authorization. Review all grant paths for the chosen account; an overlapping
   explicit supervisor, manager, installation or planner grant intentionally carries
   independent access and invalidates an employee-only privacy claim.
3. Obtain explicit approval to apply **only** the reviewed migration on the intended
   production project. A PR merge or frontend approval is not migration approval.
   No automatic deploy/apply is part of this work.
4. Apply backend first: it adds the inventory RPC before the new loader requires it.
   Old employee inventory clients will fail closed after the raw SELECT restriction;
   coordinate a short maintenance window / forced refresh. Deploy the paired frontend
   promptly. Existing manager clients remain compatible.
5. Separately obtain the exact pilot action permissions and identity/account delivery
   authorization, preserving all other users. Verify negative direct-table/RPC tests
   and a supervised phone read/count test only with the approved account/actions.
   No pilot credentials, real customer data or employee identity belongs in fixtures.

## Known source/hosted drift: ordering response only

Read-only comparison of 22 existing function bodies found 21 semantic matches.
`mark_inventory_ordered(bigint,bigint)` is the exception: current repository alert
recovery appends the suppression reason to prior `last_error` and excludes alerts
whose `next_attempt_at` is infinity; the hosted body overwrites `last_error` and
has no infinity exclusion. Neither behavior is silently substituted for the other.

This migration checks the exact known live/source bodies (normalizing CRLF only),
owner, security mode and search path, then replaces exactly one return expression.
`pg_get_functiondef` preserves whichever known implementation is present, including
its signature, mutation body, execution configuration and existing ACL identity.
Already-projected known versions are an idempotent no-op; any unknown body/config
aborts the migration transaction for review. No inventory-alert recovery prerequisite
or alert-state rewrite is bundled into this employee rollout. A later independently
approved recovery migration must preserve the employee response projection.

## Recovery

Prefer a forward correction. Reverting only the frontend after applying the migration
will leave employee raw inventory reads unavailable (safe failure); it does not undo
server safety. Reverting the server policies or broad snapshots reopens prior data
exposure and needs explicit production approval plus removal/disablement of the pilot
until re-verified. Never automatically regrant raw tables or roll back grants to make
an error disappear. Preserve operational records and existing supervisor workflows.

Current reference checks: Supabase changelog and RLS/security-definer documentation
were consulted on 25 October 2026. The relevant platform distinction is that RLS
filters rows, while SECURITY DEFINER APIs require their own field/scope authorization.

## Candidate evidence (25 October 2026)

- All 376 standalone Node tests and all non-browser static validators pass.
- A fresh disposable PostgreSQL 17.10 cluster applied every committed migration in
  filename order, then passed the existing management lifecycle, both employee
  permission/projection probes, planner-helper, billing, named-table, production
  release, revision, mandatory-token, agent-confirmation and concurrent-allocation
  regressions (354 SQL/runner PASS notices and 16/16 database-backed Node tests), including
  the final missing-UID/internal-capture checks, malformed-division command/action
  response cases, and seven known-source/live/drift guard cases. Auth is a synthetic
  test stub. The guarded patch preserves body/OID/owner/ACL/config and is idempotent
  for both known variants; unknown drift is rejected without changing the function.
- Actual Chromium workflow tests could not start locally: sandbox Unix `socket()`
  permission denied; the scoped launch retry failed in environment setup. No local
  browser pass is claimed. Required browser CI on the exact integrated frontend /
  backend commit and supervised phone acceptance remain release gates.
- Hosted PostgREST, GoTrue, Realtime DELETE behavior, deployed privilege/default-ACL
  fidelity and candidate Supabase advisor checks have not been verified by this
  local PostgreSQL run. Read-only catalog preflight is not a live permission test.

Read-only hosted catalog preflight at 14:02 UTC found zero Walls records with NULL
or non-Walls division. In the requested inventory/production/planner families,
published tables use default replica identity and DELETE publication is enabled:
Inventory items (`item_id`), Production assignments/events/issues/tables
(`assignment_id`, `event_id`, `issue_id`, `table_id`) and planner conflicts/sections/
weeks (`conflict_id`, `section_id`, `week_start`). `schedule_records` and the
requested named/auth/email-key tables are not published. Thus the identified DELETE
risk is primary-key identifiers/business metadata (not a demonstrated billing,
customer, notes or actor payload); table IDs and week dates still carry meaning.
This metadata inspection did not execute a live deletion or validate delivery.
