# Assigned usernames with direct native Auth

Status: approved username opt-in prepared for release, conditional on the final
exact-head checks and release verification. It starts from the released main,
not the separate credential-proxy draft. No mail configuration, account creation,
invitation or access change is included.

## Small first pilot

An owner assigns a username matching the local part of an existing company Auth
email. The employee enters that username and their private password. The browser
derives `username@configured-company-domain` and calls Supabase's native password
sign-in directly. There is no username lookup, personal-email directory, Edge
password/session proxy or recoverable password store. The configured company
domain remains unchanged; a username is not a role or permission.

The new entry point is visible only when the separately approved configuration
sets `employeeUsernameLoginEnabled: true`. This release configuration explicitly
opts in; the application still defaults off when the flag is absent or false.
Existing administrator email sign-in and recovery remain
available. The ordinary session-start domain check, UID-based application access,
restricted projections and business RLS remain authoritative.

This is not registration. It does not create a user, assign access, rename an
account, change its email, confirm it or send an invitation. Invalid or failed
employee sign-in gives no account-status detail. Employee recovery directs the
employee to the owner; the existing native email recovery route is not removed.

## Password setup and recovery

An authorized owner approves the delivery address and initiates setup/recovery
for the exact existing identity. The employee follows the link and chooses a
password on the Hub's existing native Auth password screen. Passwords go to
native Auth, never to the owner, chat, repository or a custom function.

The minimal selected pilot route is manual delivery: a separately approved,
private administrator helper generates a native recovery link for the exact
existing UID/backing company email, validates the returned UID, and presents the
link privately to the owner. The owner sends it from their own mailbox to the
independently verified personal/work contact. No Supabase SMTP configuration,
company forwarding rule or custom server mailer is required for that manual
route. This frontend candidate does not include or execute the helper. Never
generate signup/invite/magic-link identities as a shortcut for an existing user.

Generation is not delivery. Require the intended employee to confirm receipt
without sharing the link. The private helper must never expose an administrator
key or recovery link to the assistant, repository, shared logs or artifacts.
No public Edge endpoint should return a setup link. Keep delivery contacts out of
the public bundle and verify them with the employee before an authorized send.

If automated delivery is wanted later, review that separately. Supabase's native
sender has recipient limits; a production SMTP provider, owner-managed company
mail routing or a reviewed server mailer may then be needed. Merely changing the
Auth email to a personal address would break this deterministic username scheme
and may affect email-keyed grants; it is not an implicit fallback. No public form
may claim another employee's username by entering an arbitrary delivery address.

Native recovery can individually confirm an unconfirmed existing account when
the link is redeemed. Treat this as an explicit activation consequence, not a
global confirmation-setting change. Links are bearer credentials: do not inspect,
copy into chat, log, record in analytics or publish them. Expired, consumed or
scanner-opened links need a controlled reissue, not duplicate account creation.

The existing password form is also repaired in this candidate. It captures the
recovery UID/session, verifies that identity with an isolated nonpersistent native
SDK client and sends the actual password update through that client. A newer
shared browser session cannot redirect the password mutation to another account.
Logout, identity replacement and page lifecycle invalidate the old form. After
success, failure or cancellation, awaited local SDK cleanup and a verified
nonsecret marker fence the retained recovery session when browser storage works.
Conservative cleanup can also sign out a newer racing tab session; that person
may need to sign in again, but their password is never the recovery target.
The SDK is pinned to the exact version used by native browser acceptance.

Residual native callback boundary: the SDK can persist a recovery session before
the Hub receives its event. If writing the nonsecret marker fails while reads
still appear empty, and native local sign-out also fails, a later reload can
restore that authenticated recovery session. The screen reports failed cleanup,
not a successful save/sign-out; this candidate does not guarantee durable cleanup
under that combined storage failure. The pilot requires functioning
`sessionStorage` and confirmed sign-out/fresh-tab cleanup on the intended device.
Moving recovery URL consumption ahead of shared SDK persistence would be a
separate architecture change, not a hidden guarantee of this small repair.
Abrupt tab/process termination can also prevent queued cleanup from finishing;
a per-tab marker does not fence a brand-new tab in that case. Closing a tab is
not sign-out. The no-restoration claim applies only after awaited successful
cleanup. A valid recovery link already authenticates its UID; this form is not
an onboarding-completion authorization gate, and existing backend grants still
govern that session.

The username UI code remains off by default; this approved release configuration
opts in. The recovery security repair applies to the existing email setup/reset
form when this candidate is released;
it is not gated by the new username flag.

## Identity and access invariants

- Reuse the exact existing Auth UID. Matching an employee's display name is not
  identity verification. No automatic grant follows a username or email domain.
- Keeping the existing backing email avoids an unnecessary migration. If a later
  assigned username requires a different backing email, stop for a separate
  reviewed migration: audit both old and proposed emails for legacy email-keyed
  inventory grants, preserve the approved permission union and historical audits,
  and account for old JWT email claims until expiry. Never silently move grants.
- Direct Auth does not use the other draft's alias lock or shared throttling.
  Native Auth rate limits and approved abuse controls apply. Disabling this UI is
  not offboarding: remove actual business grants and use approved Auth controls.
  Password reset does not guarantee immediate rejection of every issued JWT.
- Native SDK sign-in may persist a session before its promise resolves. The
  frontend must fence pending login, logout, page lifecycle and reload, clear an
  obsolete native session, and keep the Auth listener installed after cleanup.
  A nonsecret pending marker is not a password/token store.
- Unreadable pending-marker storage is unresolved, not proof that no login was
  pending. Cleanup must remove and verify the marker before unlocking, even if
  the username feature was subsequently disabled. A browser that blocks
  `sessionStorage` may therefore need storage access restored before any sign-in
  on that device, including administrator sign-in. This is a fail-closed
  availability tradeoff, not a restriction on the administrator's Auth account.

## Verification and release boundary

Run the focused service-free tests and the repository's full Node/static checks.
They execute synthetic SDK adapters; they are not new proof of native mail,
token redemption or actual-device behavior. The earlier proxy draft's green CI
does not certify this new candidate.

Before a release request, obtain independent source review and exact-candidate
browser checks, including phone layouts and full-Hub/native session lifecycle
and multi-tab behavior. Native recovery testing must cover the existing-UID
return, confirmation consequence, private password choice, ordinary sign-in,
reset/old-password rejection, expired/replayed link handling and session cleanup.
Any disposable runtime/public CI additions need their applicable authorization;
do not retry a denied local runtime using another unapproved route.

Publishing a new draft, merging, deploying, enabling the flag, mail configuration,
account provisioning or migration, sending setup/reset links and assigning access
are distinct approval boundaries. For the first pilot, verify the intended UID
and existing limited scopes immediately before the individually approved setup.
Then let the employee use their own phone and private credentials; verify only
the approved screens/actions, without broadening permissions to make a UI work.
Onboard the remaining employees only after that first pilot and a private,
owner-approved roster. No real roster belongs in this public repository.

## Primary references checked 2026-10-26

- [Native password Auth](https://supabase.com/docs/guides/auth/passwords)
- [Custom SMTP and default-sender limits](https://supabase.com/docs/guides/auth/auth-smtp)
- [Generate links for a custom sender](https://supabase.com/docs/reference/javascript/auth-admin-generatelink)
- [Pinned recovery verification implementation](https://raw.githubusercontent.com/supabase/auth/v2.197.0/internal/api/verify.go)
- [Auth changelog](https://supabase.com/changelog): current TLS retirement affects
  obsolete clients; no namespace, schema or mail setting change is inferred.
