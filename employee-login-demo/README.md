# Employee username sign-in: local UI demo

This is a **synthetic-only local demo**, separate from the accepted `employee-review/`
artifact. It renders the candidate Hub's actual sign-in and existing restricted
employee screens. The adapter simulates authentication; it does **not** prove
Supabase Auth, SQL/RLS, code expiry/replay protection or deployed permission scope.
No real account, password, key or operational record is included.

Build and serve only on loopback:

```sh
node employee-login-demo/build-demo.mjs artifacts/employee-login-demo
python3 -m http.server 8765 --bind 127.0.0.1 --directory artifacts/employee-login-demo
```

You can also open the generated `index.html` directly in a browser; no server or
account is needed for this self-contained demo. Open `owner.html` for the owner
example. Never type a real password into either demo.

Open `http://127.0.0.1:8765/`. Choose **Employee username sign in → Use setup /
reset code**. The sample employee starts unactivated: choose an invented username
such as `sample-employee`, an invented code, and your own invented password
(at least 12 characters and at most 72 UTF-8 bytes). Then sign in using the chosen
username. Later sample resets keep that username; they do not rename the account. Do not type real credentials into a demo. The owner handoff
example is `http://127.0.0.1:8765/owner.html`.

The demo strips live config and external scripts, uses an in-memory synthetic
provider, disables live network via CSP, and does not persist entered credentials.
It does not save operational records. Do not publish the generated artifact as a
production Hub or treat it as authorization to create/modify accounts.

## Validation

```sh
node --test scripts/test-employee-login-ui.mjs scripts/test-employee-login-owner-ui.mjs scripts/test-session-save-safety.mjs
node scripts/validate-public-bundle.mjs
# Requires the repository's pinned Playwright dependency and Chromium:
node scripts/validate-employee-login-ui.mjs artifacts/employee-login-ui
```

The browser check covers phone/desktop sign-in and setup, repeated/cancelled
requests, private code clearing, existing restricted navigation, owner denial and
handoff, screenshot capture, and a zero-external-network assertion. A generated
HTML file or passing Node unit tests is not a browser acceptance result.

## Production boundary

- `employeeUsernameLoginEnabled` defaults **off** (absent from existing config).
- Existing company email sign-in/recovery stays independent of the alias service.
- Production stores only a non-secret, project-keyed pending-install boolean in
  sessionStorage around native session installation. No password, code or token is
  added by this feature. If interrupted, the next load completes local sign-out
  before opening a retained session; failed cleanup stays locked with Retry Sign
  Out. The synthetic standalone demo keeps this flag in memory only.
- Only the deliberate outside-domain managed identity path consults
  `get_employee_login_access`; permissions still come from the existing verified
  Auth UID, application access RPC and backend projections/RLS.
- `employee-access.html` is a separate owner handoff page. It requires an existing
  native session and a successful server owner-list authorization; it does not
  infer owner authority from an admin screen or writer role.
- It lists already-authorized existing employee identities, including those
  awaiting their first username. Owner actions target the complete immutable Auth
  UID, never a label/name match. First activation lets the employee choose the
  username and password; later resets keep that established username.
- The UI creates no account, identity mapping, owner grant or employee permission.
  Password fields clear on each employee submission. A setup code stays only in
  the active form so a generic username conflict can be retried before expiry;
  leaving the form clears it. There is no username-availability lookup.
- Alias disable does not revoke native email sign-in or already-issued access
  tokens. Full offboarding needs a separately authorized backend/Auth procedure.
- Deployment, owner/mapping provisioning and any actual credential change require
  separate approval and the backend release checks described by the feature docs.
