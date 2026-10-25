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
its relational week remains approved, its fingerprint agrees with the stored
week and a single current-source hash, and all eight frozen sections still agree with their current approved
section ID/version/fingerprint. Multiple active packs, malformed section shapes,
draft/reapproval status, or approval drift fail closed. An old week can be read if
its pack is still active and approved; inactive packet history is never returned.
The read does not regenerate schedules, rebuild conflicts, or load a broad
planner snapshot. It calls the existing pure internal
`weekly_planner_source_fingerprint` once after authorization and active-pack
checks because production source writes do not all invalidate the active flag.
The hash is never returned. Fresh publication is required after source drift.

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
active/approval/version/shape drift; actual production assignment mutation and master revision
drift; renewed publication; unchanged state/audit; real manager
publication and existing supervisor reads. No hosted data or real identity is
included. Local PostgreSQL verifies database behavior, not hosted GoTrue JWT
validation, PostgREST schema exposure, Realtime, or production ACL parity.

Performance caveat: the existing fingerprint includes date-filtered production
and installation sources **and all `jobs` records**, hashing their JSON. The
number of calls is bounded to one per authorized active-pack read; its work is
not bounded independently of database size. The disposable probe records 25
read timings on synthetic data only, not hosted-load evidence. Before rollout,
review source cardinalities/query plans and expected concurrent employee reads;
if unsuitable, optimize the shared invalidation/read-version design separately.
Never omit freshness or expose raw source data as a performance workaround.

Before authorized release: compare deployed schema/ACL definitions for drift,
confirm the private schema is not in exposed API schemas, review approved-field
content policy, run the exact combined backend/frontend CI and phone acceptance,
and obtain separate migration and account-scope approval. Do not add broad
planner grants to make an employee screen work. If rollout must be disabled,
remove the exact employee navigation opt-in through an authorized access change;
do not loosen the endpoint or underlying RLS.
