# Workflow reference and UI checks

## Static check (CI)

Requires Node.js 22 or newer; no packages or service credentials:

```sh
node scripts/validate-workflow-guidance.mjs
```

Checks inline JavaScript syntax, required physical-workflow distinctions, reference visibility scope, focus styling, and reduced-motion rules. It does **not** verify backend workflow gates.

## Rendered check (isolated CI validation job or local)

Requires Node.js 22+, pinned Playwright 1.56.1, and its matching Chromium. CI installs these ephemerally in a separate read-only validation job; no package manifest, lockfile, service credentials or deployment step is added. For a disposable local checkout:

```sh
npm install --no-save --package-lock=false playwright@1.56.1
npx playwright install --with-deps chromium
node scripts/validate-workflow-ui.mjs /tmp/hub-ui-check
```

The harness defaults to Playwright's bundled Chromium. Set `CHROMIUM_PATH=/path/to/chromium` only when explicitly selecting an existing executable. CI retains screenshots/results as an artifact for seven days, including on failure. Dependency installation uses network access; the browser test itself intercepts all page requests. The harness intercepts browser requests, serves the checked-out HTML in memory, strips external scripts (including configuration and Supabase), and aborts all other requests. Synthetic wall, production, installation, precast and inventory records exercise populated screens; numbers and names are test data, not business defaults. Planner and administrative views also exercise empty states. No live workflow writes or service calls occur.

The harness captures 1440px and 390px layouts, checks page overflow and render errors, tests keyboard opening/closing of workflow help and its navigation visibility, and checks reduced motion. Screenshots still need human visual review. It does not test authenticated service integrations, saving, approval gates, all modal flows, or production concurrency.

Production-release regressions also exercise a synthetic strip click, refreshed production snapshots that omit completed jobs, full-page reload, explicit release holds, and missing source data at both widths. The strip RPC adapter changes only the assignment stage; schedule completion remains independent. These checks use in-memory service responses, not live workflow writes or backend-gate validation. Their screenshots are named `*-production-stripped-release.png` and `*-production-stripped-hold.png`. The same source-resolution rules have service-free unit coverage in `node --test scripts/test-production-release-labels.mjs`.

## Current verification status

Static guidance and existing repository checks passed. **Local rendered check has not completed; no local visual signoff.** The isolated CI job must pass and its screenshot artifact must be reviewed before claiming visual signoff. In the task environment, Chromium launch was blocked at its local process socket; an escalation attempt failed before execution due to sandbox infrastructure. The supported cloud browser rejected file URLs. A foreground local HTTP preview process was then started, but cloud-browser and separate-shell requests received connection refused. A same-process HTTP diagnostic succeeded, indicating isolated localhost contexts. No further browser workaround was attempted.

Run and review the rendered check in an environment that supports local Chromium before claiming desktop/mobile visual validation. The workflow panel is reference guidance only, not implementation of new CNC, pad/column, contract-scope or QC gates.

## Weekly Planner bounded snapshot transport

`node --test scripts/test-weekly-planner-snapshot-queue.mjs` runs the actual inline renderer, request queue, manual/realtime handlers, generic mutations and session reset against synthetic deferred transport. It covers one physical read at a time, coalesced latest context, post-write freshness, failures, replaced sessions and fixed privacy-safe request attribution. Set `PLANNER_SOURCE` to an exact baseline HTML file for negative controls. The earlier refresh tests now require serialized fresh reads rather than overlapping forced reads.

The fixed `x-client-info` release marker is `superior-hub/planner-queue-20261022`; trigger values are an allowlist, never operational inputs or identities. The bound is per browser context, not across tabs/devices. It does not by itself prove the requested <=30-second authenticated save-and-approve latency. Local Chromium launch in this task was blocked before tests by a process socket restriction; offline CI browser results and measured live workflow timing remain separate required evidence.

Lost mutation responses are not treated as confirmed rollback: SDK status 0, ambiguous gateway timeouts, and explicit transaction-outcome-unknown codes retain inputs and mark affected local approval status unverified. Structured SQL cancellation/raised errors and pool-acquisition timeouts remain definite failures. Unknown generate/input-save outcomes neutralize the affected approval badges, readiness text, counts and Publish action without replacing form nodes. Unknown publication instead directs the user to verify packet history. No mutation is automatically retried; authoritative refresh is required to restore approval certainty.

An uncertain packet publication also keeps a publish-only verification latch for that user and week. Cached, failed, superseded, unrelated-week, or malformed snapshot results cannot unlock another publication. A successfully accepted fresh snapshot containing packet history clears the matching latch; no second packet is published automatically. Section approvals and immutable packet history are not rewritten by this recovery state.

After a gateway/network response loss, the original server request may still complete. Refresh observes current packet history; unchanged history does not prove rollback or guarantee that retrying cannot create another packet. The client latch is a verification barrier, not backend idempotency or an exactly-once publication guarantee.

## Full-access phone pilot (2026-10-23)

The phone presentation adds a Today task launcher, not a different identity or permission role. Management retains every prior sidebar destination and management actions under **More tools**. The launcher uses existing capabilities; crew packets are frozen read-only schedules, **not** identity-mapped personal assignments. Field Start/Complete/Hold/Resume remain management-only to match the current RPC contract; field issue reporting uses its existing separate capability. This frontend does not deploy SQL, alter user access, or implement assigned-job authorization.

The isolated CI job additionally runs:

```sh
node scripts/validate-mobile-pilot-ui.mjs artifacts/workflow-ui/mobile-pilot
node --test scripts/test-operational-modal-save.mjs
```

The touch-context harness uses 360/390/430 × 800 portrait and 844 × 390 landscape. It clicks the actual menu through all management views, checks scroll reset and initial work visibility, expands management tools, types inventory search without losing its caret, measures operational touch targets, tests count blank/zero distinction, reads escaped immutable crew packets without writes, preserves approval/publication uncertainty, and exercises failed/unknown Installation saves plus replacement sessions. All service adapters and identities are synthetic; other requests are blocked. Existing 1440/390 tests remain in the job for desktop and baseline regression coverage. Service-free tests cover returned status-0/gateway/unknown transaction responses, definite rejection versus uncertain outcome, old-session ownership, and manager blank-to-null semantics separately from physical-count validation.

**Required before release:** all CI checks pass and exact-head screenshot artifacts are reviewed. Browser emulation is not an actual iPhone/Android or employee authorization test. No local Chromium was launched for this work because the known process socket restriction remains.

**Wes's first-device checklist after separately approved release:** sign in normally; confirm all menu screens and More tools; choose Today → production/field/inventory; type a multi-letter inventory search; read Current count/Reorder minimum; open a form and cancel without a business change; rotate portrait/landscape; open keyboard and verify Save/Cancel remain reachable; read a frozen crew schedule and any hold/uncertainty wording; sign out and confirm the app cannot be keyboard-focused. Use synthetic or explicitly designated test records for deliberate save/failure trials. Production, QC release, dispatch, and job-completion gates remain distinct. Do not simulate poor connection during a real business mutation: an unknown response may have committed.

Before a later employee pilot, separately validate deny-default Auth-to-employee/assigned-job mapping and restricted backend permissions with positive and negative tests. Offline synthetic UI checks do not establish that security boundary. Wide planning tables remain horizontally scrollable management tools; the phone crew-packet reader avoids requiring employees to edit those tables.

## One Today screen, all divisions

Today keeps one navigation entry and offers authorized division cards for Superior Walls, Box Culverts, Manholes, Fence, and Block. Cards open the existing division schedule rather than claiming a date-filtered workload or personal assignment. Walls production, Walls field work, and Report a Walls issue are explicitly scoped; Inventory and Crew schedules remain shared tools. Restricted accounts only receive their existing allowed views/subviews, and each click rechecks those capabilities without granting access.

`node --test scripts/test-today-divisions.mjs` executes the actual launcher helpers against synthetic capability snapshots, including missing/unknown Walls subviews and access revoked after render. The isolated mobile-pilot harness additionally checks the five division cards, routes, shared-tool gates, one Today entry, and restricted profiles at 360/390/430 portrait, 844 landscape, and 1440 desktop widths. Existing phone checks remain intact. These tests do not establish live employee authorization or actual-device behavior.

## Employee-facing navigation completion (2026-10-25)

Restricted Overview reuses the authorized work-area launcher instead of showing
companywide Walls totals as “assigned” work. Management Overview and all existing
management destinations are retained. Search is shown only when its existing
view is allowed, and activation rechecks that permission.

Employee Production stays inside its four tabs: Today, 5-Day Production Flow,
Table Board, and Weekly Forecast. Field Work stays inside Today, This Week and
Resources. The parent Walls-management tabs are not mixed into those employee
modules. Inventory exposes only permitted scopes and count/read actions; employee
views omit purchasing preview and management activity history. Management's
controls remain unchanged. The employee Today Report a Walls issue shortcut is
removed for this rollout; no new issue module or write capability is added.

Employee Crew schedules uses only `get_employee_approved_crew_packs` for the
requested week and the existing explicit `weekly-planner` view opt-in. It never
uses the companywide planner snapshot. The client accepts at most one active,
published pack with approved permitted Walls-production sections, copies only
allowlisted display fields, and shows no drafts, editor, review, approval,
publication, readiness, administrative identity fields or historical packets.
Every intentional Read freshly checks the same active pack before opening the
read-only modal. Missing/denied/error/empty results give useful terminal states,
not an endless loader. Repeated reads are deduplicated; replaced sessions, weeks,
permissions and late responses cannot reopen old content. A separate reviewed
backend migration is required before this dedicated endpoint is available. No
view grant is added by frontend code.

Closed mobile navigation is inert/hidden from assistive technology. Opening
focuses the first available destination; Escape restores Menu focus. Navigation
preserves destination focus; desktop navigation becomes available after resize.

Production and Inventory provide visible Refresh controls. Employee inventory
copy explicitly describes Refresh rather than promising realtime updates.
Confirmed count writes retain the existing post-save refresh. The backend pilot
candidate removes raw employee realtime access; no polling or raw-table fallback
is introduced here. Field Work and approved schedules retain their own Refresh.

Service-free coverage:

```sh
node --test scripts/test-*.mjs
```

The actual-helper tests cover module-only tabs, manager preservation, restricted
Overview/Search, refresh deduplication and write-busy guards, approved packet
projection, malformed/inactive/changed data, repeated taps, session changes and
fresh read-on-open. The audit-render fixture freezes its synthetic date so the
real Friday-5PM cutoff cannot invalidate an unrelated escaping test. The offline
mobile harness adds matching rendered flows at 360/390/430 portrait, 844 landscape
and 1440 desktop, including restricted stock-count forms and approved-pack reader.

Local verification: 461 service-free tests and all 14 non-browser validators pass.
Local Chromium launch was blocked at its process socket; the approved escalation
failed before execution due executor infrastructure. No local browser pass is
claimed. Fresh exact-head CI and screenshot review remain required before
release; actual-device validation and restricted backend authorization remain
separate gates.

Employee device checklist, after separate release/access approval: open Today;
verify only granted modules; visit all four Production tabs and permitted Field
or Inventory tabs; refresh and check errors/empty states; cancel a physical-count
form without changing data; open only a permitted approved pack; verify no draft,
approval or purchasing controls; rotate/keyboard-navigate; sign out. Use only
synthetic or explicitly designated records for deliberate write/failure tests.
