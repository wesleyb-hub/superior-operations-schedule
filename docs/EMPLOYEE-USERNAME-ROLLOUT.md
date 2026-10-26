# Employee usernames and private password setup

**Local, disabled-by-default candidate. Not a live account rollout.**

## The employee experience

1. Open the Hub and choose **Employee username sign in**.
2. Enter a username such as `jade` and a password. No working mailbox is required for this sign-in route.
3. For first setup or a forgotten password, the owner verifies the employee and creates a ten-minute, one-use code in **Employee sign-in help** (`employee-access.html`).
4. The employee chooses **Use setup / reset code**, enters the code, and privately chooses a password on their own device. They then sign in normally.

The owner never asks for, retrieves, emails or keeps the employee's password. Only Supabase Auth stores the password verifier. The code is a temporary credential: hand it directly to the verified employee, do not put it in an operational chat, shared document, URL or password file. Hiding a displayed code does not revoke it.

This phase supports **existing employee Auth identities only**. It does not create users, assign roles, link names from a roster, change backing email addresses, or provision future accounts. An approved internal email/phone identifier is still required by Supabase. That identifier need not be a mailbox the employee uses, but its ownership and future provisioning policy need a separate decision. Existing administrator email sign-in and emailed recovery remain available and do not depend on the alias service.

## Scope stays where it belongs

Username lookup returns the existing Auth UID. All existing `get_app_access`, RLS, safe projections and capability checks remain in force. The candidate changes no production, inventory, installation, planner or approval grants.

For the current approved pilot, the intended scope stays Walls production Today, five-day/table board/weekly forecast, inventory counts only, and approved Walls crew packs. Username setup does not enable production mutations, purchasing, approvals, other divisions, financial information or administration. Before mapping any employee, recheck **all** independent grant paths; an employee profile alone cannot certify the effective union of permissions.

## What is implemented

- Private, normalized unique username → existing UID mapping. No public alias/email directory.
- Separate explicit owner allowlist, additionally requiring the owner's current management capability; ordinary writers are not credential operators.
- Dedicated `employee-access` Edge Function. It does not reuse the Operations Assistant or inventory email worker.
- Native Supabase password sign-in and native Admin password update, without account recreation, direct `auth.users` writes or global email-confirmation changes.
- Optional, explicit owner-approved **individual** identifier confirmation for first setup only. Existing confirmed accounts need no confirmation action.
- CSPRNG 80-bit codes, HMAC-SHA256 storage, ten-minute lifetime, row-lock one-use claim before any Auth write, matching-claim completion and secret-free lifecycle audit.
- Durable global/IP/username/owner rate limits with hashed bucket keys, generic errors, exact-origin CORS, bounded request size and no request/password/token logging.
- Double-check of the alias after native sign-in, fail-closed unknown password-update outcomes, no automatic credential-write retry.
- Private owner handoff screen and a network-disabled synthetic review demo. No real identifiers or credentials are embedded in the demo.

The Edge Function never returns the backing identifier before authentication. A native authenticated session/JWT still contains its normal Auth identity claims; this is not an attempt to remove those claims.

## Interruptions and recovery

The browser rejects stale responses and repeated clicks. Setup returns no session. Password/code fields are cleared on mode changes or leaving the page. A nonsecret pending-install marker fences native session installation across reload; no password, code or token is added to application storage by this feature. Existing Supabase session storage continues to behave as configured by the Hub.

Issuing a code temporarily pauses **username sign-in**. A definite native Auth 422 `weak_password` rejection consumes the code but permits an owner to issue a new one. For a timeout, unknown Auth response, or ambiguous completion, the identity stays blocked pending inspected reconciliation. Do not automatically reissue or merely toggle its enabled flag. See [database reconciliation and old-token limits](EMPLOYEE-USERNAME-DATABASE.md).

An expired or lost unused code can be replaced by the owner. A lost success response may mean the password was already changed: first try the newly chosen password; otherwise the owner checks the status rather than repeatedly changing it.

## Configuration — no values have been activated

| Location | Required setting |
| --- | --- |
| Browser `config.js` | `employeeUsernameLoginEnabled: true` only after all deployment checks. Absent means off; current file is unchanged. |
| Server | `EMPLOYEE_ACCESS_ENABLED=true` only after explicit approval. Absent means off. |
| Server | `EMPLOYEE_ACCESS_HMAC_SECRET`: independently generated high-entropy secret, at least 32 bytes; never browser-delivered. |
| Server | `EMPLOYEE_ACCESS_ALLOWED_ORIGINS`: exact HTTPS origin allowlist, comma-separated, no wildcard. |
| Server | `EMPLOYEE_ACCESS_TRUSTED_IP_HEADER` and `EMPLOYEE_ACCESS_IP_TRUST_VERIFIED=true` only after gateway overwrite/provenance is tested. The parser rejects forwarding lists and accepts a single canonical IP. |
| Server | Supabase URL and service-role secret from server-only environment; publishable key via `EMPLOYEE_ACCESS_PUBLISHABLE_KEY` or built-in anon key. |

The ingress header cannot be assumed trustworthy merely because it is named `x-forwarded-for` or `cf-connecting-ip`. Verify the actual hosted path strips/overwrites attacker-supplied values. If this cannot be proven, do not activate this endpoint: configure a trusted ingress boundary first. Global and alias limits are independent of IP limits, but are not a replacement for provenance verification.

The private `employee_login` schema must not be added to exposed Data API schemas. The public function wrappers have explicit ACLs; verify the hosted PostgREST role contract matches the synthetic tests. Function `verify_jwt=false` allows pre-login password/code requests; it **does not** make owner operations unauthenticated. Those verify the bearer with Auth and check the separate owner allowlist again in SQL.

Before activation, also verify gateway/function/provider logging does not capture request bodies or credentials. Multi-tab pending-install/logout/session-switch acceptance remains required: conservative cleanup may log out a newer session sharing SDK storage.

No CAPTCHA or MFA enrollment is added or disabled. Before rollout, verify compatibility with the project's current native Auth settings; if they require a challenge this first-phase UI does not implement, keep the feature off rather than weakening that policy.

## Exact approval/deployment boundaries

Source review and local testing authorize **none** of the following production actions. Each must be covered explicitly before it occurs:

1. Publish the exact reviewed source as a draft PR (if desired), require CI/browser tests and review the exact commit. No push/PR is included in this local task.
2. Validate native Auth lifecycle on a separately authorized nonproduction Supabase project: password rejected/changed, individual confirmation, old-password denial, refresh-session behavior, expiry, MFA/CAPTCHA settings and account-state coherence. Current unit tests use synthetic providers, not hosted GoTrue.
3. Recheck current production definitions/ACLs and apply only the exact reviewed schema migration. It seeds no identities or business grants.
4. Deploy only the dedicated Edge Function and approve its secrets/origin/IP provenance configuration. No existing notifier or assistant credentials are repurposed.
5. Separately verify and approve the exact owner UID and each username → existing employee UID mapping, including current additive permission scope. No live mapping SQL is supplied as an automatic script.
6. Deploy the reviewed frontend and enable its feature flag only after backend checks pass. Existing admin email login remains independent.
7. Explicitly authorize any first-setup individual confirmation and code issuance. The employee privately chooses the password. No credentials are collected in chat.

Stopping or rolling back the username feature does not revoke already issued native sessions or undo a password change. Turn the browser/server flags off if necessary, preserve the mapping/audit for diagnosis, and separately handle Auth/session/grant remediation under authorization. Do not delete identities or grant management access as a workaround.

## Offboarding and old tokens

**Disable username is not full offboarding.** It blocks this alias and outstanding codes, not direct native email/password sign-in or all existing access JWTs. A native password update is expected to terminate refresh sessions in the current Auth implementation; already-issued access JWTs can remain usable until expiry. This behavior must be verified on the intended Auth deployment before any promise about session termination.

Actual offboarding requires explicit revocation of every effective business grant and supported Auth account/session controls. The disposable database tests demonstrate that an alias-only disable leaves existing limited JWT business scope unchanged, while removing the fixture's real employee grant denies the protected backend APIs. No live offboarding is performed by this candidate.

## Reproduce tests locally

Node 22+, the pinned `package-lock.json` and a supported local machine are required:

```sh
npm ci
npm test
npm run check:employee-access
node scripts/validate-employee-login-database.mjs
npm run test:employee-access-db
npm run demo:employee-access
npx playwright install chromium
npm run test:employee-access-browser
```

The test runner uses disposable loopback PostgreSQL and synthetic accounts only. Browser acceptance uses a network-disabled adapter. A passing synthetic UI test does not prove native Auth, hosted privilege parity or live deployment. See the final verification report for checks that actually ran and any environment-blocked checks.

## Official references checked 26 October 2026

- [Supabase password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword): email/phone credentials, not native usernames.
- [Admin user update](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid): server-only existing-user updates and individual confirmation behavior.
- [Auth Admin implementation](https://github.com/supabase/auth/blob/master/internal/api/admin.go): password-strength validation occurs before the user-update transaction.
- [Auth password/session implementation](https://github.com/supabase/auth/blob/master/internal/models/user.go): current password-update refresh-session behavior; not a substitute for deployed-version testing.
- [Supabase sessions](https://supabase.com/docs/guides/auth/sessions): session and JWT lifetime considerations.
- [Supabase changelog](https://supabase.com/changelog): reviewed relevant Auth/Data API/runtime changes; no global configuration weakening is included.
