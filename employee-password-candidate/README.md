# Owner password setup/reset — approved gated rollout

This implementation provides a no-email owner workflow for **already approved existing
restricted Auth identities**. Source publication and the bounded hosted rollout were
explicitly approved. Native username login and existing account/business access remain
unchanged. Deployment installs a dedicated endpoint, private authorization records and
an expiring encryption key; it does **not** set/reset a password, confirm an account,
create a new employee or grant new business permissions.

Deployment state is verified separately through exact-head CI, hosted probes and the
private rollout receipt; source configuration alone is not proof of activation. No
real account identifiers, passwords, private keys or service credentials belong here.

## Owner experience

1. Open Employees and select a preapproved existing account.
2. Review its assigned username and fixed limited access.
3. Enter and confirm a new password. For first setup, explicitly approve confirming
   this one existing internal Auth identifier without an email challenge.
4. Confirm Set initial password or Reset password. A successful result records the
   operation; it does not sign in as the employee or prove their physical phone test.

The employee signs in through the existing direct native Auth username form.
Forgotten passwords are replaced, never retrieved. This is **not** a password list,
vault, second authentication system, public registration or new-account provisioner.
This first UI displays fixed approved access; it does not edit permissions or create
the later employee roster. No caller-supplied email/username/grants enter the command.

## Credential boundary

- `jose` **6.2.13**, RSA-OAEP-256 + A256GCM, supplies standard JWE encryption. Its
  exact npm webapi files and MIT license are vendored unchanged; package integrity
  is locked and the local validator checks every byte. This is not a claim of an
  independent cryptographic audit.
- The browser encrypts both the owner's captured native access token and the new
  password. The custom endpoint receives a bounded compact JWE with only public
  `apikey` and content-type headers, never the owner's plaintext bearer header.
- A deployment-pinned public key is the only browser key. The private key and native
  service API key remain server-only. Strict algorithm/header/kid allowlists reject
  compression, remote-key lookup and fallback. Library randomness is not overridden.
- Server verifies the decrypted owner token using native `getUser`, then checks an
  explicit current provisioning-owner allowlist. General app writers and user-editable
  metadata confer no authority. Native sign-in and business RLS remain authoritative.
- The endpoint deliberately has its own `verify_jwt=false` gateway configuration,
  because the actual owner JWT is encrypted. This is NOT an anonymous admin action:
  native verification and owner authorization inside the handler are mandatory.
  No other function or global Auth setting is changed.
- A first encrypted prepare request obtains a server-generated challenge bound to
  owner, existing UID, action, reviewed record/version, audience and current key.
  The second encrypted apply request consumes it atomically before one exact-UID
  native Admin update. Setup includes individual `email_confirm:true`; reset sends
  only the new password. Neither changes email, username, role or business grants.
- JWE commands expire within 60 seconds; challenges within 120 seconds. Lifetime is
  rechecked after awaited work. Shared pre-decrypt 120/300-second and durable
  owner/target budgets apply without trusting caller IP headers.
- Native uncertainty or interrupted finalization retains a durable target lock.
  No retry/new UUID/lease silently repeats a password write. Only exact native
  HTTP 422 `code=weak_password` is a defined non-mutating rejection that permits a
  fresh owner-reviewed attempt. Other failures remain blocked for inspection.
- Definitive exact-target success is finalized with a new record version before
  releasing the lock. Later resets require a fresh challenge and confirmation;
  old-version concurrent requests cannot overwrite it.
- Our database and audits store no password, password hash, owner token, encrypted
  envelope or recoverable secret. API responses contain only allowlisted status,
  nonsecret challenge/operation IDs and expiry. No raw upstream errors or user dumps.

### Important residual risks—not zero retention

JWE prevents **plaintext in the custom endpoint's ingress bodies**, not all possible
credential retention. The provider may retain encrypted invocation bodies. Anyone
who later obtains the corresponding private key can decrypt those retained bodies,
even after the command expires; expiry prevents replay, not decryption. Browser XSS,
compromised devices, provider runtime administrators or tracing of decrypted/outgoing
native requests are not solved by JWE. Plaintext necessarily exists transiently in
browser/server memory and in the native Auth request. Clearing JS references/byte
arrays is best effort, not guaranteed memory erasure.

Before live use, explicitly approve this trust/retention tradeoff, verify no custom
body/error/session tracing, restrict key/log access, and approve the rotation and
retention procedure. Public/server key configuration has a finite not-after time
within 31 days. Rotation must disable new commands, change server/private and pinned
public configuration, invalidate old-key challenges, verify the boundary, and then
re-enable. Retire old decryption keys under the approved secret-manager retention
policy; do not claim deletion also erases provider backups or retained ciphertext.

The shared pre-decrypt budget can temporarily deny all owner commands during abuse.
Auth/DB/external calls are not a single transaction. The exact UID prevents an email
lookup race from retargeting the write, but native identity reads are snapshots.
Owner/grant/config phase checks have the SQL transaction linearization point described
in `database/CONTRACT.md`, not instantaneous global revocation. Existing access JWTs
can outlive a password change until native expiry/validation; offboarding also needs
explicit business-grant/Auth controls, not just a reset.

## Explicit gated configuration

Tracked `config.js` now carries the explicitly approved public-only rollout flag, exact endpoint and expiring public key. UI needs all of:
`employeePasswordAdminEnabled:true`, exact project function URL in
`employeePasswordEndpoint`, and public-only `employeePasswordKey:{kid,jwk,not_after}`.
The new migration seeds disabled settings and **no owners or employee records**.

Server needs explicit `EMPLOYEE_PASSWORD_ENABLED=true`, built-in `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` JSON dictionaries with valid named `default` keys, and separately approved
`EMPLOYEE_PASSWORD_INGRESS_API_KEY`, `EMPLOYEE_PASSWORD_HUB_ORIGIN`, `EMPLOYEE_PASSWORD_AUDIENCE`,
`EMPLOYEE_PASSWORD_IDENTIFIER_DOMAIN`, `EMPLOYEE_PASSWORD_KEY_ID`,
`EMPLOYEE_PASSWORD_KEY_NOT_AFTER`, `EMPLOYEE_PASSWORD_PRIVATE_KEY`.
Modern `sb_secret_` keys are server-only and use the `apikey` header, never a Bearer JWT. Do not expose any server-only value in browser configuration or this repo.

`EMPLOYEE_PASSWORD_INGRESS_API_KEY` must exactly equal the **existing publishable**
`sb_publishable_...` key in this Hub's `config.js` `supabaseAnonKey` field. It is an
explicit public routing/configuration pin, not owner authorization. Missing or
non-publishable values disable the handler; there is no automatic legacy/secret-key
fallback. This routing pin does not create a new API key. The named default publishable key is used separately for native owner-token verification; the named default secret key is used only for internal service calls. Both travel in `apikey` only. Only the decrypted owner JWT travels in native `Authorization`; a secret API key is never treated as a Bearer JWT. Missing/malformed/wrong-role dictionaries fail disabled, with no fallback to deprecated aliases or a different named key. No existing project key or legacy-key enablement is changed. Native Auth
requests pin `X-Supabase-Api-Version: 2024-01-01`; unknown/legacy rejection shapes
still retain the uncertainty lock. Verify hosted gateway/header parity before
activation; the isolated native harness is not evidence of that hosted behavior.

Private DB readiness must independently match enabled/current key/audience/domain.
Neither a browser flag nor environment flag alone authorizes an account operation.

## Validation and remaining gates

```sh
node --test scripts/test-*.mjs employee-password-candidate/test-*.mjs
node scripts/validate-employee-password-vendor.mjs
# Disposable PostgreSQL only, installed test dependency required:
node employee-password-candidate/database/run-local.mjs
```

Node tests use real JWE but synthetic native/HTTP adapters. Disposable PostgreSQL
tests exercise actual ACLs, transaction races, nonce expiry, versions, durable locks
and existing business-scope probes against a compatibility Auth schema—not GoTrue.
The offline `owner-preview.html` is explicitly simulated and has network blocked by
CSP; its actual action is permanently disabled. No production password should ever
be entered into a preview.

The exact-head native workflow exercises pinned native Auth, real PostgREST, JWE
and full-Hub phone/browser flows using disposable synthetic accounts. Those tests
are not a real employee login or hosted positive password-write acceptance. Hosted
negative probes use an invalid synthetic owner token and no password; they verify
runtime key/header compatibility, encryption and rejection without credential changes.

Release and credential-operation gates:
1. Publish only reviewed source/synthetic tests and pass exact-head native, database
   and browser CI. Never put live secrets or employee records in CI/artifacts.
2. Obtain explicit encrypted-log/private-key risk and bounded deployment approval.
   The current rollout has this approval; future key rotation is not automatic.
3. Deploy with the DB gate disabled, verify hosted ACL/runtime parity and exact
   existing UID/scope mappings, publish verified source/config, and only then enable.
   No password operation is implied by deployment or by enabling the capability.
4. The exact first setup/reset remains a separate owner action. Enter the password
   privately in the verified UI—not in chat—and confirm individual identifier
   activation for first setup. Then verify the employee's own phone sign-in and
   unchanged scope. The assistant must not impersonate the employee with a real password.

No Resend/SMTP/DNS setup, email delivery, Python helper, PR105 proxy, direct Auth SQL
write, global email-confirmation disable or duplicate existing employee is involved.

Primary references reviewed 26 October 2026:
- https://github.com/panva/jose/releases/tag/v6.2.13
- https://www.rfc-editor.org/rfc/rfc7516
- https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid
- https://raw.githubusercontent.com/supabase/auth/v2.197.0/internal/api/admin.go
- https://supabase.com/docs/guides/functions/logging
- https://supabase.com/docs/guides/auth/password-security

API-contract and ingress-key references rechecked 27 October 2026:
- https://github.com/supabase/auth/blob/v2.197.0/internal/api/apiversions.go
- https://github.com/supabase/auth/blob/v2.197.0/internal/api/errors.go
- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys

Hosted runtime key contract verified with noncredential booleans and [Supabase migration documentation](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys#step-4-update-edge-functions). Local native harness uses its explicit legacy-only synthetic adapter; production adapter header semantics have separate strict tests and hosted noncredential probes.
