// Durable Superior Walls Production reorder-email worker.
// Prepared by Scout for Wes Borgen

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char] ?? char));

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
  const { data: alerts, error: claimError } = await admin.rpc("claim_inventory_alerts", { p_alert_id: alertId, p_limit: alertId ? 1 : 10 });
  if (claimError) return json({ error: "Could not claim alerts", detail: claimError.message }, 500);
  if (!alerts?.length) return json({ ok: true, processed: 0 });

  const results: Array<Record<string, unknown>> = [];
  for (const alert of alerts) {
    const p = alert.payload ?? {};
    const unit = p.unit ?? "units";
    const purchaseStatus = p.purchase_status ?? "Not ordered";
    const directLink = p.direct_link ?? "https://wesleyb-hub.github.io/superior-operations-schedule/?view=inventory";
    const eventTime = p.updated_at ? new Date(p.updated_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
    const subject = `Superior Inventory — REORDER: ${p.description ?? p.titan_code ?? "Production material"}`;
    const text = [
      "Superior Walls Production inventory has reached its reorder minimum.", "",
      `Material: ${p.description ?? ""}`, `Titan product: ${p.titan_code ?? ""}`,
      `Current quantity: ${p.quantity ?? "Not counted"} ${unit}`, `Reorder minimum: ${p.reorder_threshold ?? "Not set"} ${unit}`,
      `Updated by: ${p.updated_by ?? "Authorized inventory user"}`, `Updated: ${eventTime} CT`,
      `Purchase status: ${purchaseStatus}`, "", `Open Superior Operations Hub: ${directLink}`,
    ].join("\n");
    const html = `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5"><h2 style="color:#13283d">Superior Walls Production — Reorder Needed</h2><p>Inventory has reached its reorder minimum.</p><table style="border-collapse:collapse"><tr><td style="padding:4px 14px 4px 0"><b>Material</b></td><td>${escapeHtml(p.description)}</td></tr><tr><td style="padding:4px 14px 4px 0"><b>Titan product</b></td><td>${escapeHtml(p.titan_code)}</td></tr><tr><td style="padding:4px 14px 4px 0"><b>Current quantity</b></td><td>${escapeHtml(p.quantity)} ${escapeHtml(unit)}</td></tr><tr><td style="padding:4px 14px 4px 0"><b>Reorder minimum</b></td><td>${escapeHtml(p.reorder_threshold)} ${escapeHtml(unit)}</td></tr><tr><td style="padding:4px 14px 4px 0"><b>Updated by</b></td><td>${escapeHtml(p.updated_by || "Authorized inventory user")}</td></tr><tr><td style="padding:4px 14px 4px 0"><b>Updated</b></td><td>${escapeHtml(eventTime)} CT</td></tr><tr><td style="padding:4px 14px 4px 0"><b>Purchase status</b></td><td>${escapeHtml(purchaseStatus)}</td></tr></table><p><a href="${escapeHtml(directLink)}" style="display:inline-block;background:#13283d;color:#fff;text-decoration:none;padding:10px 14px;border-radius:6px">Open Production Inventory</a></p><p style="font-size:12px;color:#6b7280">Superior Operations Hub automated inventory alert</p></div>`;

    let response: Response | null = null;
    let provider: Record<string, unknown> = {};
    for (let deliveryAttempt = 1; deliveryAttempt <= 3; deliveryAttempt += 1) {
      response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: recipients, subject, text, html }) });
      provider = await response.json().catch(() => ({}));
      if (response.ok || response.status < 500 || deliveryAttempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, deliveryAttempt * 1500));
    }
    if (response?.ok) {
      await admin.from("inventory_alert_outbox").update({ delivery_status: "sent", sent_at: new Date().toISOString(), last_error: null, provider_message_id: provider.id ?? null }).eq("alert_id", alert.alert_id).eq("delivery_status", "sending");
      results.push({ alert_id: alert.alert_id, status: "sent", provider_id: provider.id ?? null });
    } else {
      const delayMinutes = Math.min(60, 2 ** Math.min(Number(alert.attempts ?? 1), 6));
      await admin.from("inventory_alert_outbox").update({ delivery_status: "failed", next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(), last_error: JSON.stringify(provider).slice(0, 1000) }).eq("alert_id", alert.alert_id).eq("delivery_status", "sending");
      results.push({ alert_id: alert.alert_id, status: "failed" });
    }
  }
  return json({ ok: results.every((result) => result.status === "sent"), processed: results.length, results });
});
