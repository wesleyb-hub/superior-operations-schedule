# Local verification: employee username access

Date: 26 October 2026. Base: released `529bc6813674fa9846438191deae9ddbd8b25ae8`.
Branch: `feat/employee-usernames-local-20261026`.

Local Node runtime: 24.22.1. The prepared CI targets Node 22 but has not run remotely.

## Passed on the final implementation

| Check | Result |
| --- | --- |
| Complete Node suite (`npm test`) | **607 passed, 0 failed, 0 skipped**. Includes 30 new server-boundary tests, 36 new employee/owner UI-state tests and the existing regression suites. |
| Native Edge static typecheck | **Passed**, Deno 2.5.2 with locally installed, pinned Supabase JS 2.57.4; no function invocation. |
| Fresh disposable PostgreSQL | **41 repository migrations applied** to PostgreSQL 17.10. |
| Credential SQL cases | **28 passed** with real ACLs, RLS, row locks and independent concurrent database connections. |
| Existing business probes | `walls-workflow-cases.sql`, `employee-data-scope.sql`, and `employee-approved-crew-packs.sql` all passed unchanged. |
| Public bundle and migration guards | All five applicable validators passed: public bundle, migration catalog, function privileges, approved crew packs, managed-login database contract. |
| Source whitespace/syntax | `git diff --check`, JavaScript syntax and the inline public-bundle syntax checks passed. |
| Synthetic demo generation/isolation | Generated from final source; external scripts/config stripped, synthetic `.invalid` providers, CSP `connect-src 'none'`, no real keys or operational records. |

The tests include username normalization/uniqueness, explicit owner vs ordinary writer, anonymous/disabled/unknown users, direct API/table denial, code expiry/replacement/replay, actual concurrent redemption, durable throttling and retention races, individual confirmation intent audit, definite password rejection vs ambiguous Auth outcome, preservation of existing UID/grants, native-session installation interruption, repeated clicks, mode cancellation, reload cleanup, owner-session changes and old-token/offboarding limits.

## Not verified — release gates remain open

- **Browser acceptance and screenshots did not run.** Chromium could not create its required socket in this execution sandbox. The approved retry failed before execution during sandbox initialization with an unavailable read-only sessions mount. No workaround or alternate executor was used to bypass that restriction. The prepared phone/desktop Playwright suite must run on an authorized compatible runner before release.
- **No native GoTrue lifecycle was exercised.** Unit tests use synthetic Auth providers; SQL tests use synthetic claims. They do not verify real passwords, confirmation, JWT validation, refresh-token revocation, CAPTCHA or MFA behavior. This requires a separately authorized nonproduction Auth environment.
- **No hosted ACL/role parity or trusted-IP gateway provenance was verified.** Both are explicit production activation gates.
- **Multi-tab native session behavior remains a browser/native-Auth acceptance gate.** Conservative stale-install cleanup may sign out a newer session sharing SDK storage; the one-tab VM regressions do not establish seamless cross-tab session preservation.
- **No remote CI ran.** The source remains local; the new workflow is prepared but has not been pushed or executed in GitHub Actions.

Independent review found and verified fixes for two final lifecycle gaps: the auth listener now remains registered after interrupted-install recovery, and an initial/refresh owner directory response cannot paint after the Auth identity changes.

## Preserved boundaries

- Existing administrator company-email sign-in/recovery remains independent of the alias service.
- The production `config.js` is unchanged; employee username UI remains off unless explicitly enabled. The server is independently disabled by default.
- Existing employee Auth UIDs, backing identifiers, data, business grants, projections and RLS remain unchanged.
- The migration creates empty private mapping/owner tables. No actual employee, owner, account, invitation, login, code issuance, password, individual confirmation or role change occurred.
- Alias disable is not full offboarding; existing limited JWT business scope remains until actual backend grants/Auth controls are separately handled.
- No push, public upload, merge, deployment or production SQL was performed. The only user-facing artifact is a private, synthetic-only demo.

## Reproducible evidence

Local evidence is written to `artifacts/employee-login/` (ignored by Git): aggregate Node log, static typecheck log and disposable database result/log. The portable database runner creates a fresh loopback-only cluster and removes it after testing.

The synthetic demo's `manifest.json` records the final Hub source SHA256:

`74415ba6c06e7f1081b6e79d7c9db5d667616f2cab0021de569c8c0f530aef12`

Read [rollout and approval boundaries](EMPLOYEE-USERNAME-ROLLOUT.md) and [database lifecycle/offboarding details](EMPLOYEE-USERNAME-DATABASE.md) before considering activation. Passing local checks is not approval or proof of live readiness.
