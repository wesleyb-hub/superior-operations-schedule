# Disposable native Auth acceptance

This CI-only test runs actual Supabase Auth 2.197.0, PostgREST 16.5 and PostgreSQL 17.11, not hosted production. The official CLI 2.122.0 archive is SHA256-verified; `supabase.lock` pins native service archives/manifests. All services bind loopback. No project link, hosted credentials, real identities, outbound email or deployment is used.

The workflow creates two invented eligible users plus one inactive reserved-name fixture through the native Admin API, preserves native Auth tables/helpers and API-role defaults, applies the exact application migrations, then exercises the unchanged employee credential handler against real Auth and PostgREST. Passwords, setup codes, session tokens and local service keys remain in ephemeral process/runtime state; only fixed check labels and a secret-free summary are retained. The runtime and its files are destroyed in `finally`; the GitHub runner itself is disposable.

Coverage: explicit individual confirmation, actual weak-password rejection/reissue, one-use activation with employee-chosen username/password, case-insensitive collision retry without consuming the code, reset refusing rename, username login to the same UID, owner/service ACL boundaries, password reset, old-password and refresh-session rejection, old access-JWT expiry, unchanged employee grants, alias-disable versus explicit grant removal, and actual pinned browser SDK two-tab sign-in/sign-out/reload.

**Evidence limits:** the business dataset here is empty; populated SQL projection tests remain separate evidence. The browser portion tests native SDK storage synchronization, not full Hub interrupted-session installation. This test does not prove the hosted Auth version/settings, hosted Edge ingress/header provenance, logging configuration, or production ACL parity. It is not deployment or account-activation approval.

`auth.enable_signup=false` disables public registration. The email provider remains enabled so precreated users can sign in; email confirmation stays required. The 60-second JWT lifetime is a disposable-test setting only. No production Auth settings change.

Run only through **Employee native Auth lifecycle (disposable)** in the authorized draft PR. `node tests/integration/run-employee-native-auth.mjs` refuses ordinary local invocation, preserving the local runtime execution restriction. No live keys belong in this workflow or its artifacts.
