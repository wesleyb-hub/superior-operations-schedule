# Superior Operations Hub

Production site for the Superior Operations Master Operations Hub.

Live site: https://wesleyb-hub.github.io/superior-operations-schedule/

## Security baseline

- The public bundle contains application code only. Operational records load from Supabase after authentication.
- Unexpected or unsupported database payloads fail closed and are never replaced automatically.
- Run `node scripts/validate-public-bundle.mjs` before deployment.
- See `SECURITY.md` for the remaining authorization and release-control work.

Prepared by Scout
