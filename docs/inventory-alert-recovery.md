# Inventory notification recovery

Prepared changes only: no provider messages, live database writes, or deployments are required to test this repair.

## Provider compatibility and safety boundary

The hosted worker uses the existing **Gmail Apps Script gateway**, not the Resend transport previously checked into this repository. This repair keeps `GMAIL_APPS_SCRIPT_URL`, `GMAIL_APPS_SCRIPT_SECRET`, `INVENTORY_ALERT_RECIPIENTS`, and `INVENTORY_WEBHOOK_SECRET` unchanged. It preserves the gateway's `alert_id`, `to`, `subject`, `text`, `html`, `secret` request fields; its `ok`, optional `id`, and `duplicate` success fields; the existing `gmail-alert-<id>` message-ID fallback; and controlled-test content. No new credentials, recipients, sender settings, provider, or authorization mode are introduced.

The gateway implementation is unavailable for review. Its duplicate marker and retryable hint **do not establish atomic deduplication or a retention period**. Accordingly, after recording dispatch intent this worker makes **one** gateway call and never automatically replays a negative, timeout, network, malformed, or unacknowledged outcome. Even `{ok:false,retryable:true}` is retained for manual review, not treated as proof that no email was sent. There are no assumed 24-hour/Resend semantics.

## Guarantees and limits

- Claims use PostgreSQL row locking / `SKIP LOCKED`, a five-minute lease, and compare-and-set writes fenced by claim attempt and timestamp. An additional null-dispatch-intent fence allows only one caller to begin delivery for a claim.
- The recipient list and full message are stored before dispatch. The gateway secret and URL are **never stored in the outbox**; the existing secret is attached only to the outgoing request. The same stable alert ID continues to reach the gateway.
- A stale claim that has **not** recorded dispatch intent can safely recover. A stale started dispatch, legacy previously attempted alert, or exhausted six-claim limit becomes `failed` with `next_attempt_at = infinity` and a manual-review error, preserving earlier history. This prevents blind duplicate sends but cannot guarantee eventual automatic delivery when a provider outcome is unknown.
- Headers and response-body waits have a bounded timeout. Each alert is isolated so one failure does not abandon the batch. Success requires the existing gateway success response and an acknowledged status write. Failed or zero-row writes never report sent.
- Marking material ordered suppresses ordinary unsent work but preserves terminal manual-review rows and prior error history.
- The migration adds three nullable state columns and two indexes. It replaces only the existing claim and mark-ordered functions while preserving their access gates, ACLs, SECURITY DEFINER settings, search paths and RLS. Applying it does **not** rewrite existing alerts.

## Coordinated deployment prerequisites (not performed here)

1. Capture existing invocation settings and exact hosted worker/database-function backups privately. Pause only the existing notification invocation sources; allow queued/in-flight old work to drain. Do not overlap the old worker with the new claim function.
2. Apply the reviewed migration, then deploy both `index.ts` and `worker.mjs`, retaining all existing secrets, recipients and `verify_jwt` mode. The new worker fails closed without the recovery protocol marker.
3. Restore the exact existing trigger and recurring sweep configuration, including on failure. Do not create new scheduler jobs, embed secrets in SQL/public artifacts, or erase outbox records. An existing authenticated sweep remains necessary for safe unstarted-lease recovery and terminal-state cleanup.
4. Monitor HTTP 503 results, stale `sending` rows older than five minutes, and `failed` rows with `next_attempt_at = infinity`.
5. Reconcile manual-review rows against existing Gmail/gateway records. Never clear dispatch intent or reset attempts merely to force another email. Any resend requires a deliberate decision after confirming the original outcome; a retryable hint is insufficient.

## Local checks

`node --test scripts/test-inventory-alert-recovery.mjs` uses fake provider/database/clock dependencies and sends no email. Its provider deliberately has **no** deduplication so accidental replays would be counted as duplicate sends.

The PostgreSQL runner is `node tests/integration/inventory-alert-recovery.mjs` (requires pinned `pg@8.16.3`); run only against a fresh local `superior_workflow_test` database. It applies the complete repository migration chain, holds a real row lock while a second connection claims work, verifies dispatch quarantine, and exercises the real authenticated mark-ordered RPC. The dedicated workflow runs both suites with synthetic data and statically checks the Edge Function without invoking it.
