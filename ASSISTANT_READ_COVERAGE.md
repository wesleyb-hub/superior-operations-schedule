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
| Weekly Planner summaries | `get_weekly_planner_agent_context` | Existing current/next-two-week summaries, crew counts, readiness, approval/stale state and conflicts. |
| Weekly Planner current-week detail | `get_weekly_planner_snapshot` | Named people, sections, assignments, availability, resources, conflicts and week/source-stale metadata for the server-derived current Chicago Monday. Existing whole-week view authorization (not section-filtered). Packs, cross-week recent packs and audit excluded. No generation, staffing, approval or publish call. |
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

Synthetic mocks cover all seven read RPCs, master collections, catch-up cards,
recorded versus planned LF, restricted empty collections, base denial, optional
permission denial, missing/malformed data, transport failures, Chicago midnight
and DST, and the unchanged three proposal types/caller-JWT boundary. Additional tests cover named employees and assignments, denied detail access, Chicago Monday boundaries, whole-source omission/counts, total payload limits, and UTF-8 byte accounting.

These are local adapter/contract tests, not proof of live database policy or
model answer quality. Deno is not installed in this workspace; Edge typechecking
and authenticated deployed smoke tests have not run. No live rows were read or
changed and no deployment was performed. Before deployment, validate
with separate admin and restricted test accounts and actual representative data
volumes. Before serialization to the model, each top-level source is limited to 32 KiB
of UTF-8 JSON and the complete context to 96 KiB, with one deliberate exception:
master-schedule collections are each bounded independently at 32 KiB rather than
applying that threshold to the whole master schedule. These conservative ceilings
prevent history or pack-like operational payloads from consuming an unbounded
model request; they are byte budgets, not an exact tokenizer estimate. At the
per-source ceiling, omit the entire source. For the master schedule, omit only
the oversized collection: retain the other complete collections, set the master
status to `partial`, list `omitted_collections`, and record each omitted
collection's returned/omitted count, original bytes and reason in `coverage`.
This prevents large audit/archive history from hiding normal jobs, Walls or
billing. At the aggregate ceiling, omit whole
largest remaining sources until the payload fits. Never retain a biased prefix
of rows or silently shorten text. Other sources remain intact.

Each omitted source has `status: omitted`, a per-source/total-limit reason,
original byte size, and counts of its withheld caller-returned arrays.
`context_coverage` lists omitted sources and master collections and marks partial
coverage. If the aggregate budget requires omitting the entire master source, its
omitted counts include collections already omitted by the per-collection limit. Counts are
not company-wide workload totals. The prompt explicitly prohibits complete
coverage claims or totals across unavailable/omitted data. It preserves the
source failure statuses separately from size omissions.

These bounds protect the model request, not the size of the RPC response fetched
by the Edge Function. No new database query API is introduced. A narrower user
question does not automatically rehydrate an omitted source; scoped server-side
retrieval would be a separately reviewed enhancement. Existing RPC date windows
and source-derived resource-conflict rules remain unchanged.

## Monthly wall completion accuracy

`wall_completion_month` is computed from the complete caller-returned
`get_schedule_snapshot().payload.data.walls` before model detail limits. It
matches the Hub `renderWallsMonthly` calculation after the same `normalizeWallLF`
and `normalizeDate` read-only normalization (parity-tested against frontend helpers): select the current Chicago
month using `completedDate.slice(0,7)`, falling back to `completedMonth`, then sum
`Number(lf || 0)`. No status/active filter is added. Do not add historyArchive,
production assignments, billing, or weekly forecast rows to this metric.

This small summary is independently bounded and includes source revision,
completed job count, month-only count/LF, future-dated count/LF and dated-through-
today LF. Month-only records are included in the Hub KPI but cannot prove an
exact completion day. A future-dated record is included by the Hub monthly
calculation but cannot count as verified completed through today. Totals remain
caller-visible, not a claim of company-wide permission coverage. Missing,
denied, malformed or size-omitted summaries cannot become zero or a partial
production-based substitute.

A narrow deterministic route answers simple current-month LF-completed questions
without model arithmetic. It reports the Hub KPI and date limitations and requires
that the summary month still matches the reporting month. Recognized LF-completed
questions for other months, job/customer filters or comparisons get a deterministic
unavailable-scope answer, never a current-month substitute. Other wording remains
covered by the system prompt; no parser or model behavior is claimed to support
arbitrary historical analytics. Action requests do not match the read-only route. This change adds no RPC calls, database objects,
grants, or production writes. Historical/daily actual-pour analytics remain a
separate enhancement. Synthetic regressions run in the existing agent test job.


## Provider reliability boundary

The Edge function makes one Responses API attempt with a 45-second deadline
covering connection and body reads, `max_output_tokens: 4096`, a 256 KiB UTF-8
response-body cap, and `store: false`. A completed, well-formed response is required;
incomplete output (including token exhaustion), failed statuses, malformed bodies,
missing identities and multiple action calls cannot create a preview. Provider
errors are sanitized, including logs, rather than echoing upstream messages. No
automatic retries are made. Timeouts produce a structured 504 response; service
failures are 502 and rate limiting is 503.

A lost preview RPC response (thrown transport error or Supabase status 0) is
reported as an uncertain preview outcome, not proof that nothing was saved. It is
not automatically replayed. No operational mutation can run through the Edge
function; the existing separate human-confirmation RPC remains authoritative.
Missing/malformed inventory and production sections are unavailable, not empty
workloads. Record strings remain untrusted data and never become system
instructions or a new tool. This is a deterministic boundary test, not a claim
that a live model has been proven immune to all prompt injection.

Offline verification: `node --test scripts/test-operations-agent-context.mjs
scripts/test-operations-agent-provider.mjs`. The provider suite executes the Edge
handler with synthetic caller RPCs and provider transports, including stalled
headers/body, outages, malformed and bulk output, omission/permission scope,
record-injection strings, historical/filtered completion questions, and uncertain
preview outcomes. It never calls live Supabase, OpenAI or a deployed Edge function.
The existing pinned Deno CI job remains the deployment typecheck gate.


API contract reviewed against official documentation on 2026-10-22:
[Responses create](https://developers.openai.com/api/reference/resources/responses/methods/create)
(output-token ceiling, completion statuses),
[Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses)
(`store: false`), and the
[GPT-5.4 model page](https://developers.openai.com/api/docs/models/gpt-5.4)
(the configured default supports Responses/function calling). `store: false`
disables response retrieval storage; it does not itself enable Zero Data Retention.
The 45-second provider budget is below Supabase's documented
[150-second request idle timeout](https://supabase.com/docs/guides/functions/limits);
it is not an end-to-end timeout for the existing context/proposal RPCs.
