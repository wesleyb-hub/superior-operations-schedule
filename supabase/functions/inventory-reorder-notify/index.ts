// Durable Superior Walls Production reorder-email worker.
// Prepared by Scout for Wes Borgen

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processClaimedAlerts } from "./worker.mjs";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expectedSecret = Deno.env.get("INVENTORY_WEBHOOK_SECRET") ?? "";
  const suppliedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expectedSecret || suppliedSecret !== expectedSecret) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const gmailEndpoint = Deno.env.get("GMAIL_APPS_SCRIPT_URL") ?? "";
  const gmailSecret = Deno.env.get("GMAIL_APPS_SCRIPT_SECRET") ?? "";
  const recipients = (Deno.env.get("INVENTORY_ALERT_RECIPIENTS") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!supabaseUrl || !serviceKey || !gmailEndpoint || !gmailSecret || recipients.length === 0) return json({ error: "Server configuration incomplete" }, 500);

  const incoming = await request.json().catch(() => ({}));
  const requestedAlertId = Number(incoming?.record?.alert_id ?? incoming?.alert_id);
  const alertId = Number.isSafeInteger(requestedAlertId) ? requestedAlertId : null;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  try {
    const { data: alerts, error: claimError } = await admin.rpc("claim_inventory_alerts", { p_alert_id: alertId, p_limit: alertId ? 1 : 10 });
    if (claimError) return json({ error: "Could not claim alerts" }, 503);
    if (!alerts?.length) return json({ ok: true, processed: 0 });
    const results = await processClaimedAlerts(admin, alerts, { endpoint: gmailEndpoint, secret: gmailSecret, recipients });
    const ok = results.every((result) => result.status === "sent");
    return json({ ok, processed: results.length, results }, ok ? 200 : 503);
  } catch {
    return json({ error: "Inventory notification worker unavailable" }, 503);
  }
});
