# Inventory notification recovery

Prepared changes only: no provider messages, live database writes, or deployments are required to test this repair.

## Guarantees and limits

- Claims use PostgreSQL row locking / `SKIP LOCKED`, a five-minute lease, and compare-and-set writes fenced by the claim attempt and timestamp. A stale owner cannot overwrite a newer owner.
- Each alert receives one durable, globally unique provider key. The sender, recipient list and complete message are stored before the first send and reused unchanged across retries and deployments.
- Resend documents a **24-hour** idempotency retention window. Automatic sends stop after 23 hours (with a request-time margin), or six claims, whichever comes first. Unknown late outcomes are **not resent**: the row remains `failed`, `next_attempt_at = infinity`, with a manual-review error. This avoids duplicates; it cannot guarantee delivery through an outage longer than the provider's retention period.
- Network errors, timeouts (including stalled response bodies), 5xx, 408, 429 and in-progress idempotency conflicts retry using the same request/key. Nonretryable provider rejection is retained for review. Success requires a provider message ID and an acknowledged database update. A failed/zero-row status write is never reported as sent.
- Legacy previously attempted alerts had no idempotency key. The first relevant sweep quarantines those rows, preserves the old error, and does not resend them. New unattempted alerts continue normally. Only expired leases can be reclaimed; ordered materials are suppressed before another delivery attempt.
- The migration only adds nullable state columns/indexes and replaces the existing service-role-only claim function. It does **not** rewrite existing alerts on apply, change recipients/credentials, or add permissions.

## Coordinated deployment prerequisites (not performed here)

1. Pause existing invocation sources and allow the old worker to finish. Do not overlap the old non-idempotent worker with the new claim function. Record any already-running unknown outcomes for reconciliation.
2. Apply the prepared migration, then deploy both `index.ts` and `worker.mjs`, preserving the existing secrets and recipient configuration. The new worker fails closed if claimed rows do not have a durable key.
3. Verify the existing authenticated retry sweep. The repository does not define one: there must be a recurring POST to this function with `{}` and the existing webhook secret (for example once per minute). Do not embed that secret in SQL, a public workflow, logs, or documentation. An insert-only webhook is insufficient for retries and stale lease recovery. Creating or changing the live sweep is separate deployment work.
4. Resume invocation only after migration and worker are in place. Monitor HTTP 503 results, stale `sending` rows older than five minutes, and `failed` rows with `next_attempt_at = infinity`.
5. Reconcile manual-review rows against existing provider logs/message IDs. Never clear a durable key, request or first-attempt timestamp just to force a resend. Any resend outside the safe window is an explicit operational decision after confirming the original outcome.

## Local checks

`node --test scripts/test-inventory-alert-recovery.mjs` uses fake provider/database/clock dependencies and sends no email. The PostgreSQL regression runner is `node tests/integration/inventory-alert-recovery.mjs` (requires pinned `pg@8.16.3`); run only against a fresh local `superior_workflow_test` database. It applies the complete repository migration chain and holds a real row lock while a second connection claims work. The dedicated workflow runs both checks with synthetic data.

Provider contract: https://resend.com/docs/dashboard/emails/idempotency-keys
