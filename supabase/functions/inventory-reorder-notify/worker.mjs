// Pure, injectable worker core. No server, credentials, or network activity on import.
export const LEASE_MS = 5 * 60_000;
// Resend retains keys for 24h; stop an hour early rather than risk a duplicate.
export const SAFE_RETRY_MS = 23 * 60 * 60_000;
export const MAX_ATTEMPTS = 6;
const PROVIDER_TIMEOUT_MS = 15_000;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char] ?? char));

export function buildDeliveryRequest(alert, { from, recipients }) {
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

  return { from, to: recipients, subject, text, html };
}

const defaults = {
  now: () => Date.now(),
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (timer) => clearTimeout(timer),
};

// Both the response headers and body are bounded. Aborting the client is NOT
// proof that the provider did not accept the message: every retry keeps the key.
export async function sendToProvider(request, key, apiKey, overrides = {}) {
  const deps = { ...defaults, ...overrides };
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = deps.setTimer(() => {
      controller.abort();
      reject(new Error("Provider timeout; delivery outcome unknown"));
    }, PROVIDER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await deps.fetch("https://api.resend.com/emails", {
          method: "POST", signal: controller.signal,
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "Idempotency-Key": key },
          // jsonb normalizes object key order. Canonicalize every attempt so a
          // round-trip through PostgreSQL cannot change the provider body bytes.
          body: JSON.stringify(request, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value),
        });
        const provider = await response.json().catch(() => ({}));
        const id = typeof provider?.id === "string" && provider.id ? provider.id : null;
        if (response.ok && id) return { sent: true, id };
        // A success without an ID, 5xx, and lost connection can have accepted mail.
        const retryable = response.ok || response.status >= 500 || [408, 429].includes(response.status)
          || (response.status === 409 && provider?.name === "concurrent_idempotent_requests");
        return { sent: false, retryable, error: `Provider HTTP ${response.status}: ${String(provider?.name ?? "unconfirmed_delivery").slice(0, 100)}` };
      })(),
      timeout,
    ]);
  } catch {
    return { sent: false, retryable: true, error: "Provider timeout/network failure; delivery outcome unknown" };
  } finally {
    deps.clearTimer(timer);
  }
}

// Optimistic fencing prevents a delayed worker from overwriting a newer claim.
// Repeating the same update is safe if the database response was lost. Zero rows
// is not success: the lease may have been reclaimed or an earlier write committed.
export async function persistClaim(admin, alert, patch, overrides = {}) {
  const deps = { ...defaults, ...overrides };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data, error } = await admin.from("inventory_alert_outbox").update(patch)
        .eq("alert_id", alert.alert_id).eq("delivery_status", "sending")
        .eq("attempts", alert.attempts).eq("claimed_at", alert.claimed_at).select("alert_id");
      if (!error) return Array.isArray(data) && data.length === 1;
    } catch { /* Retry a failed write, never send again from this path. */ }
    if (attempt < 2) await deps.sleep(100 * (attempt + 1));
  }
  return false;
}

export async function processAlert(admin, alert, config, overrides = {}) {
  const deps = { ...defaults, ...overrides };
  const result = (status, extra = {}) => ({ alert_id: alert.alert_id, status, ...extra });
  const key = alert.delivery_key;
  if (typeof key !== "string" || !key) return result("migration_required");
  let request = alert.delivery_request;
  let startedAt = alert.delivery_started_at;
  let delivery = { sent: false, retryable: false, error: "Delivery request could not be prepared" };
  try {
    if (!request) {
      // Freeze recipients, sender and content before the first provider call.
      // Configuration changes or a new deployment cannot change a retry payload.
      request = buildDeliveryRequest(alert, config);
      startedAt = new Date(deps.now()).toISOString();
      if (!await persistClaim(admin, alert, { delivery_request: request, delivery_started_at: startedAt }, deps)) {
        return result("persistence_failed");
      }
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const leaseAge = deps.now() - Date.parse(alert.claimed_at);
      const deliveryAge = deps.now() - Date.parse(startedAt);
      if (!Number.isFinite(leaseAge) || leaseAge < 0 || leaseAge >= LEASE_MS - PROVIDER_TIMEOUT_MS) {
        return result("lease_expired"); // No provider call by an expired owner.
      }
      if (!Number.isFinite(deliveryAge) || deliveryAge < 0 || deliveryAge >= SAFE_RETRY_MS - PROVIDER_TIMEOUT_MS) {
        delivery = { sent: false, retryable: false, error: "safe idempotency retry window expired" };
        break;
      }
      delivery = await sendToProvider(request, key, config.apiKey, deps);
      if (delivery.sent || !delivery.retryable) break;
      if (attempt < 2) await deps.sleep(500 * (attempt + 1));
    }
  } catch {
    delivery = { sent: false, retryable: false, error: "invalid delivery request" };
  }
  const canRetry = !delivery.sent && delivery.retryable && alert.attempts < MAX_ATTEMPTS
    && deps.now() + Math.min(60, 2 ** Math.min(alert.attempts, 6)) * 60_000 < Date.parse(startedAt) + SAFE_RETRY_MS;
  const patch = delivery.sent
    ? { delivery_status: "sent", sent_at: new Date(deps.now()).toISOString(), last_error: null, provider_message_id: delivery.id }
    : { delivery_status: "failed", next_attempt_at: canRetry
      ? new Date(deps.now() + Math.min(60, 2 ** Math.min(alert.attempts, 6)) * 60_000).toISOString() : "infinity",
      last_error: `${canRetry ? "" : "Manual review required: "}${delivery.error}`.slice(0, 1000) };
  if (!await persistClaim(admin, alert, patch, deps)) {
    return result("persistence_failed", delivery.sent ? { provider_id: delivery.id } : {});
  }
  return result(delivery.sent ? "sent" : "failed", delivery.sent ? { provider_id: delivery.id } : { retry_scheduled: canRetry });
}

export async function processClaimedAlerts(admin, alerts, config, overrides = {}) {
  // Start the whole bounded claim together; a serial batch can outlive its lease.
  return await Promise.all(alerts.map(async (alert) => {
    try { return await processAlert(admin, alert, config, overrides); }
    catch { return { alert_id: alert.alert_id, status: "persistence_failed" }; }
  }));
}
