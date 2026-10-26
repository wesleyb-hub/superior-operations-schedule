# Employee usernames and private password setup

**Draft, disabled-by-default candidate. Not a live account rollout.**

## The employee experience

1. Open the Hub and choose **Employee username sign in**.
2. Enter a username such as `jade` and a password. No working mailbox is required for this sign-in route.
3. For first setup or a forgotten password, the owner verifies the employee and creates a ten-minute, one-use code in **Employee sign-in help** (`employee-access.html`).
4. For first activation, the employee chooses **Use setup / reset code**, enters the code, and privately chooses **both their username and password** on their own device. They then use that username each time they sign in. For a forgotten password, they enter their established username and choose a new password; reset does not rename the account.

The owner approves the existing employee identity and access, not the employee's username or password. The activation code is already bound to that existing UID. There is no open registration or employee choice of identity, roles or permissions.

The owner never asks for, retrieves, emails or keeps the employee's password. Only Supabase Auth stores the password verifier. The code is a temporary credential: hand it directly to the verified employee, do not put it in an operational chat, shared document, URL or password file. Hiding a displayed code does not revoke it.

This phase supports **existing employee Auth identities only**. It does not create users, assign roles, link names from a roster, change backing email addresses, or provision future accounts. An approved internal email/phone identifier is still required by Supabase. That identifier need not be a mailbox the employee uses, but its ownership and future provisioning policy need a separate decision. Existing administrator email sign-in and emailed recovery remain available and do not depend on the alias service.

## Scope stays where it belongs

Username lookup returns the existing Auth UID. All existing `get_app_access`, RLS, safe projections and capability checks remain in force. The candidate changes no production, inventory, installation, planner or approval grants.

For the current approved pilot, the intended scope stays Walls production Today, five-day/table board/weekly forecast, inventory counts only, and approved Walls crew packs. Username setup does not enable production mutations, purchasing, approvals, other divisions, financial information or administration. Before mapping any employee, recheck **all** independent grant paths; an employee profile alone cannot certify the effective union of permissions.

## What is implemented

- Private existing UID activation records; usernames remain unassigned until employee activation. The chosen name is normalized and uniquely reserved under a row lock before native Auth changes. No public alias/email directory or availability endpoint. A private optional owner-provided display label is never an identity/permission key.
- Separate explicit owner allowlist, additionally requiring the owner's current management capability; ordinary writers are not credential operators.
- Dedicated `employee-access` Edge Function. It does not reuse the Operations Assistant or inventory email worker.
- Native Supabase password sign-in and native Admin password update, without account recreation, direct `auth.users` writes or global email-confirmation changes.
- Optional, explicit owner-approved **individual** identifier confirmation for first setup only. Existing confirmed accounts need no confirmation action.
- CSPRNG 80-bit codes, HMAC-SHA256 storage, ten-minute lifetime, row-lock one-use claim before any Auth write, matching-claim completion and secret-free lifecycle audit.
- Durable global, IP-or-shared-pilot, username, invitation-code and owner rate limits with hashed bucket keys, generic errors, exact-origin CORS, bounded request size and no application request/password/token logging. Hosted gateway logging is a separate activation gate.
- Double-check of the alias after native sign-in, fail-closed unknown password-update outcomes, no automatic credential-write retry.
- Private owner handoff screen and a network-disabled synthetic review demo. No real identifiers or credentials are embedded in the demo.

The Edge Function never returns the backing identifier before authentication. A native authenticated session/JWT still contains its normal Auth identity claims; this is not an attempt to remove those claims.

## Interruptions and recovery

The browser rejects stale responses and repeated clicks. Setup returns no session. Password/code fields are cleared on mode changes or leaving the page. A nonsecret pending-install marker fences native session installation across reload; no password, code or token is added to application storage by this feature. Existing Supabase session storage continues to behave as configured by the Hub.

A username collision does not consume a valid activation code or call Auth: the employee can try another name in the same setup form. Responses stay generic. A completed activation permanently distinguishes later resets from first setup, so reset or disable never reopens username choice.

Issuing a code temporarily pauses **username sign-in**. A definite native Auth 422 `weak_password` rejection consumes the code but permits an owner to issue a new one. An unfinished activation may choose a new available name with that new code; a previously activated account keeps its established username. For a timeout, unknown Auth response, or ambiguous completion, the identity and reserved username stay blocked pending inspected reconciliation. Do not automatically reissue or merely toggle its enabled flag. See [database reconciliation and old-token limits](EMPLOYEE-USERNAME-DATABASE.md).

An expired or lost unused code can be replaced by the owner. A lost success response may mean the password was already changed: first try the newly chosen password; otherwise the owner checks the status rather than repeatedly changing it.

## Configuration — no values have been activated

| Location | Required setting |
| --- | --- |
| Browser `config.js` | `employeeUsernameLoginEnabled: true` only after all deployment checks. Absent means off; current file is unchanged. |
| Server | `EMPLOYEE_ACCESS_ENABLED=true` only after explicit approval. Absent means off. |
| Server | `EMPLOYEE_ACCESS_HMAC_SECRET`: independently generated high-entropy secret, at least 32 bytes; never browser-delivered. |
| Server | `EMPLOYEE_ACCESS_ALLOWED_ORIGINS`: exact HTTPS origin allowlist, comma-separated, no wildcard. |
| Server | `EMPLOYEE_ACCESS_RATE_LIMIT_MODE`: absent means `trusted-ip`; explicitly use `shared-pilot` only for an approved small pilot. Unknown values fail closed. |
| Server | In `trusted-ip` mode only: `EMPLOYEE_ACCESS_TRUSTED_IP_HEADER` and `EMPLOYEE_ACCESS_IP_TRUST_VERIFIED=true` only after gateway overwrite/provenance is tested. The parser rejects forwarding lists and accepts a single canonical IP. In `shared-pilot` mode leave these unset/false; no caller IP header is read or trusted. |
| Server | Supabase URL and service-role secret from server-only environment; publishable key via `EMPLOYEE_ACCESS_PUBLISHABLE_KEY` or built-in anon key. |

The ingress header cannot be assumed trustworthy merely because it is named `x-forwarded-for` or `cf-connecting-ip`. For `trusted-ip` mode, verify the actual hosted path strips/overwrites attacker-supplied values; otherwise that mode must remain off. Do not set `EMPLOYEE_ACCESS_IP_TRUST_VERIFIED=true` to work around uncertainty.

The explicit **`shared-pilot`** alternative uses one constant durable HMAC-keyed bucket for the entire endpoint: **120 requests per 300 seconds**, with no caller IP dependency. Every request to the enabled, correctly configured endpoint counts before origin/method/body dispatch, including OPTIONS preflight, invalid requests, sign-in, activation/reset and owner assistance. It retains the independent global **1,000/300s**, normalized sign-in username **10/600s**, invitation code **5/600s**, verified owner **30/600s**, and owner issue/disable **10/600s** budgets. All limits use the existing atomic database RPC, not worker memory; storage errors fail closed.

**Availability tradeoff:** any caller can consume the shared pilot allowance and temporarily block all employee username and owner-help requests, not just their own. The window lasts five minutes from its first request; blocked attempts do not extend it. Preflight requests also consume allowance. An expired setup code may then need fresh owner issuance after the limit clears. Existing administrator email sign-in remains separate. Shared mode is a conservative small-pilot option, not a scalable anti-abuse guarantee, trusted-IP proof or a reason to disable limits. Switching modes/changing the server HMAC secret requires deliberate operational approval, not an automatic lockout workaround.

The private `employee_login` schema must not be added to exposed Data API schemas. The public function wrappers have explicit ACLs; verify the hosted PostgREST role contract matches the synthetic tests. Function `verify_jwt=false` allows pre-login password/code requests; it **does not** make owner operations unauthenticated. Those verify the bearer with Auth and check the separate owner allowlist again in SQL.

Before activation, also verify gateway/function/provider logging does not capture credential-bearing request/response bodies, authorization values, passwords, codes or session tokens. Current Supabase logging documentation describes invocation bodies; application no-console behavior or a clean limited sample is not sufficient assurance. Shared rate mode does not resolve this independent provider-logging gate. Multi-tab pending-install/logout/session-switch acceptance remains required: conservative cleanup may log out a newer session sharing SDK storage.

No CAPTCHA or MFA enrollment is added or disabled. Before rollout, verify compatibility with the project's current native Auth settings; if they require a challenge this first-phase UI does not implement, keep the feature off rather than weakening that policy.

## Exact approval/deployment boundaries

Source review and local testing authorize **none** of the following production actions. Each must be covered explicitly before it occurs:

1. Review the exact draft PR head and require its current CI/browser/native Auth results. Public synthetic test publication does not authorize merge or deployment.
2. Validate native Auth lifecycle in the authorized disposable local/CI Supabase runtime, then verify compatibility with the intended hosted version/settings: password rejected/changed, individual confirmation, old-password denial, refresh-session behavior, expiry, MFA/CAPTCHA settings and account-state coherence. Unit tests use synthetic providers; the separately authorized native CI harness uses actual GoTrue with invented identities only. Neither is a hosted production test.
3. Recheck current production definitions/ACLs and apply only the exact reviewed schema migration. It seeds no identities or business grants.
4. Deploy only the dedicated Edge Function and approve its secrets/origin/IP provenance configuration. No existing notifier or assistant credentials are repurposed.
5. Separately verify and approve the exact owner UID and each existing restricted employee UID activation record, including current additive permission scope. Leave its username unassigned; the employee chooses it during activation. No live mapping SQL is supplied as an automatic script.
6. Deploy the reviewed frontend and enable its feature flag only after backend checks pass. Existing admin email login remains independent.
7. Explicitly authorize any first-setup individual confirmation and code issuance. The employee privately chooses their username and password at first activation. No credentials are collected in chat.

Stopping or rolling back the username feature does not revoke already issued native sessions or undo a password change. Turn the browser/server flags off if necessary, preserve the mapping/audit for diagnosis, and separately handle Auth/session/grant remediation under authorization. Do not delete identities or grant management access as a workaround.

## Offboarding and old tokens

**Disable username is not full offboarding.** It blocks this alias and outstanding codes, not direct native email/password sign-in or all existing access JWTs. A native password update is expected to terminate refresh sessions in the current Auth implementation; already-issued access JWTs can remain usable until expiry plus the verifier's clock-skew tolerance (30 seconds in the pinned PostgREST 16.5 test runtime). This behavior must be verified on the intended Auth deployment before any promise about session termination.

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
