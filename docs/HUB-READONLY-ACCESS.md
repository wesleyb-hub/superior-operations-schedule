# All-Hub read-only profile

`hub_readonly_v1` is a distinct business-reader profile, not an administrator or a writer.
It is activated only through separately reviewed provisioning. Migrations do not enroll identities.

## Scope

- All business navigation and search; all Walls subviews.
- Full production, installation, delivery, all three inventory tabs and all five divisions' QC information.
- Full weekly planner, including drafts; billing, history, audit and business reports.
- No business mutations, approvals, imports, assistant action proposals/execution, role management or employee-password administration.
- Legacy migration backup and internal system flags are not exposed through the reader snapshot. Private authentication/password state remains private.

## Enforcement

The exact enabled single employee profile is required, with no independent role, inventory, production, installation, planner or password-owner records. A reader marker remains a mutation-denial marker when disabled or malformed, or when conflicting grants are introduced. Full read capability is separate from `is_admin` and `can_write`.

Database permission functions and RLS enforce reads and deny writes independently of the interface. The UI also suppresses action controls and guards entry points before transport or local business-state changes. Personal view/filter preferences remain local and do not save business records.

The owner password endpoint accepts the exact reviewed read-only scope, not a general management role. Schema/authority changes invalidate prior review fingerprints; a separately approved rollout must preserve current identity, grants and completed setup state while refreshing only the reviewed fingerprint/version under the existing lock protocol.

## Evidence and rollout boundary

Tests use synthetic identities and disposable PostgreSQL. They are not proof that a hosted identity exists, that real native Auth onboarding succeeded, or that the current deployed runtime changed. Production account creation, scoped activation, publication and runtime/database deployment require the separately reviewed action approval and verified readback.
