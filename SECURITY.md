# Security hardening status

Prepared by Scout for Wes Borgen

## Completed

- Removed seeded operational records from the public HTML bundle.
- Removed the client path that could replace the live Supabase record when a schema flag or version was unexpected.
- Changed unsupported payload handling to fail closed without writing.
- Added server-enforced access: Wesley Borgen and Lance Thompson have full write access; other authenticated company-domain users can view every dashboard but cannot save changes.
- Added a repeatable public-bundle validation script and GitHub Actions check.

## Remaining work

- Add division-specific employee permissions after the shared database payload is split into permission-safe tables or services.
- Rotate any dashboard password that has been shared in a message.

## Chat architecture recommendation

Use a Supabase Edge Function as the server boundary. It should validate the signed-in user and role, expose only allowlisted read tools, query a structured read model, and call the OpenAI Responses API with the API key stored only in server-side secrets. The first release should be read-only and cite the schedule records used in each answer.

Do not put an OpenAI API key in browser-delivered assets.
