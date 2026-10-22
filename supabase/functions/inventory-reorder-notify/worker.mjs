// Pure, injectable Gmail gateway worker. Importing it cannot send email.
export const LEASE_MS = 5 * 60_000;
const PROVIDER_TIMEOUT_MS = 15_000;
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] ?? char));

export function buildDeliveryRequest(alert, { recipients }) {
  const p = alert.payload ?? {};
  const unit = p.unit ?? "units";
  const purchaseStatus = p.purchase_status ?? "Not ordered";
  const directLink = p.direct_link ??
    "https://wesleyb-hub.github.io/superior-operations-schedule/?view=inventory";
  const eventTime = p.updated_at
    ? new Date(p.updated_at).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      dateStyle: "medium",
      timeStyle: "short",
    })
    : "Not recorded";
  const isControlledTest = p.notification_type === "controlled_test";
  const subject = isControlledTest
    ? "TEST — Superior Operations inventory notification"
    : `Superior Inventory — REORDER: ${
      p.description ?? p.titan_code ?? "Production material"
    }`;
  const text = isControlledTest
    ? [
      "This is a controlled test of the Superior Operations Hub inventory notification system.",
      "",
      "No inventory count, reorder threshold, purchase status, or operational record was changed.",
      "Future real alerts will identify the material, current quantity, reorder minimum, updater, purchase status, and Inventory link.",
      "",
      `Open Superior Operations Hub: ${directLink}`,
    ].join("\n")
    : [
      "Superior Walls Production inventory has reached its reorder minimum.",
      "",
      `Material: ${p.description ?? ""}`,
      `Titan product: ${p.titan_code ?? ""}`,
      `Current quantity: ${p.quantity ?? "Not counted"} ${unit}`,
      `Reorder minimum: ${p.reorder_threshold ?? "Not set"} ${unit}`,
      `Updated by: ${p.updated_by ?? "Authorized inventory user"}`,
      `Updated: ${eventTime} CT`,
      `Purchase status: ${purchaseStatus}`,
      "",
      `Open Superior Operations Hub: ${directLink}`,
    ].join("\n");
  const html = isControlledTest
    ? `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5"><h2 style="color:#13283d">Superior Operations Hub — Controlled Test</h2><p>This is a controlled test of the inventory notification system.</p><p><b>No inventory count, reorder threshold, purchase status, or operational record was changed.</b></p><p>Future real alerts will identify the material, current quantity, reorder minimum, updater, purchase status, and Inventory link.</p><p><a href="${
      escapeHtml(directLink)
    }" style="display:inline-block;background:#13283d;color:#fff;text-decoration:none;padding:10px 14px;border-radius:6px">Open Production Inventory</a></p><p style="font-size:12px;color:#6b7280">Superior Operations Hub automated inventory test</p></div>`
    : `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5"><h2 style="color:#13283d">Superior Walls Production — Reorder Needed</h2><p>Inventory has reached its reorder minimum.</p><table style="border-collapse:collapse"><tr><td style="padding:4px 14px 4px 0"><b>Material</b></td><td>${
      escapeHtml(p.description)
    }</td></tr><tr><td style="padding:4px 14px 4px 0"><b>Titan product</b></td><td>${
      escapeHtml(p.titan_code)
    }</td></tr><tr><td style="padding:4px 14px 4px 0"><b>Current quantity</b></td><td>${
      escapeHtml(p.quantity)
    } ${
      escapeHtml(unit)
    }</td></tr><tr><td style="padding:4px 14px 4px 0"><b>Reorder minimum</b></td><td>${
      escapeHtml(p.reorder_threshold)
    } ${
      escapeHtml(unit)
    }</td></tr><tr><td style="padding:4px 14px 4px 0"><b>Updated by</b></td><td>${
      escapeHtml(p.updated_by || "Authorized inventory user")
    }</td></tr><tr><td style="padding:4px 14px 4px 0"><b>Updated</b></td><td>${
      escapeHtml(eventTime)
    } CT</td></tr><tr><td style="padding:4px 14px 4px 0"><b>Purchase status</b></td><td>${
      escapeHtml(purchaseStatus)
    }</td></tr></table><p><a href="${
      escapeHtml(directLink)
    }" style="display:inline-block;background:#13283d;color:#fff;text-decoration:none;padding:10px 14px;border-radius:6px">Open Production Inventory</a></p><p style="font-size:12px;color:#6b7280">Superior Operations Hub automated inventory alert</p></div>`;
  return { alert_id: alert.alert_id, to: recipients, subject, text, html };
}

const defaults = {
  now: () => Date.now(),
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (timer) => clearTimeout(timer),
};

// The existing Apps Script receives the same fields and credentials as before.
// Neither an aborted request nor a server error proves Gmail did not send.
export async function sendToProvider(request, config, overrides = {}) {
  const deps = { ...defaults, ...overrides };
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = deps.setTimer(() => {
      controller.abort();
      reject(new Error("Gmail gateway timeout; delivery outcome unknown"));
    }, PROVIDER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await deps.fetch(config.endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          // The secret is attached only in transit, never stored in the outbox.
          body: JSON.stringify({ ...request, secret: config.secret }),
        });
        const provider = await response.json().catch(() => ({}));
        if (response.ok && provider?.ok === true) {
          return {
            sent: true,
            id: typeof provider.id === "string" && provider.id
              ? provider.id
              : `gmail-alert-${request.alert_id}`,
            duplicate: provider.duplicate === true,
          };
        }
        // The gateway implementation/retention is not available for review.
        // A retryable hint alone does not prove Gmail did not already send.
        const retryableHint = provider?.retryable === true;
        return {
          sent: false,
          retryableHint,
          error:
            `Gmail gateway HTTP ${response.status}; delivery outcome unconfirmed; retryable_hint=${retryableHint}`,
        };
      })(),
      timeout,
    ]);
  } catch {
    return {
      sent: false,
      error: "Gmail gateway timeout/network failure; delivery outcome unknown",
    };
  } finally {
    deps.clearTimer(timer);
  }
}

// Fence both the claim and the first dispatch intent. If a write was committed
// but its response was lost, zero affected rows is NOT permission to send again.
export async function persistClaim(
  admin,
  alert,
  patch,
  overrides = {},
  startDispatch = false,
) {
  const deps = { ...defaults, ...overrides };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      let query = admin.from("inventory_alert_outbox").update(patch)
        .eq("alert_id", alert.alert_id).eq("delivery_status", "sending")
        .eq("attempts", alert.attempts).eq("claimed_at", alert.claimed_at);
      if (startDispatch) query = query.is("delivery_started_at", null);
      const { data, error } = await query.select("alert_id");
      if (!error) return Array.isArray(data) && data.length === 1;
    } catch { /* Retry only the fenced write, never a provider call here. */ }
    if (attempt < 2) await deps.sleep(100 * (attempt + 1));
  }
  return false;
}

export async function processAlert(admin, alert, config, overrides = {}) {
  const deps = { ...defaults, ...overrides };
  const result = (status, extra = {}) => ({
    alert_id: alert.alert_id,
    status,
    ...extra,
  });
  if (alert.delivery_protocol !== 1) return result("migration_required");
  const leaseValid = () => {
    const age = deps.now() - Date.parse(alert.claimed_at);
    return Number.isFinite(age) && age >= 0 &&
      age < LEASE_MS - PROVIDER_TIMEOUT_MS;
  };
  if (!leaseValid()) return result("lease_expired");
  let delivery = {
    sent: false,
    error: "Prior dispatch outcome unknown; automatic replay blocked",
  };
  try {
    if (!alert.delivery_started_at) {
      const request = alert.delivery_request ??
        buildDeliveryRequest(alert, config);
      // Durable intent precedes the one gateway call. Stale started dispatches
      // require reconciliation because the gateway's deduplication is unverified.
      if (
        !await persistClaim(
          admin,
          alert,
          {
            delivery_request: request,
            delivery_started_at: new Date(deps.now()).toISOString(),
          },
          deps,
          true,
        )
      ) return result("persistence_failed");
      if (!leaseValid()) return result("lease_expired");
      delivery = await sendToProvider(request, config, deps);
    }
  } catch {
    delivery = {
      sent: false,
      error: "Invalid Gmail delivery request",
    };
  }
  const patch = delivery.sent
    ? {
      delivery_status: "sent",
      sent_at: new Date(deps.now()).toISOString(),
      last_error: null,
      provider_message_id: delivery.id,
    }
    : {
      delivery_status: "failed",
      next_attempt_at: "infinity",
      last_error: `Manual review required: ${delivery.error}`.slice(0, 1000),
    };
  if (!await persistClaim(admin, alert, patch, deps)) {
    return result(
      "persistence_failed",
      delivery.sent ? { provider_id: delivery.id } : {},
    );
  }
  return result(
    delivery.sent ? "sent" : "failed",
    delivery.sent
      ? { provider_id: delivery.id, duplicate: delivery.duplicate }
      : { retry_scheduled: false },
  );
}

export async function processClaimedAlerts(
  admin,
  alerts,
  config,
  overrides = {},
) {
  return await Promise.all(alerts.map(async (alert) => {
    try {
      return await processAlert(admin, alert, config, overrides);
    } catch {
      return { alert_id: alert.alert_id, status: "persistence_failed" };
    }
  }));
}
