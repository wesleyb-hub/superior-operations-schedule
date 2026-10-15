# Operations Assistant deployment

Prepared by Scout for Wes Borgen

This function uses the authenticated employee's Supabase token. It deliberately does not use the service-role key, so existing row-level access, inventory permissions, and production permissions remain authoritative.

Required function secrets:

- `OPENAI_API_KEY`: a dedicated server-side OpenAI project key. Never place it in `config.js` or `index.html`.
- `OPENAI_MODEL`: an approved Responses API model name. The function defaults to `gpt-5.4` when this setting is absent.

Release order:

1. Apply `20261015_014_operations_agent_pilot.sql`.
2. Add the two function secrets in Supabase.
3. Deploy the `operations-agent` Edge Function with JWT verification enabled.
4. Publish the updated site.
5. Test a harmless proposal, reject it, then test one controlled inventory count and confirm the matching `operations_agent_actions` and `inventory_events` records.

The pilot can only propose a physical inventory count, routine production-stage advancement, or setup-progress update. It cannot delete, schedule, assign tables, grant access, send messages, make purchases, resolve holds, or approve QC / Ready for Pour.
