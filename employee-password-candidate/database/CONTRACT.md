# Owner-set native password admission: local database candidate

**Disabled, synthetic-test-only candidate.** No hosted migration, account, password, confirmation, permission, or credential change has been performed. The paused email-delivery candidate is not included here.

## Scope and authority

This schema admits explicit owner operations on a separately approved **existing Auth UID**. It does not create accounts, rename identities, send mail, store passwords, or change business grants. `username` is a fixed plant-friendly label whose unchanged backing Auth email is `username@identifier_domain`; no working mailbox is required by this feature.

`employee_password.owners` is an empty, server-controlled exact UID allowlist. `can_write`, email domain, browser navigation and submitted actor IDs confer no ownership. Two owner-read RPCs derive the caller from `auth.uid()`; every mutation/service read has an explicit service-role ACL and checks the actual SQL role. Private tables, sequences and helper functions have no browser or service direct access; every private table has RLS enabled.

The only seeded row is settings with `enabled=false` and NULL `current_key_id`, `audience`, `identifier_domain`. Enabling requires all three nonempty configured values; the server must independently require exact equality with its pinned public-key ID/audience/domain. A settings update must increment its version. The database stores neither private/public cryptographic key material nor the encrypted request.

## Public RPC contract

Service-only functions:

| Function | Parameters | Result |
|---|---|---|
| `employee_password_is_owner` | `p_owner_id uuid` | boolean |
| `employee_password_readiness` | none | `{enabled,current_key_id,audience,identifier_domain}` |
| `employee_password_preflight` | none | boolean; atomically charges global pre-decrypt budget |
| `employee_password_prepare` | `p_owner_id uuid,p_record_id text,p_expected_version bigint,p_request_id uuid,p_action text` | prepared/replay/blocked object below |
| `employee_password_consume` | `p_owner_id uuid,p_challenge_id uuid,p_record_id text,p_expected_version bigint,p_action text,p_audience text,p_key_id text` | `{kind:'applying',operation_id,record}` or `{kind:'blocked'}` |
| `employee_password_finish` | `p_owner_id uuid,p_operation_id uuid,p_phase text` | boolean CAS outcome |

`p_action` is `initialize` or `reset`. `prepare` returns:

```text
{kind:'prepared',challenge_id,phase:'prepared',expires_at,audience,key_id,record}
{kind:'replay',challenge_id,phase,expires_at,audience,key_id[,record]}
{kind:'blocked'}
```

A replay uses the original owner/request ID, binding, nonce and expiry. A canonical record is returned only while still prepared/unexpired and after current owner/settings/target/version/identity/full-grant validation. Otherwise replay exposes only nonsecret phase information. Replaying never extends validity or grants permission for another Auth call.

Service canonical record is `{record_id,version,auth_uid,auth_email,username,setup_completed,effective_scope}`. Its backing email is private and is not returned by owner list. `operation_id` equals the server-generated challenge UUID; UUIDs use PostgreSQL `gen_random_uuid()`, never a caller-selected nonce.

Authenticated owner-read functions:

- `employee_password_owner_status()` → `{is_owner,available}`. Nonowners get both false.
- `employee_password_owner_targets()` → at most 20 rows with exactly `{record_id,version,auth_uid,display_name,username,scope_label,setup_completed,status}`. Nonowners are denied. Status is **ready / applying / needs_review / unavailable**. Status is advisory; it is never authority to mutate. Successful apply returns the target to ready at an advanced version. Weak-password rejection may return ready at the same version; the previous challenge is still consumed.

## State machine and concurrency

1. `prepare` validates current owner, enabled configuration, reviewed target, action/version, strict native identity state and the complete actual grant snapshot. It creates a 120-second server-generated challenge bound to owner, request, target UID, record ID/version/fingerprint, action, audience and key ID.
2. Prepared challenges do not lock the target. Multiple deliberate requests can prepare, but only one may consume. Expired unused challenges remain historical rows and cannot consume.
3. `consume` repeats the complete current fence in one transaction, locks the record and challenge, acquires a unique per-UID target lock, and commits `applying` plus `consumed_at` **before** the external native Auth update. A replay or competing challenge cannot win a second time.
4. The server performs exactly one native Auth `updateUserById` operation. SQL never writes `auth.users`, and the database never receives password/JWE/token content.
5. `finish('applied')` is an exact actor/operation/phase CAS recording server-observed success. It monotonically sets `setup_completed`, advances approved-record version by one and releases only that target lock. It records truth even if the owner was revoked after consume; it does not authorize a new effect. Previously prepared versions can no longer consume.
6. `finish('rejected')` is allowed **only** when the trusted server has received the allowlisted, explicit pre-effect native `weak_password` validation rejection. It consumes the nonce permanently, leaves identity/completion/version unchanged, and releases that lock so a stronger password can be deliberately entered with a new request/challenge. The database cannot independently prove an external HTTP outcome; this invariant is enforced by the trusted adapter, not a browser claim.
7. All other failures, timeouts, unexpected responses and uncertain completion become `needs_review` or remain `applying`. The target lock never expires and cannot be bypassed by a new owner/request/nonce. There is no lease or unlock/reconciliation API. Reviewed operator reconciliation requires separate authorization and evidence; blindly retrying could overwrite a password that already changed.

Write transactions serialize on settings, then owner/record/challenge in a fixed order. Short SHARE locks on the six business grant tables cover additive insert phantoms, including legacy-email grants. Two-second lock timeouts bound contention; no external work occurs while a database transaction is open. A timeout rolls back nonce consumption and target-lock creation. Owner/config/record/grant modifications committed before the fenced checks are observed.

**Auth state is a read snapshot, not a lock across native Auth transactions.** A concurrent ban/email/factor/recovery change can occur after the database checks, even before its commit. No SQL transaction is atomic with the later external Auth call. The adapter rechecks native state and responses, but this is not a guarantee against independent simultaneous administrator/password-reset actions. No credential or token columns are selected to establish these guards.

## Restricted Walls target eligibility

The current actual grant union includes full rows from:

- `app_employee_access` (UID),
- `app_user_roles` (UID),
- `inventory_user_access` (legacy backing email),
- `walls_production_access`, `walls_installation_access`, `weekly_planner_access` (UID).

The approved pilot requires exactly one enabled Walls production `walls_inventory_counter` profile, production-only wall subviews, the established overview/Walls/inventory/weekly-planner views, inventory view/count adjustment true, management false, and **no independent grant rows, even disabled ones**. Rejecting a disabled extra row is conservative eligibility, not revocation of any right. Existing projections/RLS continue to enforce Today/5-day/Table Board/Weekly Forecast, inventory counts and approved Walls crew packs; no business function or policy is replaced.

Actual rows must exactly match the reviewed snapshot. Unknown employee columns, additional divisions/areas, legacy-email grants, or authority drift fail closed. The authority fingerprint deliberately includes broad public/private application function definitions/owners/ACLs/search paths, public policies, relation ACL/RLS state, and known grant-table shapes. Consequently, unrelated public DDL or benign grant metadata changes may make approved records unavailable until explicitly re-reviewed. This availability/reapproval tradeoff is intentional, not a claim that all schema changes break the database.

The native initial guard requires existing email-only, single-identity, nonanonymous, non-SSO, unconfirmed, never-signed-in identity, no prior recovery, no pending email change, no deletion/ban and no MFA factors. Reset requires this feature's prior setup completion and a confirmed same identity; historical sign-ins/recovery timestamps may exist. Historical recovery timestamps do **not** prove current token validity or revocation.

Approved identity fields are immutable; reviewed revisions increment the record version. Completion cannot revert. Applying/uncertain target locks prevent normal record revisions. Historical challenges and the existing Auth-UID foreign key intentionally require inspected cleanup instead of automatic identity deletion/cascade.

## Budgets and audit

- Pre-decrypt global: 120 attempts per 300 seconds, shared across instances.
- Authenticated owner prepare: 10 per 600 seconds.
- Known target prepare: 5 per 600 seconds.
- Fixed buckets/capped counters are durable and atomic. The trusted server calls preflight before decryption; private counters cannot be reset by a client. The global limiter is shared rather than IP-based and intentionally may sacrifice availability during abuse.

Audit contains only actor UUID, record ID, operation UUID, reviewed version, fixed event and timestamp. No arbitrary message, email, password, password hash, JWE, ciphertext, token, IP, or provider response is stored. `initialize`/`reset` intent remains in the challenge's fixed action field. Only the trusted server's native Auth API receives the chosen password, transiently.

## Limits and deployment boundary

- Password change/alias-disable is **not full offboarding**. Existing access JWTs may remain valid until expiry; do not promise immediate revocation. Business grants/RLS must be reviewed independently for actual offboarding.
- Owner knowledge of a chosen password is inherent in the approved owner-set/reset UX; there is no password file or recoverable storage here.
- No account provisioning, owner grants, target approval, key generation/rotation, hosted SQL, deploy or native identity mutation is authorized by this local candidate.
- Deployment would require separate source/security approval, verified native Auth lifecycle tests, specific existing owner/target/scope approval, secure server-key/logging configuration, pinned audience/domain/key approval and explicit migration/enable authorization. All configuration remains disabled and empty in source.

## Local verification

```sh
NODE_PATH=/tmp/employee-login-tools/node_modules node employee-password-candidate/database/run-local.mjs
```

The runner uses already-installed pinned PostgreSQL 17.10/pg dependencies, creates a fresh ephemeral loopback cluster, applies baseline plus every migration, exercises actual SQL roles and concurrent connections, then runs the unchanged workflow and both employee-scope probes. It stops and removes the cluster. Minimal synthetic `auth.users`/identity/MFA fixture columns are **test compatibility scaffolding**, not real GoTrue. Evidence is written to `artifacts/employee-owner-password/database/{result.json,result.log}` and explicitly reports `nativeAuthVerified:false,hostedVerified:false`.

## Fixed mixed-profile extension (private rollout candidate)

`20261027112125_mixed_employee_password_scope.sql` adds a second fixed grant profile, `walls_production_inventory_qc_v1`, without enrolling any target or changing grants. The original pilot remains separately validated. A complete actual/reviewed grant union is still mandatory; no global role, legacy inventory or weekly planner row is accepted for the mixed profile. Three exact inventory scope rows plus production execution/plan controls and Walls installation view/QC are required. Other division screens remain read-only; the weekly schedule exposes approved Walls crew packs only, without a planner grant row. Field management and plan-review approval are excluded. `record_payload` returns the validated profile's distinct canonical effective scope. The runtime recognizes only these two exact scope objects.

See `docs/KYLER-PASSWORD-SCOPE-ROLLOUT.md` for the review/activation sequence, unchanged Jade re-review caused by authority fingerprint drift, and precise synthetic/native verification limits. Neither schema migration performs target enrollment, UID creation, owner changes or automatic reviewed-record refresh.
