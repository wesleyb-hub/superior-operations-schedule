import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEmployeeAccessHandler, normalizeUsername, normalizeEmployeeId, normalizeCode, acceptablePassword, canonicalIp, digestSecret, generateCode, FAILURE, PasswordRejected } from '../supabase/functions/employee-access/handler.mjs';

const UID = '00000000-0000-4000-8000-000000000201';
const OWNER = '00000000-0000-4000-8000-000000000202';
const OTHER = '00000000-0000-4000-8000-000000000203';
const PASSWORD = 'synthetic-only-password';
const CODE = 'ABCD-EFGH-JKLM-NPQR';
const config = { enabled: true, ipTrustVerified: true, ipHeader: 'x-verified-test-ip', hmacSecret: 'synthetic-test-secret-never-deploy-this', origins: ['https://synthetic.invalid'] };
function fixture({ overrides = {}, cfg = {}, rpcOverride } = {}) {
  const calls = [], waits = [];
  const defaults = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (rpcOverride) { const result = await rpcOverride(name, args); if (result !== undefined) return result; }
      switch (name) {
        case 'employee_login_throttle': return true;
        case 'employee_login_check_owner': return args.p_actor === OWNER;
        case 'employee_login_list': return [{ username: 'synthetic', user_id: UID, status: 'active', enabled: true }];
        case 'employee_login_resolve': return { user_id: UID, username: args.p_username };
        case 'employee_login_issue': return { user_id: args.p_uid, username: null, setup_completed: false, expires_at: '2099-01-01T00:00:00Z' };
        case 'employee_login_claim': return { user_id: UID, confirm_email: false };
        case 'employee_login_finish': return args.p_success;
        case 'employee_login_password_rejected': return true;
        case 'employee_login_disable': return true;
        case 'employee_login_audit': return null;
        default: throw new Error('Unexpected RPC');
      }
    },
    async getUser(token) { calls.push({ name: 'getUser', args: { token } }); return token === 'synthetic-owner-token' ? { id: OWNER } : null; },
    async getUserById(uid) { calls.push({ name: 'getUserById', args: { uid } }); return { id: uid, email: 'synthetic-account@example.invalid' }; },
    async signIn(args) { calls.push({ name: 'signIn', args }); return { user: { id: UID }, access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token' }; },
    async updatePassword(uid, patch) { calls.push({ name: 'updatePassword', args: { uid, patch } }); return { id: uid }; },
    async revokeSession(jwt) { calls.push({ name: 'revokeSession', args: { jwt } }); },
  };
  const activeConfig = { ...config, ...cfg };
  const handler = createEmployeeAccessHandler({ config: activeConfig, services: () => ({ ...defaults, ...overrides }), sleep: async ms => waits.push(ms), now: () => 1000 });
  async function request(body = { action: 'sign-in', username: 'synthetic', password: PASSWORD }, { headers = {}, method = 'POST', raw } = {}) {
    return handler(new Request('https://synthetic.invalid/employee-access', {
      method, headers: { origin: 'https://synthetic.invalid', 'content-type': 'application/json', 'x-verified-test-ip': '203.0.113.8', ...headers },
      ...(['POST', 'PUT'].includes(method) ? { body: raw ?? JSON.stringify(body) } : {}),
    }));
  }
  return { request, calls, waits, handler, config: activeConfig };
}
async function generic(response, status) { assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: FAILURE }); }
const ownerHeaders = { authorization: 'Bearer synthetic-owner-token' };

test('normalizes ASCII aliases without accepting homographs, reserved names or emails', () => {
  assert.equal(normalizeUsername('  Jade  '), 'jade');
  for (const value of ['JADE@EXAMPLE.INVALID', 'ja', '1jade', 'jаde', 'a\nb', 'admin', 'Owner', 'x'.repeat(33), null, {}]) assert.equal(normalizeUsername(value), null);
});
test('owner targets use a canonical existing UID, not an employee-chosen name', () => {
  assert.equal(normalizeEmployeeId(UID.toUpperCase()), UID);
  for (const value of ['synthetic', ' ' + UID, UID + 'x', null, {}]) assert.equal(normalizeEmployeeId(value), null);
});
test('codes have80-bit generation and unambiguous normalized alphabet', () => {
  assert.equal(normalizeCode('abcd efgh-jklm npqr'), 'ABCDEFGHJKLMNPQR');
  for (const value of ['', 'OOOO-OOOO-OOOO-OOOO', 'ABCD-EFGH-JKLM-NPQR-extra', null]) assert.equal(normalizeCode(value), null);
  const generated = new Set(Array.from({ length: 200 }, generateCode)); assert.equal(generated.size, 200);
  for (const value of generated) assert.match(value, /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
});
test('password validation preserves whitespace, rejects unsafe byte limits and short setup values', () => {
  assert.equal(acceptablePassword('  private phrase  ', true), true);
  assert.equal(acceptablePassword('x'.repeat(72), true), true);
  for (const value of ['', 'short', 'x'.repeat(73), '😀'.repeat(19), null, {}]) assert.equal(acceptablePassword(value, true), false);
});
test('trusted IP requires a single canonical IP, not a client forwarding list', () => {
  assert.equal(canonicalIp('203.0.113.8'), '203.0.113.8');
  assert.equal(canonicalIp('2001:0db8:0000::1'), '2001:db8::1');
  for (const value of ['127.0.0.01', '256.1.1.1', '203.0.113.8, 10.0.0.1', 'unknown', '::1%eth0', '[::1]:80', null]) assert.equal(canonicalIp(value), null);
});
test('HMAC binds high-entropy invitation code independently of chosen username; only digest persists', async () => {
  const one = await digestSecret(config.hmacSecret, 'code', 'ABCDEFGHJKLMNPQR');
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.notEqual(one, await digestSecret(config.hmacSecret, 'code', 'ABCDEFGHJKLMNPQS'));
  assert.notEqual(one, await digestSecret(config.hmacSecret, 'throttle', 'ABCDEFGHJKLMNPQR'));
});
test('disabled/misconfigured server fails closed without any services', async () => {
  for (const cfg of [{ enabled: false }, { ipTrustVerified: false }, { hmacSecret: '' }, { hmacSecret: undefined }, { ipHeader: '' }]) {
    const f = fixture({ cfg }); await generic(await f.request(), 503); assert.equal(f.calls.length, 0);
  }
});
test('exact-origin CORS, no wildcard, body/credential caching disabled', async () => {
  const f = fixture(); await generic(await f.request(undefined, { headers: { origin: 'https://attacker.invalid' } }), 403);
  await generic(await f.request(undefined, { headers: { origin: 'null' } }), 403);
  assert.equal(f.calls.length, 0);
  const response = await f.request(undefined, { method: 'OPTIONS' });
  assert.equal(response.status, 204); assert.equal(response.headers.get('access-control-allow-origin'), 'https://synthetic.invalid');
  assert.match(response.headers.get('cache-control'), /no-store/); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});
test('method and missing/spoofable IP fail closed before any native Auth request', async () => {
  const f = fixture(); await generic(await f.request(undefined, { method: 'GET' }), 405);
  await generic(await f.request(undefined, { headers: { 'x-verified-test-ip': '' } }), 503);
  await generic(await f.request(undefined, { headers: { 'x-verified-test-ip': '1.2.3.4, 5.6.7.8' } }), 503);
  assert.equal(f.calls.length, 0);
});
test('strict bounded JSON rejects added role/UID/metadata and oversized or malformed payloads', async () => {
  for (const body of [{ action: 'sign-in', username: 'synthetic', password: PASSWORD, user_id: OTHER }, { action: 'owner-list', actor: OWNER }, [], null, { action: 'create-user' }]) {
    const f = fixture(); await generic(await f.request(body), 400); assert.ok(f.calls.every(c => c.name === 'employee_login_throttle'));
  }
  const f = fixture(); await generic(await f.request(undefined, { raw: '{' }), 400);
  await generic(await f.request(undefined, { raw: 'x'.repeat(4097) }), 400);
  await generic(await f.request(undefined, { headers: { 'content-type': 'text/plain' } }), 400);
});
test('global cap is checked before attacker-controlled bucket creation', async () => {
  const f = fixture({ rpcOverride: name => name === 'employee_login_throttle' ? false : undefined });
  await generic(await f.request(), 429); assert.deepEqual(f.calls.map(c => c.name), ['employee_login_throttle']);
  assert.equal(f.calls[0].args.p_limit, 1000); assert.match(f.calls[0].args.p_keys[0], /^[0-9a-f]{64}$/);
});
test('IP and normalized alias limits are independent durable RPC calls, never process-memory counters', async () => {
  const f = fixture(); const response = await f.request({ action: 'sign-in', username: ' SYNTHETIC ', password: PASSWORD });
  assert.equal(response.status, 200); const limits = f.calls.filter(c => c.name === 'employee_login_throttle');
  assert.deepEqual(limits.map(c => c.args.p_limit), [1000, 120, 10]);
  assert.ok(!JSON.stringify(limits).includes('203.0.113')); assert.ok(!JSON.stringify(limits).includes('synthetic'));
});
test('explicit shared pilot never reads IP config or caller IP headers', async () => {
  const f = fixture({ cfg: { rateLimitMode: 'shared-pilot', ipHeader: '', ipTrustVerified: false } });
  for (const name of ['ipHeader', 'ipTrustVerified']) Object.defineProperty(f.config, name, { get() { throw new Error('IP config read in shared mode'); } });
  const request = new Request('https://synthetic.invalid/employee-access', { method: 'POST', headers: { origin: 'https://synthetic.invalid', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'sign-in', username: 'synthetic', password: PASSWORD }) });
  const get = request.headers.get.bind(request.headers);
  request.headers.get = name => { assert.ok(['origin', 'content-type', 'content-length', 'authorization'].includes(name), 'No caller IP header read'); return get(name); };
  assert.equal((await f.handler(request)).status, 200);
  const limits = f.calls.filter(c => c.name === 'employee_login_throttle');
  assert.deepEqual(limits.map(c => [c.args.p_limit, c.args.p_window_seconds]), [[1000, 300], [120, 300], [10, 600]]);
  assert.deepEqual(limits[1].args.p_keys, [await digestSecret(config.hmacSecret, 'throttle:shared-pilot', 'all')]);
});
test('shared pilot counts every action plus preflight, invalid origin, method and body before dispatch', async () => {
  const f = fixture({ cfg: { rateLimitMode: 'shared-pilot', ipHeader: '', ipTrustVerified: false } });
  const cases = [
    [{ action: 'sign-in', username: 'synthetic', password: PASSWORD }, {}, 200, [1000, 120, 10]],
    [{ action: 'redeem', username: 'synthetic', code: CODE, password: PASSWORD }, {}, 200, [1000, 120, 5]],
    [{ action: 'owner-list' }, { headers: ownerHeaders }, 200, [1000, 120, 30]],
    [{ action: 'owner-issue', employeeId: UID }, { headers: ownerHeaders }, 200, [1000, 120, 30, 10]],
    [{ action: 'owner-disable', employeeId: UID }, { headers: ownerHeaders }, 200, [1000, 120, 30, 10]],
    [undefined, { method: 'OPTIONS' }, 204, [1000, 120]],
    [undefined, { method: 'GET' }, 405, [1000, 120]],
    [undefined, { headers: { origin: 'https://attacker.invalid' } }, 403, [1000, 120]],
    [undefined, { raw: '{' }, 400, [1000, 120]],
    [{ action: 'unknown' }, {}, 400, [1000, 120]],
    [{ action: 'owner-list' }, {}, 403, [1000, 120]],
  ];
  const sharedKey = await digestSecret(config.hmacSecret, 'throttle:shared-pilot', 'all');
  for (const [body, options, status, expected] of cases) {
    const start = f.calls.length;
    assert.equal((await f.request(body, options)).status, status);
    const calls = f.calls.slice(start).filter(c => c.name === 'employee_login_throttle');
    assert.deepEqual(calls.map(c => c.args.p_limit), expected);
    assert.deepEqual(calls[1].args, { p_keys: [sharedKey], p_limit: 120, p_window_seconds: 300 });
    assert.ok(calls.slice(2).every(c => c.args.p_window_seconds === 600));
  }
});
test('shared pilot uses one durable budget across requests and handler instances despite spoofed headers', async () => {
  // The shared RPC fixture models persistence outside either handler instance.
  const buckets = new Map();
  const rpcOverride = (name, args) => {
    if (name !== 'employee_login_throttle') return undefined;
    const key = args.p_keys[0]; const count = (buckets.get(key) || 0) + 1; buckets.set(key, count);
    return count <= args.p_limit;
  };
  const one = fixture({ cfg: { rateLimitMode: 'shared-pilot', ipTrustVerified: false }, rpcOverride });
  const two = fixture({ cfg: { rateLimitMode: 'shared-pilot', ipTrustVerified: false }, rpcOverride });
  const responses = await Promise.all(Array.from({ length: 125 }, (_, i) => (i % 2 ? one : two).request(undefined, { method: 'OPTIONS', headers: { 'x-verified-test-ip': `203.0.113.${i}`, 'x-forwarded-for': i % 2 ? 'malformed, spoofed' : '' } })));
  assert.equal(responses.filter(r => r.status === 204).length, 120);
  assert.equal(responses.filter(r => r.status === 429).length, 5);
  assert.equal(buckets.size, 2, 'Only global and shared keys, never spoofed-IP keys');
  await generic(await one.request({ action: 'owner-list' }, { headers: ownerHeaders }), 429);
  await generic(await two.request({ action: 'redeem', username: 'other-choice', code: CODE, password: PASSWORD }), 429);
  assert.ok([...one.calls, ...two.calls].every(c => c.name === 'employee_login_throttle'), 'Exhaustion blocks owner, Auth and alias operations');
});
test('shared pilot remains disabled/misconfiguration fail-closed and never silently replaces trusted-IP mode', async () => {
  for (const cfg of [{ rateLimitMode: 'shared-pilot', enabled: false }, { rateLimitMode: 'shared-pilot', hmacSecret: '' }, { rateLimitMode: 'shared' }, { rateLimitMode: '' }, { rateLimitMode: 'trusted-ip', ipTrustVerified: false }, { rateLimitMode: undefined, ipTrustVerified: false }]) {
    const f = fixture({ cfg }); await generic(await f.request(), 503); assert.equal(f.calls.length, 0);
  }
  const unavailable = fixture({ cfg: { rateLimitMode: 'shared-pilot' }, rpcOverride: () => { throw new Error('database unavailable'); } });
  await generic(await unavailable.request(), 503);
  assert.deepEqual(unavailable.calls.map(c => c.name), ['employee_login_throttle']);
});
test('shared pilot retains the independent global cap before any other bucket', async () => {
  const f = fixture({ cfg: { rateLimitMode: 'shared-pilot' }, rpcOverride: name => name === 'employee_login_throttle' ? false : undefined });
  await generic(await f.request(undefined, { method: 'OPTIONS' }), 429);
  assert.deepEqual(f.calls.map(c => c.name), ['employee_login_throttle']);
  assert.deepEqual(f.calls[0].args, { p_keys: [await digestSecret(config.hmacSecret, 'throttle:global', 'all')], p_limit: 1000, p_window_seconds: 300 });
});
test('username sign-in resolves existing UID internally and returns only native session tokens', async () => {
  const f = fixture(); const response = await f.request();
  assert.deepEqual(await response.json(), { session: { access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token' } });
  assert.deepEqual(f.calls.find(c => c.name === 'signIn').args, { email: 'synthetic-account@example.invalid', password: PASSWORD });
  assert.equal(f.calls.filter(c => c.name === 'employee_login_resolve').length, 2);
  assert.deepEqual(f.calls.find(c => c.name === 'employee_login_audit').args, { p_event: 'sign_in', p_outcome: 'succeeded', p_actor: UID, p_target: UID });
});
test('unknown alias and wrong password have identical generic responses and minimum failure pacing', async () => {
  const unknown = fixture({ rpcOverride: name => name === 'employee_login_resolve' ? null : undefined });
  const wrong = fixture({ overrides: { signIn: async () => null } });
  await generic(await unknown.request(), 401); await generic(await wrong.request(), 401);
  assert.deepEqual(unknown.waits, [700]); assert.deepEqual(wrong.waits, [700]);
  assert.equal(unknown.calls.some(c => c.name === 'getUserById'), false);
});
test('banned, deleted, anonymous and mismatched Auth identities cannot sign in', async () => {
  for (const user of [{ id: OTHER, email: 'synthetic@example.invalid' }, { id: UID, email: 'synthetic@example.invalid', is_anonymous: true }, { id: UID, email: 'synthetic@example.invalid', deleted_at: '2000-01-01' }, { id: UID, email: 'synthetic@example.invalid', banned_until: '2099-01-01' }, { id: UID }]) {
    const f = fixture({ overrides: { getUserById: async () => user } }); await generic(await f.request(), 401); assert.equal(f.calls.some(c => c.name === 'signIn'), false);
  }
});
test('alias disable/reissue during password request denies and revokes only newly minted session', async () => {
  let resolved = 0;
  const f = fixture({ rpcOverride: name => name === 'employee_login_resolve' && ++resolved === 2 ? null : undefined });
  await generic(await f.request(), 401); assert.deepEqual(f.calls.find(c => c.name === 'revokeSession').args, { jwt: 'synthetic-access-token' });
});
test('unexpected native UID is never accepted or returned', async () => {
  const f = fixture({ overrides: { signIn: async () => ({ user: { id: OTHER }, access_token: 'unexpected-token', refresh_token: 'unexpected-refresh' }) } });
  await generic(await f.request(), 401); assert.equal(f.calls.find(c => c.name === 'revokeSession').args.jwt, 'unexpected-token');
});
test('owner authentication cannot use a submitted UID, admin label or missing bearer', async () => {
  const f = fixture(); await generic(await f.request({ action: 'owner-list' }), 403);
  await generic(await f.request({ action: 'owner-list' }, { headers: { authorization: 'Bearer unverified' } }), 403);
  assert.equal(f.calls.some(c => c.name === 'employee_login_list'), false);
});
test('verified nonowner and anonymous owner-shaped identity cannot administer credentials', async () => {
  for (const user of [{ id: OTHER }, { id: OWNER, is_anonymous: true }]) {
    const f = fixture({ overrides: { getUser: async () => user } });
    await generic(await f.request({ action: 'owner-list' }, { headers: ownerHeaders }), 403);
  }
});
test('verified explicit owner sees mapped identities but no passwords, email or hashes', async () => {
  const f = fixture(); const response = await f.request({ action: 'owner-list' }, { headers: ownerHeaders });
  assert.deepEqual(await response.json(), { employees: [{ username: 'synthetic', user_id: UID, status: 'active', enabled: true }] });
  assert.ok(f.calls.findIndex(c => c.name === 'getUser') < f.calls.findIndex(c => c.name === 'employee_login_check_owner'));
});
test('owner issue returns a code once; SQL receives only HMAC and never chooses or receives a password', async () => {
  const f = fixture(); const response = await f.request({ action: 'owner-issue', employeeId: UID }, { headers: ownerHeaders });
  const result = await response.json(); assert.equal(response.status, 200); assert.ok(normalizeCode(result.code));
  const issue = f.calls.find(c => c.name === 'employee_login_issue'); assert.equal(issue.args.p_confirm_email, false);
  assert.match(issue.args.p_code_hash, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(issue).includes(result.code));
  assert.equal(f.calls.some(c => c.name === 'updatePassword'), false);
  assert.equal(issue.args.p_uid, UID); assert.equal(issue.args.p_username, undefined);
  assert.equal(result.employeeId, UID); assert.equal(result.username, null); assert.equal(result.setupCompleted, false);
});
test('owner cannot assign the activation username and an incorrect UID response never exposes a code', async () => {
  const f = fixture(); await generic(await f.request({ action: 'owner-issue', employeeId: UID, username: 'assigned' }, { headers: ownerHeaders }), 400);
  assert.equal(f.calls.some(c => c.name === 'employee_login_issue'), false);
  const wrong = fixture({ rpcOverride: name => name === 'employee_login_issue' ? { user_id: OTHER, expires_at: '2099-01-01T00:00:00Z' } : undefined });
  await generic(await wrong.request({ action: 'owner-issue', employeeId: UID }, { headers: ownerHeaders }), 400);
});
test('individual email confirmation is stored only when explicitly chosen by owner', async () => {
  const f = fixture(); await f.request({ action: 'owner-issue', employeeId: UID, confirmEmail: true }, { headers: ownerHeaders });
  assert.equal(f.calls.find(c => c.name === 'employee_login_issue').args.p_confirm_email, true);
  const bad = fixture(); await generic(await bad.request({ action: 'owner-issue', employeeId: UID, confirmEmail: 'true' }, { headers: ownerHeaders }), 400);
});
test('redemption atomically claims before native Auth call then finishes same UID/claim without login', async () => {
  const f = fixture(); const response = await f.request({ action: 'redeem', username: 'synthetic', code: CODE, password: PASSWORD });
  assert.deepEqual(await response.json(), { ok: true });
  const claim = f.calls.find(c => c.name === 'employee_login_claim'), finish = f.calls.find(c => c.name === 'employee_login_finish');
  assert.equal(finish.args.p_claim_id, claim.args.p_claim_id); assert.equal(finish.args.p_uid, UID);
  assert.deepEqual(f.calls.find(c => c.name === 'updatePassword').args, { uid: UID, patch: { password: PASSWORD } });
  assert.ok(f.calls.findIndex(c => c.name === 'employee_login_claim') < f.calls.findIndex(c => c.name === 'updatePassword'));
  assert.equal(f.calls.some(c => ['signIn', 'getUserById'].includes(c.name)), false);
});
test('activation code and durable budget identify one invitation regardless of chosen username', async () => {
  const f = fixture();
  for (const username of ['first-choice', 'second-choice']) await f.request({ action: 'redeem', username, code: CODE, password: PASSWORD });
  const claims = f.calls.filter(c => c.name === 'employee_login_claim');
  assert.deepEqual(claims.map(c => c.args.p_username), ['first-choice', 'second-choice']);
  assert.equal(claims[0].args.p_code_hash, claims[1].args.p_code_hash);
  assert.equal(claims[0].args.p_code_hash, await digestSecret(config.hmacSecret, 'code', normalizeCode(CODE)));
  const budgets = f.calls.filter(c => c.name === 'employee_login_throttle' && c.args.p_limit === 5);
  assert.deepEqual(budgets[0].args.p_keys, budgets[1].args.p_keys);
  assert.ok(!JSON.stringify(budgets).includes(normalizeCode(CODE)));
});
test('collision/invalid invitation stays generic and cannot reach Auth; employee cannot supply target UID', async () => {
  let claims = 0;
  const f = fixture({ rpcOverride: name => name === 'employee_login_claim' && ++claims === 1 ? null : undefined });
  await generic(await f.request({ action: 'redeem', username: 'already-taken', code: CODE, password: PASSWORD }), 401);
  assert.equal(f.calls.some(c => c.name === 'updatePassword'), false);
  assert.equal((await f.request({ action: 'redeem', username: 'my-chosen-name', code: CODE, password: PASSWORD })).status, 200);
  assert.equal(f.calls.filter(c => c.name === 'updatePassword').length, 1);
  const tampered = fixture();
  await generic(await tampered.request({ action: 'redeem', employeeId: OTHER, username: 'chosen', code: CODE, password: PASSWORD }), 400);
  assert.equal(tampered.calls.some(c => c.name === 'employee_login_claim'), false);
});
test('only claim-authorized email confirmation reaches native Auth, never client supplied metadata', async () => {
  const f = fixture({ rpcOverride: name => name === 'employee_login_claim' ? { user_id: UID, confirm_email: true } : undefined });
  await f.request({ action: 'redeem', username: 'synthetic', code: CODE, password: PASSWORD });
  assert.deepEqual(f.calls.find(c => c.name === 'updatePassword').args.patch, { password: PASSWORD, email_confirm: true });
  const bad = fixture(); await generic(await bad.request({ action: 'redeem', username: 'synthetic', code: CODE, password: PASSWORD, confirmEmail: true }), 400);
});
test('expired/replayed/wrong code cannot reach Auth and has generic credential denial', async () => {
  const f = fixture({ rpcOverride: name => name === 'employee_login_claim' ? null : undefined });
  await generic(await f.request({ action: 'redeem', username: 'synthetic', code: CODE, password: PASSWORD }), 401);
  assert.equal(f.calls.some(c => c.name === 'updatePassword'), false);
});
test('Auth uncertainty consumes code, records blocked failure, never automatically retries', async () => {
  let attempts = 0;
  const f = fixture({ overrides: { updatePassword: async () => { attempts++; throw new Error('secret-upstream-error'); } } });
  await generic(await f.request({ action: 'redeem', username: 'synthetic', code: CODE, password: PASSWORD }), 503);
  assert.equal(attempts, 1); assert.equal(f.calls.find(c => c.name === 'employee_login_finish').args.p_success, false);
});
test('definite native weak-password rejection consumes code but permits owner to issue a new one', async () => {
  let attempts = 0;
  const f = fixture({ overrides: { updatePassword: async () => { attempts++; throw new PasswordRejected(); } } });
  await generic(await f.request({ action: 'redeem', username: 'synthetic', code: CODE, password: PASSWORD }), 400);
  assert.equal(attempts, 1);
  assert.equal(f.calls.some(c => c.name === 'employee_login_finish'), false);
  const reset = f.calls.find(c => c.name === 'employee_login_password_rejected');
  assert.equal(reset.args.p_uid, UID);
  assert.equal(reset.args.p_claim_id, f.calls.find(c => c.name === 'employee_login_claim').args.p_claim_id);
});
test('finish uncertainty remains blocked and never repeats native password write', async () => {
  const f = fixture({ rpcOverride: name => { if (name === 'employee_login_finish') throw new Error('database unavailable'); } });
  await generic(await f.request({ action: 'redeem', username: 'synthetic', code: CODE, password: PASSWORD }), 503);
  assert.equal(f.calls.filter(c => c.name === 'updatePassword').length, 1);
  assert.deepEqual(f.calls.filter(c => c.name === 'employee_login_finish').map(c => c.args.p_success), [true, false]);
});
test('audit failure never returns a newly minted session and tries to revoke it', async () => {
  const f = fixture({ rpcOverride: name => { if (name === 'employee_login_audit') throw new Error('audit unavailable'); } });
  await generic(await f.request(), 503); assert.equal(f.calls.filter(c => c.name === 'revokeSession').length, 1);
});
test('disable endpoint is owner-only alias state change, not permission or Auth mutation', async () => {
  const f = fixture(); assert.deepEqual(await (await f.request({ action: 'owner-disable', employeeId: UID }, { headers: ownerHeaders })).json(), { ok: true });
  assert.equal(f.calls.some(c => ['updatePassword', 'signIn', 'getUserById'].includes(c.name)), false);
});
test('new auth runtime is pinned, isolated, no credential logs and no unrelated provider imports', async () => {
  const runtime = await readFile(new URL('../supabase/functions/employee-access/index.ts', import.meta.url), 'utf8');
  const handler = await readFile(new URL('../supabase/functions/employee-access/handler.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /@supabase\/supabase-js@2\.57\.4/);
  assert.doesNotMatch(runtime + handler, /console\.(?:log|error|warn|debug)|JSON\.stringify\((?:body|patch|credentials)\)|operations-agent\/|inventory-reorder-notify\//);
  assert.match(runtime, /persistSession: false/); assert.match(runtime, /autoRefreshToken: false/);
  assert.doesNotMatch(runtime + handler, /\.from\(['"]users|createUser\(|inviteUserByEmail\(|user_metadata\s*:/);
});
