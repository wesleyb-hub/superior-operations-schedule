# Restricted mixed employee password profile — local candidate

No native account, employee access row, owner, approved record, production configuration or credential is created or changed by this patch. The requested username-derived domain address is an internal identifier, not a verified mailbox. Final account UID must come from a supported, specifically approved native provisioning operation after fresh collision checks.

## Fixed scope contract

The new `walls_production_inventory_qc_v1` profile is separate from the unchanged `walls_existing_employee_pilot_v1` profile. It accepts exactly three employee rows (Walls production, Walls installation, Boxes production), each with inventory view, adjust and manage. It accepts exactly one production grant with view/setup/pour/strip/issue/assign/plan and one installation grant with view/QC but no field management, resource assignment or field-progress writes. Read-only released/approved weekly Walls crew packs are included via `weekly-planner`; no drafts, edits, approval or publishing. No global role, independent legacy inventory grant or `weekly_planner_access` row is allowed. The effective password scope explicitly names six production actions, three inventory scopes, read-only field work and other divisions, and Walls-only QC. Full production raw-data read, unapproved packs, management, financial purchasing and plan-review approvals remain false. Inventory manage includes existing receiving, reorder thresholds/units and marking ordered; it is not financial purchasing authority.

The fixed grant validator rejects extra capabilities, missing/duplicate scopes, other entities/divisions, wrong UIDs and unexpected grant types. Current database rows are still compared in full to the reviewed snapshot at prepare and consume. The new profile does not change owner-only password authority, native identity validation, version/challenge binding, encrypted password transport, or uncertain-result lock semantics. Canonical target payloads select the profile from reviewed grants, not browser input or user-editable metadata.

## Activation is a separate reviewed action

1. Finish independent security review and synthetic database, runtime and UI tests. Capture exact migration/runtime/frontend hashes and full least-privilege matrix. This document does not approve publication, deployment or enrollment.
2. Obtain specific approval for new account provisioning, the exact restricted grants, runtime/schema deployment and the unchanged existing-target re-review. No password is supplied to an agent. The owner enters it directly in the private setup interface later.
3. Before deployment inspect current target locks/challenges and current grants/readiness using nonsecret fields only. Do not deploy during an active password operation. `applying` or `needs_review` requires inspected reconciliation; never clear locks to expedite rollout.
4. Deploy compatible runtime scope validation before enrolling a mixed target. Review coordinated DB/frontend rollout. Schema/function changes alter `employee_password.authority_fingerprint()` and deliberately make the existing reviewed target unavailable until re-reviewed. Do not disable fingerprint checks or automatically update all reviews.
5. Preserve the existing pilot identity, completion state, username, backing identifier, owner boundary and exact business grants. Under separately approved operator review, compare the pre/post full grant snapshots excluding only the expected fingerprint; require no actual grant difference, no target lock, and fresh native-state eligibility. Advance the approved record version and reviewed_at through the existing guarded path with its exact current grants. This is a sensitive operator step, not an automatic migration.
6. Fresh-check username/backing identifier collisions, create the supported native account only under specific approval, verify nonsecret UID/provider/identity metadata, apply only the reviewed grants, and enroll that UID. No email invitation or mailbox assumption is authorized by this patch.
7. Verify owner list has the correct distinct scope labels, the existing pilot remains available unchanged, the new mixed employee is not an owner, and new profile negative boundaries hold. Owner privately initializes the new employee. Confirm native login and mobile behavior without accessing the password.

## Evidence and limits

Runtime mutation tests cover every fixed scope field and all arrays. Local PostgreSQL tests exercise exact mixed grants, missing/extra/wrong/duplicate values and canonical SQL/runtime equality; the existing pilot state-machine tests remain mandatory. Native-auth and hosted verification must be reported independently from synthetic tests. New SQL functions are private, invoker-security, search-path pinned and explicitly revoked from browser/service roles; only existing guarded wrappers consume them.

Current Supabase docs consulted: Database Functions (invoker security, pinned search_path, explicit EXECUTE grants). October 27 changelog scan found the November 10 old TLS cipher retirement; no change to this SQL contract. Migration generated with Supabase CLI 2.122.0: `20261027112125_mixed_employee_password_scope.sql`.

## New native identity provisioning prerequisite

Supported API proposal, for separately approved server-side execution only:

```js
const {data,error}=await supabase.auth.admin.createUser({
  email: approvedInternalIdentifier,
  email_confirm: false
});
```

Omit `password` entirely. Do not call `signUp`, `inviteUserByEmail`, `generateLink`, OTP or recovery endpoints. Never supply a browser with administrative credentials, and never fall back to direct Auth-table inserts or a guessed mailbox. The identifier is not a verified contact address. The owner initialization action deliberately confirms the internal login identifier only while setting the first owner-chosen password through the existing encrypted, UID-bound path; it is not evidence that a mailbox was verified.

Official [createUser reference](https://supabase.com/docs/reference/javascript/auth-admin-createuser) includes email-only attributes; the pinned `@supabase/auth-js` `AdminUserAttributes` type makes password optional and `GoTrueAdminApi.createUser` documentation explicitly says the method does not send a confirmation email. This is a supported API shape, not proof of a successful hosted provisioning attempt. The native harness now creates its mixed synthetic identity using exactly these two attributes, requires the real returned email provider/sole identity to satisfy the production matcher, verifies unconfirmed/no-sign-in/no-confirmation-sent/no-recovery-sent nonsecret metadata, and subsequently initializes/resets via the owner path and verifies login. It remains unexecuted until the authorized isolated CI job runs. Hosted version/config compatibility remains a deployment verification gate.

Before any approved production call, freshly verify exact identifier collision absence and the authorized account target. After a timeout or uncertain result, read back exact nonsecret identity state before any retry; never blindly create again. Capture returned UID, exact internal identifier, provider, sole email identity, confirmation/use state and absence of MFA/ban/pending email change. Fail closed if any required invariant differs. Then apply only the separately approved grant matrix and enroll the verified UID. Native creation alone grants no Operations Hub access or password-administration authority. No actual production account has been created by this implementation.

## Trigger attachment fingerprinting

Authority fingerprinting additionally includes every noninternal trigger's schema, relation, name, enabled mode and exact definition in the relevant application/private schemas. Dropping/disabling or reattaching a target guard therefore invalidates existing reviewed records even when the trigger function text is unchanged. Synthetic tests disable and drop each mixed assignment/issue guard independently and require owner status unavailable and prepare/consume blocked, with no consumed challenge or password effect. Existing targets still require deliberate unchanged-grant re-review after this schema change.
