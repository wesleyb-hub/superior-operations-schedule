# Verification: employee-chosen username and password

Date: 26 October 2026. Released base: `529bc6813674fa9846438191deae9ddbd8b25ae8`.
Draft review: [PR #105](https://github.com/wesleyb-hub/superior-operations-schedule/pull/105).

## Current activation revision — local checks passed

The owner authorizes an existing restricted UID. The employee chooses **both username and password** using a private one-use activation code. Reset preserves the established username. No new Auth provisioning or permission selection is added.

| Check | Result |
| --- | --- |
| Full Node suite | **624 passed, 0 failed, 0 skipped** on Node 24.22.1, including shared-pilot all-request budgets, no IP reads, spoof resistance, concurrency and unchanged default fail-closed behavior. |
| Edge static typecheck | Passed with Deno 2.5.2 and pinned Supabase JS 2.57.4; no hosted invocation. |
| Disposable PostgreSQL | All **41 exact migrations** applied to fresh loopback PostgreSQL 17.10. |
| Credential SQL | **35 cases passed**, including two invitations racing for one name, one code racing with different names, collision retry without code consumption, code-hash uniqueness, monotonic activation, reset no-rename, weak rejection versus ambiguous failure, role/ACL and offboarding boundaries. |
| Existing business probes | Workflow, populated employee-scope projections and approved crew packs all passed unchanged. |
| Security/static guards | Five validators, JavaScript syntax and `git diff --check` passed. |
| Independent source review | Reviewed the revised server/SQL/UI contract and test-only native runner; no remaining source blocker found at this checkpoint. |

## Remote evidence and its exact scope

The earlier password-only activation candidate at head `46f54de6d92b1247d0a41e2a72e8d056fe031e38` passed all six workflows: [credential/browser checks](https://github.com/wesleyb-hub/superior-operations-schedule/actions/runs/40345558510) and [broad security/UI checks](https://github.com/wesleyb-hub/superior-operations-schedule/actions/runs/40345558050), including 21 synthetic employee checks, 66 workflow screens, 28 modal recovery scenarios and 210 phone checks. Those results are historical, **not a substitute for the new employee-chosen-username head**.

The employee-chosen-username head `139aa7a0f381d1b70677bb8761890de78eccfc54` passed all seven workflows, including [23 desktop/phone checks](https://github.com/wesleyb-hub/superior-operations-schedule/actions/runs/40361905703) and [19 actual native Auth check groups with cleanup=true](https://github.com/wesleyb-hub/superior-operations-schedule/actions/runs/40361905373). Those results predate the optional shared-pilot rate mode. The current shared-mode revision must pass exact-head CI, including its added real durable shared-budget test; do not treat preparation or older green checks as that pass.

The native harness uses actual pinned Auth 2.197.0, PostgREST 16.5 and PostgreSQL 17.11 with invented identities only. It exercises the unchanged handler against real providers, individual confirmation, password rejection/setup/reset, username collision/retry, same-UID/grant preservation, refresh rejection, old-JWT expiry and real browser SDK cross-tab logout. Its business dataset is empty; existing populated SQL probes remain the row/projection evidence. Its browser fixture is SDK-only, not full Hub interrupted-install acceptance. See [native test boundaries](../tests/integration/native-auth/README.md).

## Environment limits and remaining release gates

- Local Chromium was environment-blocked; authorized GitHub browser checks are the supported execution route.
- The official checksummed native CLI/service archives installed locally, but its elevated launcher failed before execution on a read-only sandbox mount. No local Auth service or users started; the isolated tools/cache were removed. The separately authorized GitHub native test does not access a hosted project.
- Hosted Auth/settings compatibility and production role/ACL parity require separate preflight. Trusted-IP mode requires verified actual ingress provenance; the explicit shared-pilot alternative avoids caller-IP dependence at the cost of whole-pilot lockout. Credential-safe hosted logging remains required in either mode.
- Full Hub multi-tab pending-install/logout/session-switch acceptance is distinct from SDK-only synchronization. Conservative cleanup can sign out a newer shared session.
- Merge, deployment, feature activation, owner allowlisting, existing employee UID authorization, individual confirmation and real setup-code issuance still need their explicit release/action-time approvals.

## Preserved boundaries

The production `config.js` and accepted employee-review bundle remain unchanged. Browser/server flags are off by default. Existing administrator email login stays independent. The application creates no duplicate identity, edits no backing identifier, grants no business role and seeds no real employee or owner. Supabase remains password authority. No passwords, setup codes or native tokens are saved in the application or published test results. Disabling a username is not full offboarding.

The synthetic demo is built from the current source and its manifest records source hashes; it is not a live account environment. Read [rollout/approval boundaries](EMPLOYEE-USERNAME-ROLLOUT.md) and [database lifecycle details](EMPLOYEE-USERNAME-DATABASE.md) before activation.
