# Disposable workflow integration

This test applies actual committed SQL migrations to a fresh PostgreSQL17 service,
then runs synthetic jobs through real functions and browser button handlers.
No hosted project, business records, real credentials, or live Auth users are used.
The test server rejects non-loopback hosts and any database except
`superior_workflow_test`; browser network is limited to that local server.

`baseline.sql` is a minimal compatibility fixture for dependencies presumed by the
first committed migration (Auth helpers, roles, legacy schedule tables). It is
inferred from public application references, **not** a complete Supabase schema or
privilege export. Actual committed authorization functions and RLS execute after
migration. This does not certify parity with hosted default privileges.

The browser adapter substitutes only Auth, transport and Realtime providers. RPCs
execute with transaction-local synthetic identity claims under the authenticated
PostgreSQL role; business gates, persistence, version checks and RLS are not mocked.
GoTrue password/JWT validation, Supavisor pooling, Realtime delivery, email and AI
providers are not exercised. Screenshots contain synthetic fixture data only.

Run with PostgreSQL17 and the same environment variables/dependencies as
`.github/workflows/disposable-workflow-integration.yml`.
