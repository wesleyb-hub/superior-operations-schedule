# Restricted production / inventory / Walls QC profile — candidate

This is a local implementation candidate, not evidence of account creation or activation. No real employee records, native identities or grants belong in this public-source candidate.

## Exact access contract

- Walls Production: Today, Five-day flow, Table board, Weekly forecast. Existing setup, pour, strip, issue, assignment and operational plan controls are in scope. Plan-review approval, master schedule administration and weekly-planner approval/publication are not.
- Walls Field work: read-only. Walls final QC is a distinct allowed operation, not field progress, resource assignment or closeout editing.
- Inventory: view, count adjustment, thresholds/unit correction, receiving and marking ordered in Walls production, Walls install and Boxes production. Marking inventory ordered is status bookkeeping; this profile does not confer purchasing, payment or billing authority.
- Boxes, Manholes, Precast fence, Precast block: projected operational read-only views. No commercial data, raw global snapshot, mutating forms or non-Walls QC actions.
- QC: Walls only, preserving stripped-assignment and production-hold gates. A plan-review approval is not final QC and vice versa.
- Weekly crew schedule: approved Walls crew packs only, read-only. No draft schedules, planner editing, approvals or publication.
- No management, employee administration, delivery mutation, billing, importing, audit/history administration, or global schedule writer role.

## Required evidence before activation

1. Fresh isolated database applies baseline and every migration; no production URL or credentials in fixtures.
2. Exact mixed profile positive tests and every independent privilege negative case: unknown profiles, extra role rows, extra inventory grants, field write flags, planner permission, extra views/subviews, malformed scopes and disabled drift.
3. Actual RPC/RLS tests: each six production capabilities, three inventory scopes, Walls QC pass/hold/clear gate, denied non-Walls/global writes, denied raw tables, projected fields only. Validate stale version/concurrency behavior remains unchanged.
4. Legacy pilot projections/password rights unchanged; management remains unchanged.
5. Password target lifecycle with synthetic native Auth identities, reviewed-grant binding, cancellation/session-switch/replay/uncertain-outcome tests. A compatibility PostgreSQL fixture is not native Auth proof.
6. Desktop/phone UI, screen navigation, readonly controls, six widths, modal dismissal, session replacement and logout. Browser emulation is not actual-device acceptance.
7. Independent exact-diff review; precise source-publication approval before draft PR. Exact-head CI and retained screenshots reviewed before deployment request.

## Controlled activation sequence (requires separate specific approval)

- Recheck account collision and resolve exact existing/new Auth UID. A username-derived company-domain identifier is not proof of a mailbox; do not send invitations or reset links to an assumed mailbox.
- Prepare exact target and grant matrix, reviewed migration/runtime source digests and rollback plan. Obtain action-time approval for persistent access/account changes.
- Do not expose a partially configured target. Apply reviewed migration/runtime changes with feature activation fenced; verify existing owner service health.
- Authority fingerprint includes function definitions, grants, RLS and grant-table shapes. Review the unchanged legacy pilot grant snapshot against the new authority fingerprint; refresh only its approved review metadata/version under locks, with no applying password operation. This is not permission expansion and must be explicitly included in deployment plan.
- Create/enroll only the approved exact native identity through supported secure tooling, preserve all other users, and read back exact scopes. Never give a global writer role as a shortcut.
- Add the exact reviewed password target only after mixed-scope identity/grant verification. Owner chooses password privately in the existing interface. No password in messages, files or logs.
- Verify server-denial boundaries and fresh login with designated test records; never cause real business changes merely to test access. Real phone acceptance remains owner-assisted.

## Local validation and remaining gates

The integrated local candidate passes the aggregate Node suite and disposable PostgreSQL 17.10 application of all 43 migrations, exact mixed grants, existing owner-password state-machine cases, legacy operational probes, and new mixed-operation/approved-pack probes. Exact source identifiers and counts are maintained in the private delivery evidence. Browser rendering and the expanded native Auth provisioning lifecycle remain unexecuted locally; approved exact-head CI and screenshot review are required. No production activation is implied.
