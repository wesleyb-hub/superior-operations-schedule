# Operations Assistant read coverage

This change adds reads only, using the same anonymous API key plus the caller's
Bearer JWT as the existing Edge Function. Existing RPC authorization is the
boundary. There are no new grants, direct-table queries, service-role access,
planner writes, or changes to the three existing confirmation-gated proposals.

## Coverage matrix

| Hub area | Context source | Coverage and limits |
| --- | --- | --- |
| Inventory | `get_operations_agent_context` | Caller-visible items, stock, thresholds, ordered state, version, adjustment permission. No purchasing or alert-delivery status. |
| Walls production | `get_operations_agent_context` | Existing active assignment window, stage, setup progress, planned and cumulative actual LF. No new production permissions. |
| Today's actual production | `get_walls_production_weekly_forecast` | Current Chicago reporting week's daily planned LF and event-recorded actual LF, baseline and assignment dates. Missing/denied source cannot be reported as zero. No baseline capture RPC is called. |
| Walls preconstruction/release | `get_schedule_snapshot` → `walls` | Exactly the caller-visible job records and milestone data. Restricted snapshot may omit `planReview`; absence is not approval. |
| Box culverts and precast | `get_schedule_snapshot` → `jobs` | Existing project/product schedules and QC status, as permitted by the snapshot. Restricted users receive empty collections; never interpreted as a company-wide zero. |
| Billing | `get_schedule_snapshot` → `billing` | Existing billing records/status only where caller can read them; no financial action. |
| Deliveries | `get_schedule_snapshot` → `loads`, `deliveryHistory` | Existing loads/status/history; no status transition, shipment commitment, or load-sheet generation. |
| QC and history | `get_schedule_snapshot` → `qcHistory`, `audit`, `historyArchive` | Caller-visible recorded history; no approval/release authority. Backup payload and system settings deliberately excluded. |
| Weekly Planner | `get_weekly_planner_agent_context` | Existing current/next-two-week summaries, crew counts, readiness, approval/stale state and conflicts. Not full assignment/employee detail; no generation, staffing, approval or publish call. |
| Walls Installation summary | `get_walls_installation_agent_context` | Existing active-job/activity/resource/QC summaries. |
| Installation Today/workspace | `get_walls_installation_snapshot` | Existing job-linked activities, catch-up cards/tasks, resources, issues, closeout, QC, delivery links and source-reported conflict warnings. Explicit date window: reporting day −7 through +45. Not all historical installation activity. |
| Administration/integrations | Not added | No employee-account management, secrets, grants, backup/settings contents, mail delivery status or external systems. |
| BOM/costing/design | Not inferred | No approved BOM, quantities, labor standards, catalog heights, accounting codes, bed-layout or load-sheet generation. |

A source's `available` status means its RPC returned readable data, **not** that it
contains every company record. Each master collection reports `returned_count`;
missing collections are explicitly `unavailable`. Transport/RPC failures remain
`unavailable`, not empty or presumed unauthorized. An explicit agent RPC
`authorized: false` becomes `not_authorized`. SQL permission errors do not expose
any accompanying data. The mandatory base-context authorization gate still fails
closed and prevents sending any context to the model.

## Reporting date and workflow

`reporting.generated_at` is the trusted Edge/server clock, with `reporting.today`
derived in `America/Chicago`, matching existing production forecast SQL. Browser
clock/client input cannot set it. The forecast query receives that calendar date;
its existing RPC resolves the containing week. Date-only schedule fields remain
calendar dates; timestamped events use Chicago dates. Planned production is not
actual production, and cumulative assignment LF is not today's output.

The prompt follows the supplied 2026-10-20 workflow: the morning inspection is
recorded by Final QC Release, not a second physical inspection; site/stone work
remains distinct from wall installation; field responsibility depends on the
contract. Unrecorded steps/materials are not invented. Record text remains
untrusted data, never instructions.

## Local verification and release limits

Run:

```sh
node --test scripts/test-operations-agent-context.mjs
node scripts/validate-operations-agent.mjs
# Run the existing validate-*.mjs scripts as the aggregate repository guards.
```

Synthetic mocks cover all six read RPCs, master collections, catch-up cards,
recorded versus planned LF, restricted empty collections, base denial, optional
permission denial, missing/malformed data, transport failures, Chicago midnight
and DST, and the unchanged three proposal types/caller-JWT boundary.

These are local adapter/contract tests, not proof of live database policy or
model answer quality. Deno is not installed in this workspace; Edge typechecking
and authenticated deployed smoke tests have not run. No live rows were read or
changed and no deployment was performed. Before deployment, validate
with separate admin and restricted test accounts and actual representative data
volumes. Full caller-visible schedule history is passed without silent truncation;
large snapshots may need a separately tested bounded retrieval design. Existing
RPC date windows and source-derived resource-conflict rules remain unchanged.
