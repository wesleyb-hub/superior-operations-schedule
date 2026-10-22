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
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const recipients = (Deno.env.get("INVENTORY_ALERT_RECIPIENTS") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const from = Deno.env.get("INVENTORY_ALERT_FROM") ?? "";
  if (!supabaseUrl || !serviceKey || !resendKey || recipients.length === 0 || !from) return json({ error: "Server configuration incomplete" }, 500);

  const incoming = await request.json().catch(() => ({}));
  const requestedAlertId = Number(incoming?.record?.alert_id ?? incoming?.alert_id);
  const alertId = Number.isSafeInteger(requestedAlertId) ? requestedAlertId : null;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  try {
    const { data: alerts, error: claimError } = await admin.rpc("claim_inventory_alerts", { p_alert_id: alertId, p_limit: alertId ? 1 : 10 });
    if (claimError) return json({ error: "Could not claim alerts" }, 503);
    if (!alerts?.length) return json({ ok: true, processed: 0 });
    const results = await processClaimedAlerts(admin, alerts, { apiKey: resendKey, from, recipients });
    const ok = results.every((result) => result.status === "sent");
    return json({ ok, processed: results.length, results }, ok ? 200 : 503);
  } catch {
    return json({ error: "Inventory notification worker unavailable" }, 503);
  }
});
