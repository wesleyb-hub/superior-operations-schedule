# Employee approved division packs: read contract

Source candidate only. This migration does not provision an account, change any
employee permission row, add planner grants, or authorize deployment. Apply only
with separate production approval after the exact combined candidate passes CI.

## Authority and scope

`get_employee_approved_crew_packs(p_week_start date)` requires all of these on the
**same** server-managed `app_employee_access` row:

- Authenticated, non-anonymous Auth UID; enabled employee row.
- Exact division `walls`, area `production`.
- Explicit `weekly-planner` in `allowed_views` (the existing frontend route key).

Existing profile names do not confer this opt-in. Inventory/production access
alone is insufficient. Claims in `user_metadata`, names, or a grant from another
division cannot authorize it. No account receives this permission in the migration.

The allowed three sections are `walls_production`, `table_flow`, and
`walls_stripping_loading`. This is a **Walls production division pack**, not
personal assignments or proof of individual crew membership. The present model
has no verified employee-to-crew identity relation. Installation, boxes, logistics,
QC, maintenance, and their people/duties are excluded.

## Publication and output

One Monday must be requested. The result is:

```text
{permissions:{view:true,edit:false,approve:false,publish:false},packs:[pack]}
```

`packs` is empty unless exactly one active published pack exists for that week,
its relational week remains approved, its stored fingerprint agrees with the
stored week, and all eight frozen sections still agree with their current approved
section ID/version/fingerprint. Multiple active packs, malformed section shapes,
draft/reapproval status, or approval drift fail closed. An old week can be read if
its pack is still active and approved; inactive packet history is never returned.

### Scoped planned-data freshness, including legacy packs

The global live source fingerprint is **not** a freshness test for this employee
projection: it includes all jobs, the global master revision and ordinary execution
versions/stages. Instead, a private read-only helper finds exactly one existing
`weekly_planner_source_snapshots` row with the pack's week and approved fingerprint,
created no later than publication. Existing planner generation has always stored
this baseline; no backfill, new approval, source write or publication is performed.
Missing, duplicate, malformed or post-publication baselines fail closed.

The historical/current production assignment sets must agree in both directions.
The compared planned fields are assignment ID, schedule collection, authoritative
Walls job ID, table ID, wall height, planned LF, and setup/pour/strip timestamps.
Additions, deletion, cancellation, movement into/out of the week, changed planned
values, or a malformed non-Walls production target require review. A new explicit
`needs_review` hold or a changed reason on an approved hold also hides the pack.
An unchanged approved hold is preserved; clearing it does not rewrite the frozen
plan. Stage/setup progress, actual poured LF, row versions/timestamps/actors and
execution notes are not schedule changes. Real progress through stripping leaves
an otherwise valid approved pack visible; cancellation is not completion.

Approved labels, locations, work instructions and crew names remain **frozen
approved text**, not a live master-data mirror. Legacy baselines do not consistently
include production-only master labels, so the endpoint neither guesses their old
values nor rebuilds approved text using current labels. Changing the actual job ID
is detected; changing approved planner text/crew through the existing save workflow
invalidates approval. This contract does not detect a privileged out-of-band change
that bypasses existing planner version/invalidation controls.

This removes incidental global-hash false staleness, **not existing publication
invalidation policy**. Existing manager workflows can deliberately deactivate a
whole pack or change week/section approval status, including installation, resource,
availability, issue or QC changes. Those invalidated packs still remain hidden;
this candidate does not change triggers, reactivate packs, auto-approve, republish,
regenerate schedules, rebuild conflicts, or return broad source snapshots. The
stored fingerprint remains an approval/provenance binding, not a live global gate.

Explicit output keys:

- Pack: `pack_id`, `week_start`, `pack_version`, `is_active:true`, `published_at`.
- Snapshot: relational `week_start`/`week_end`, filtered `sections`.
- Section wrapper: `section`, `people`, `assignments`.
- Section: fixed `section_key`, fixed `section_name`, fixed `sort_order`,
  `status:'approved'`, string `crew_leader`.
- Person: string `employee_name` only.
- Assignment: `work_date`, `project_location`, `assignment_text`, `start_time`,
  `status_hold`, `backup_instructions`; only dates inside the requested Mon–Fri.

Every snapshot-derived display value must be a JSON string. Objects/arrays under
allowlisted text keys are never stringified. No arbitrary nested payload, raw
row, actor/email/UID, approval/revision/source metadata, resources, conflicts,
availability, readiness, audit, or administrative data is returned. Approved
operational text and crew display names intentionally remain; administrators
must keep unrelated confidential material out of those operational text fields.

The public RPC is SECURITY INVOKER. A non-exposed private-schema SECURITY DEFINER
function enforces the authority before reading protected tables; its search path
is pinned to `pg_catalog`. PUBLIC/anon execute defaults are explicitly revoked.
The pure text helper is not callable by clients. Calling the guarded private
function directly through SQL provides no bypass.

## Frontend integration and unchanged management

Employee navigation uses the existing `weekly-planner` key but calls **only** the
new RPC and shows a read-only approved-division-pack view. It must never fall back
to the full planner loader if the RPC fails. Do not show draft/review/approval,
revision/history, edit, publish, or readiness controls. The companion employee
scope migration exposes this navigation opt-in only for supported scope.

No changes are made to `weekly_planner_permission`, planner table RLS, or existing
manager/supervisor functions. Independent planner grants retain their existing
behavior; granting `allowed_views` is **not** a planner grant. A rollout must check
for independently held broad permissions rather than claiming this projection
revokes them. Existing management remains on its original loader/controls.

## Verification and release limits

Run against an empty, disposable PostgreSQL17 database:

```sh
node scripts/validate-employee-approved-packs.mjs
bash tests/integration/apply-schema.sh
psql -X --set ON_ERROR_STOP=1 -f tests/integration/walls-workflow-cases.sql
psql -X --set ON_ERROR_STOP=1 -f tests/integration/probes/employee-approved-crew-packs.sql
```

CI runs the same actual committed schema and functions, with synthetic users and
rollback fixtures. It covers both existing profiles; absent/disabled/anonymous,
wrong division/area, split grants, and user metadata; all twelve raw planner
tables; broad snapshot/source/agent and mutation bypasses; scalar-field injection;
active/approval/version/shape drift; real planned-assignment rescheduling and
cancellation; additions/removal/reparenting/wrong-division targets; malformed legacy
baselines; real setup/pour/strip progress; irrelevant global revision and other-division
master changes; explicit existing installation invalidation; renewed publication;
unchanged state/audit; manager publication and existing supervisor reads. No hosted
data or real identity is included. Local PostgreSQL verifies database behavior, not
hosted GoTrue JWT validation, PostgREST schema exposure, Realtime or production ACL parity.

Performance: the helper reads one indexed historical source snapshot and compares
only in-week production assignments plus their authoritative Walls membership. It
no longer hashes all jobs or installation data. Work still scales with that snapshot
and production-table size; synthetic timings are not a concurrency or production
SLA guarantee. Before rollout, review current cardinalities/query plans and actual
role/API behavior. Never omit the planned-data comparison as a performance workaround.

Before authorized release: compare deployed schema/ACL definitions for drift,
confirm the private schema is not in exposed API schemas, review approved-field
content policy, run the exact combined backend/frontend CI and phone acceptance,
and obtain separate migration and account-scope approval. Do not add broad
planner grants to make an employee screen work. If rollout must be disabled,
remove the exact employee navigation opt-in through an authorized access change;
do not loosen the endpoint or underlying RLS.
