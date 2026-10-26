# Managed employee usernames: database boundary

**Local candidate, not deployed.** This migration creates an empty private credential-routing layer. It does not create an Auth user, link a person, grant a screen, confirm an email, set a password, send an invitation, or revoke business access. All those production changes require their own reviewed authorization.

## Identity and ownership

- `employee_login.aliases` has one normalized, unique ASCII username per existing Auth UID. The UID and backing Auth identifier stay unchanged. Aliases have no business-role fields.
- New rows are disabled and require setup by default. No real or synthetic identity is seeded by the migration.
- `employee_login.owners` is an empty, explicit UID allowlist. An operator must both be enabled there **and** retain the existing management `can_write` role. A manager not in this table is not a credential operator.
- Reset targets must be nonanonymous Auth users with enabled `app_employee_access`, no `app_user_roles` row, and no owner membership. Credential operators must also be nonanonymous. This endpoint cannot reset a management or owner account.
- First-phase linking is a separately approved maintenance operation, not a self-service endpoint. Resolve and independently verify the exact existing UID; never match a roster display name automatically. Future employees still require an approved internal email/phone identifier and provisioning policy because Supabase password authentication is not username-native.

The private schema must **never** be added to Supabase's exposed API schemas. RLS is enabled without client policies. All API roles, including direct service-role table access, lose schema/table/function privileges. Narrow public SECURITY DEFINER wrappers have fixed search paths, explicit service-only EXECUTE, and an actual SQL-role guard. The sole authenticated wrapper is caller-bound `get_employee_login_access()`; it never accepts a target UID or returns a backing identifier.

Eligibility is not a certification of a person's final business scope. Independent supervisory/legacy grants remain additive and are deliberately not rewritten. Before approving any alias mapping, inspect all effective grant paths and confirm the exact allowed screens and actions. An employee label or username is never proof of least privilege.

## RPC contract

| RPC | Result / rule |
| --- | --- |
| `employee_login_check_owner(p_actor uuid)` | Boolean; actor must be validated by native Auth before Edge submits it. |
| `employee_login_list(p_actor uuid)` | Owner-only array of username, user_id, enabled and status. No email, code or hash. |
| `employee_login_resolve(p_username text)` | `{user_id,username}` only for an enabled, active, eligible alias; otherwise null. Used both before and after native password sign-in. |
| `employee_login_throttle(p_keys text[],p_limit int,p_window_seconds int)` | Durable atomic boolean. One to four distinct HMAC-hex64 keys; limit 1–1000, window 60–3600 seconds. Denials still increment all buckets. |
| `employee_login_issue(p_actor,p_username,p_code_hash,p_code_id,p_confirm_email)` | Owner-only ten-minute code issuance. Hash only; replaces any earlier unclaimed code. Optional single-user confirmation must be a deliberate owner setup decision. |
| `employee_login_claim(p_username,p_code_hash,p_claim_id)` | Atomically consumes a matching unexpired code and returns `{user_id,confirm_email}`. Exactly one claimant can start an external password update. |
| `employee_login_finish(p_uid,p_claim_id,p_success)` | Only matching processing operation can complete. Success requires still-enabled eligible identity. Failure/uncertainty stays blocked. |
| `employee_login_password_rejected(p_uid,p_claim_id)` | Narrow definitive native Auth `weak_password` rejection recovery only. Consumed code never returns; owner must issue a fresh code. Do not call after timeouts, unknown errors, or a successful Auth update. |
| `employee_login_disable(p_actor,p_username)` | Disables alias and outstanding code only. Rejects processing operations. Preserves failed reconciliation blocks. **Not offboarding.** |
| `employee_login_audit(p_event,p_outcome,p_actor,p_target)` | Service-only sign-in audit with fixed enums. Other events are recorded transactionally by their lifecycle RPC. |
| `get_employee_login_access()` | Authenticated caller's `{managed,enabled,status,username}`. This is an identity gate, not permission. |

Username grammar is `[a-z][a-z0-9._-]{2,31}` after trimming/lowercasing. `admin`, `administrator`, `owner`, `root`, `system` and `support` are reserved. The server supplies HMAC-SHA256 code and throttle hashes; DB never sees plaintext codes, passwords, tokens, raw IPs or backing emails in these tables. Fixed audit fields are event, outcome, timestamp, actor/target UIDs and a boolean recording an owner's individual-confirmation intent. That boolean is not an email address and survives removal of the transient setup flag.

## Reset state and interrupted requests

`setup_required/active/pending → pending → processing → active`

- Issuance blocks alias sign-in until successful reset. A replacement code invalidates the old one.
- Claim locks the alias row and removes the code hash **before** calling external Auth. Processing blocks reissue and alias disable; no worker lease automatically expires into another password update.
- A received native `weak_password` validation rejection can move the matching operation to `setup_required`; the employee needs a new owner-issued code.
- Transport failure, timeout, any unknown Auth outcome, failed refresh-session revocation, or lost completion acknowledgement must remain `processing`/`failed`. No automatic retry of the password write and no automatic reissue.
- To reconcile a stuck operation, first verify the old worker cannot still change Auth, inspect the provider-side outcome through approved tooling, and obtain a narrowly reviewed recovery action. Never merely clear the state/claim or toggle enabled. Disabling a failed alias preserves its failed state even if an operator later reenables it.

This cross-service workflow is intentionally not described as a distributed transaction. The DB enforces single-use admission; native Supabase Auth remains the sole password authority.

## Rate-limit maintenance

Edge consumes a shared global bucket first, then independently keyed IP and username/owner buckets. Missing/untrusted gateway IP, DB error or unavailable throttle storage must fail closed. A process-local counter is insufficient.

Throttle cleanup removes at most 100 records older than a day per request using row locks with `SKIP LOCKED` and an outer expiry recheck; a concurrently refreshed bucket cannot be deleted. Audit retention should follow an approved operational policy rather than exposing a free-form delete endpoint. Do not disable throttling to diagnose a sign-in problem.

## Permissions, old JWTs and offboarding

Changing an alias or password does not change the employee's Auth UID, existing RLS, projections or business grants. The Walls production screens, inventory-count permission and approved crew-pack projection continue to be decided by existing backend APIs, not username or navigation visibility. Administration, purchasing, approvals and other divisions remain outside the pilot's existing grants.

Native global sign-out revokes refresh sessions; existing access JWTs can remain usable until expiry. Alias disable also does **not** prevent direct native email/password authentication. Do not promise that either is full or immediate offboarding.

An explicitly authorized offboarding operation must inspect and revoke **every** effective grant path (employee access, application roles, production/install/planner scopes and legacy email-keyed inventory grants), address Auth account access/session revocation using supported Admin APIs, and account for unexpired JWTs. This feature performs none of that implicitly. Grant removal is server-enforced and is the appropriate immediate business-data boundary; an alias checkbox alone is not.

## Evidence and rollout gates

Run after the full repository schema in a fresh loopback-only `superior_workflow_test` PostgreSQL database:

```sh
node scripts/validate-employee-login-database.mjs
node tests/integration/employee-login.mjs
```

For a completely fresh local embedded PostgreSQL instance with schema + all three business-scope regression probes, run `node tests/integration/run-employee-login-disposable.mjs`. It binds loopback only on a free ephemeral port, creates temporary data, writes synthetic evidence under `artifacts/employee-login/database`, then stops and deletes its temporary cluster. Dependencies are pinned in the root lockfile.

The SQL suite executes real function ACLs, RLS, locks, replay/expiry/replacement, concurrent claims and throttles, owner/target checks, unknown-outcome blocks, definitive weak-password recovery, grant preservation and old-JWT caveats. Existing `walls-workflow-cases.sql`, `employee-data-scope.sql` and `employee-approved-crew-packs.sql` are also required unchanged. Synthetic identity rows are removed after this suite. Run only on a disposable database.

These tests do **not** verify hosted default privileges, native GoTrue password/JWT behavior, gateway IP header trust or live Edge deployment. Before any production activation: obtain approval for the exact migration, dedicated Edge secrets/configuration, endpoint deployment, frontend flag, explicit owner/alias mapping and any individual confirmation; verify hosted privilege drift and a nonproduction native-Auth lifecycle first. Keep the frontend feature disabled until all dependencies pass. Do not repurpose the operations-agent or inventory notifier for credential administration.
