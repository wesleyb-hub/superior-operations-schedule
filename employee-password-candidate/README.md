# Owner password setup/reset — private, disabled candidate

This branch implements a no-email owner workflow for **already approved existing
restricted Auth identities**. It is not deployed or enabled. The released Hub's
native username login is unchanged. No real employee, password, key, owner grant,
domain, sender or live account has been added or changed by this candidate.

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
  service-role key remain server-only. Strict algorithm/header/kid allowlists reject
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
- JWE commands expire within60 seconds; challenges within120 seconds. Lifetime is
  rechecked after awaited work. Shared pre-decrypt120/300-second and durable
  owner/target budgets apply without trusting caller IP headers.
- Native uncertainty or interrupted finalization retains a durable target lock.
  No retry/new UUID/lease silently repeats a password write. Only exact native
  HTTP422 `code=weak_password` is a defined non-mutating rejection that permits a
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
within31 days. Rotation must disable new commands, change server/private and pinned
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

## Default-off configuration

Tracked `config.js` is unchanged. UI needs all of:
`employeePasswordAdminEnabled:true`, exact project function URL in
`employeePasswordEndpoint`, and public-only `employeePasswordKey:{kid,jwk,not_after}`.
The new migration seeds disabled settings and **no owners or employee records**.

Server needs explicit `EMPLOYEE_PASSWORD_ENABLED=true`, built-in `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, legacy-JWT `SUPABASE_SERVICE_ROLE_KEY`, and separately approved
`EMPLOYEE_PASSWORD_HUB_ORIGIN`, `EMPLOYEE_PASSWORD_AUDIENCE`,
`EMPLOYEE_PASSWORD_IDENTIFIER_DOMAIN`, `EMPLOYEE_PASSWORD_KEY_ID`,
`EMPLOYEE_PASSWORD_KEY_NOT_AFTER`, `EMPLOYEE_PASSWORD_PRIVATE_KEY`.
Opaque `sb_secret_` keys are deliberately not supported by this adapter's header
contract. Do not expose any server-only value in browser configuration or this repo.

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

New native Auth + full-Hub/browser integration remains an exact-candidate runtime
gate. Earlier released native-login CI is historical evidence, not a new result for
this owner flow. Local native/browser launcher restrictions were respected.

Required next approvals, in order:
1. Publish only reviewed source/synthetic tests to a new draft PR and run exact-head
   native/database/browser CI. No live secrets or employee records in CI/artifacts.
2. Approve encrypted-log/private-key risk, secure key generation/storage/rotation,
   exact migration/function/config deployment and explicit owner/target record setup.
3. Deploy disabled, verify hosted ACL/native role parity, configure the existing UID
   and unchanged limited grants, review approved scope/identity at action time, then
   enable only after verification. No credential operation is implied by deployment.
4. Separately authorize the exact first setup/reset. The owner enters the password
   privately in the verified UI—not in chat—and confirms individual activation.
   Verify same UID/scopes and the employee's phone sign-in. No impersonation test by
   the assistant using a real employee password.

No Resend/SMTP/DNS setup, email delivery, Python helper, PR105 proxy, direct Auth SQL
write, global email-confirmation disable or duplicate existing employee is involved.

Primary references reviewed26 October2026:
- https://github.com/panva/jose/releases/tag/v6.2.13
- https://www.rfc-editor.org/rfc/rfc7516
- https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid
- https://raw.githubusercontent.com/supabase/auth/v2.197.0/internal/api/admin.go
- https://supabase.com/docs/guides/functions/logging
- https://supabase.com/docs/guides/auth/password-security
