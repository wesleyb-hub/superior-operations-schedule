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
