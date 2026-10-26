// Dedicated employee credential boundary. Never import the operations agent or mail worker.
// Passwords/codes live only in this request's memory; only Supabase Auth stores passwords.
export const FAILURE = 'Unable to complete this request. Check your details or ask the owner for help.';
// Constructed only for a received native Auth422 weak_password response, never a transport error.
export class PasswordRejected extends Error { constructor() { super('password_rejected'); } }
const RESERVED = new Set(['admin', 'administrator', 'owner', 'root', 'system', 'support']);
const encoder = new TextEncoder();
export function normalizeUsername(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const username = value.trim().toLowerCase();
  return /^[a-z][a-z0-9._-]{2,31}$/.test(username) && !RESERVED.has(username) ? username : null;
}
export function normalizeEmployeeId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}
export function normalizeCode(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/.test(code) ? code : null;
}
export function acceptablePassword(value, setup = false) {
  return typeof value === 'string' && value.length >= (setup ? 12 : 1) && encoder.encode(value).length <= 72;
}
export function canonicalIp(value) {
  if (typeof value !== 'string' || value.length > 64 || /[,\s%]/.test(value)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    const parts = value.split('.');
    return parts.every(p => String(Number(p)) === p && Number(p) <= 255) ? parts.join('.') : null;
  }
  if (!/^[0-9a-f:]+$/i.test(value) || !value.includes(':')) return null;
  try { return new URL(`http://[${value}]/`).hostname.slice(1, -1).toLowerCase(); } catch { return null; }
}
export async function digestSecret(secret, namespace, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${namespace}\0${value}`)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
export function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let buffer = 0, bits = 0, code = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; code += alphabet[(buffer >>> bits) & 31]; }
  }
  return code.match(/.{4}/g).join('-');
}
async function boundedJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('input');
  if (Number(request.headers.get('content-length') || 0) > 4096) throw new Error('input');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('input');
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); throw new Error('input'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('input');
  return body;
}

// Services are request-local: a password grant must never replace a shared admin client's JWT.
export function createEmployeeAccessHandler({ config, services, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now() }) {
  return async request => {
    const start = now();
    const origin = request.headers.get('origin') || '';
    const allowedOrigin = config.origins?.includes(origin) && /^https:\/\//.test(origin);
    const headers = {
      'content-type': 'application/json', 'cache-control': 'no-store, private', 'pragma': 'no-cache',
      'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'vary': 'Origin',
      ...(allowedOrigin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS' } : {}),
    };
    const reply = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers });
    const deny = async (status = 401) => {
      // Coarse timing equalization is defense-in-depth, not a constant-time network guarantee.
      await sleep(Math.max(0, 700 - (now() - start)));
      return reply({ error: FAILURE }, status);
    };
    if (!allowedOrigin) return reply({ error: FAILURE }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: FAILURE }, 405);
    // Both gates are deliberately OFF until an authorized deployment verifies ingress IP provenance.
    if (!config.enabled || !config.ipTrustVerified || !config.ipHeader || typeof config.hmacSecret !== 'string' || config.hmacSecret.length < 32) return reply({ error: FAILURE }, 503);
    const ip = canonicalIp(request.headers.get(config.ipHeader));
    if (!ip) return reply({ error: FAILURE }, 503);
    let svc, mintedSession;
    try {
      svc = services();
      const bucket = (name, value) => digestSecret(config.hmacSecret, `throttle:${name}`, value);
      const throttle = async (keys, limit, seconds) => svc.rpc('employee_login_throttle', {
        p_keys: await Promise.all(keys), p_limit: limit, p_window_seconds: seconds,
      });
      // Global cap runs BEFORE attacker-controlled alias buckets, bounding bucket cardinality.
      if (!await throttle([bucket('global', 'all')], 1000, 300)) return deny(429);
      if (!await throttle([bucket('ip', ip)], 120, 300)) return deny(429);
      let body;
      try { body = await boundedJson(request); } catch { return deny(400); }
      const action = body.action;
      if (!['sign-in', 'redeem', 'owner-list', 'owner-issue', 'owner-disable'].includes(action)) return deny(400);
      const username = normalizeUsername(body.username);
      const employeeId = normalizeEmployeeId(body.employeeId);
      const allowedKeys = {
        'sign-in': ['action', 'username', 'password'], redeem: ['action', 'username', 'code', 'password'],
        'owner-list': ['action'], 'owner-issue': ['action', 'employeeId', 'confirmEmail'], 'owner-disable': ['action', 'employeeId'],
      }[action];
      if (Object.keys(body).some(key => !allowedKeys.includes(key))) return deny(400);
      if (['sign-in', 'redeem'].includes(action) && !username) return deny(400);
      if (['owner-issue', 'owner-disable'].includes(action) && !employeeId) return deny(400);

      if (action.startsWith('owner-')) {
        const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
        if (!token || token.length > 8192) return deny(403);
        // Auth server verification, not untrusted JWT decode or user_metadata.
        const actor = await svc.getUser(token);
        if (!actor?.id || actor.is_anonymous || !await svc.rpc('employee_login_check_owner', { p_actor: actor.id })) return deny(403);
        if (!await throttle([bucket('owner', actor.id)], 30, 600)) return deny(429);
        if (action === 'owner-list') return reply({ employees: await svc.rpc('employee_login_list', { p_actor: actor.id }) });
        if (!await throttle([bucket('owner-issue', actor.id)], 10, 600)) return deny(429);
        if (action === 'owner-disable') {
          const done = await svc.rpc('employee_login_disable', { p_actor: actor.id, p_uid: employeeId });
          return done ? reply({ ok: true }) : deny(400);
        }
        if (body.confirmEmail !== undefined && typeof body.confirmEmail !== 'boolean') return deny(400);
        const code = generateCode();
        // Code identifies the preapproved UID independently of a not-yet-chosen username.
        const codeHash = await digestSecret(config.hmacSecret, 'code', normalizeCode(code));
        const issued = await svc.rpc('employee_login_issue', {
          p_actor: actor.id, p_uid: employeeId, p_code_hash: codeHash, p_code_id: crypto.randomUUID(), p_confirm_email: body.confirmEmail === true,
        });
        if (!issued?.expires_at || issued.user_id !== employeeId) return deny(400);
        // Code is returned ONCE; no retrieval endpoint and no outgoing email/message service.
        return reply({ employeeId, username: issued.username ?? null, setupCompleted: issued.setup_completed === true, code, expires_at: issued.expires_at });
      }

      if (!acceptablePassword(body.password, action === 'redeem')) return deny(400);
      if (action === 'redeem') {
        const code = normalizeCode(body.code); if (!code) return deny(400);
        // Changing a proposed username cannot reset the invitation's attempt budget.
        if (!await throttle([bucket('redeem-code', code)], 5, 600)) return deny(429);
        const claimId = crypto.randomUUID();
        const codeHash = await digestSecret(config.hmacSecret, 'code', code);
        const claim = await svc.rpc('employee_login_claim', { p_username: username, p_code_hash: codeHash, p_claim_id: claimId });
        if (!claim?.user_id) return deny();
        try {
          // Claim is permanently consumed BEFORE the external Auth call. No retry on ambiguity.
          // The sole user patch is a password plus separately owner-approved individual confirmation.
          const patch = { password: body.password, ...(claim.confirm_email === true ? { email_confirm: true } : {}) };
          const updated = await svc.updatePassword(claim.user_id, patch);
          if (updated?.id !== claim.user_id) throw new Error('auth');
          const finished = await svc.rpc('employee_login_finish', { p_uid: claim.user_id, p_claim_id: claimId, p_success: true });
          if (!finished) throw new Error('finish');
          return reply({ ok: true });
        } catch (error) {
          if (error instanceof PasswordRejected) {
            // Auth's password-strength check runs before its update transaction. The used code
            // stays consumed, but an owner can issue a NEW code after this definite rejection.
            await svc.rpc('employee_login_password_rejected', { p_uid: claim.user_id, p_claim_id: claimId });
            return deny(400);
          }
          // An uncertain write may have changed the password: preserve a blocked state for reconciliation.
          // Failure to record this leaves 'processing', also blocked; neither state permits a new attempt.
          await svc.rpc('employee_login_finish', { p_uid: claim.user_id, p_claim_id: claimId, p_success: false }).catch(() => {});
          return deny(503);
        }
      }

      if (!await throttle([bucket('sign-in', username)], 10, 600)) return deny(429);
      const alias = await svc.rpc('employee_login_resolve', { p_username: username });
      const loginDenied = async () => {
        await svc.rpc('employee_login_audit', { p_event: 'sign_in', p_outcome: 'denied', p_actor: null, p_target: alias?.user_id || null });
        return deny();
      };
      if (!alias?.user_id) return loginDenied();
      const user = await svc.getUserById(alias.user_id);
      if (!user?.email || user.id !== alias.user_id || user.is_anonymous || user.deleted_at || (user.banned_until && Date.parse(user.banned_until) > now())) return loginDenied();
      // Email is resolved only inside this server. Native Supabase Auth remains password authority.
      const session = await svc.signIn({ email: user.email, password: body.password });
      mintedSession = session?.access_token;
      if (!session?.access_token || !session?.refresh_token || session.user?.id !== alias.user_id) {
        if (mintedSession) await svc.revokeSession(mintedSession).catch(() => {});
        return loginDenied();
      }
      const after = await svc.rpc('employee_login_resolve', { p_username: username });
      if (after?.user_id !== alias.user_id) {
        await svc.revokeSession(session.access_token).catch(() => {});
        return loginDenied();
      }
      await svc.rpc('employee_login_audit', { p_event: 'sign_in', p_outcome: 'succeeded', p_actor: alias.user_id, p_target: alias.user_id });
      return reply({ session: { access_token: session.access_token, refresh_token: session.refresh_token } });
    } catch {
      // Intentionally no console/error/body logging and no upstream Auth error passthrough.
      if (mintedSession && svc) await svc.revokeSession(mintedSession).catch(() => {});
      return deny(503);
    }
  };
}
