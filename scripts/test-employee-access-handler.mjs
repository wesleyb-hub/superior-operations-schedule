import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEmployeeAccessHandler, normalizeUsername, normalizeCode, acceptablePassword, canonicalIp, digestSecret, generateCode, FAILURE, PasswordRejected } from '../supabase/functions/employee-access/handler.mjs';

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
        case 'employee_login_issue': return { username: args.p_username, expires_at: '2099-01-01T00:00:00Z' };
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
  const handler = createEmployeeAccessHandler({ config: { ...config, ...cfg }, services: () => ({ ...defaults, ...overrides }), sleep: async ms => waits.push(ms), now: () => 1000 });
  async function request(body = { action: 'sign-in', username: 'synthetic', password: PASSWORD }, { headers = {}, method = 'POST', raw } = {}) {
    return handler(new Request('https://synthetic.invalid/employee-access', {
      method, headers: { origin: 'https://synthetic.invalid', 'content-type': 'application/json', 'x-verified-test-ip': '203.0.113.8', ...headers },
      ...(['POST', 'PUT'].includes(method) ? { body: raw ?? JSON.stringify(body) } : {}),
    }));
  }
  return { request, calls, waits };
}
async function generic(response, status) { assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: FAILURE }); }
const ownerHeaders = { authorization: 'Bearer synthetic-owner-token' };

test('normalizes ASCII aliases without accepting homographs, reserved names or emails', () => {
  assert.equal(normalizeUsername('  Jade  '), 'jade');
  for (const value of ['JADE@EXAMPLE.INVALID', 'ja', '1jade', 'jаde', 'a\nb', 'admin', 'Owner', 'x'.repeat(33), null, {}]) assert.equal(normalizeUsername(value), null);
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
test('HMAC binds secrets to purpose, alias and high-entropy code; only digest persists', async () => {
  const one = await digestSecret(config.hmacSecret, 'code', 'synthetic\0ABCDEFGHJKLMNPQR');
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.notEqual(one, await digestSecret(config.hmacSecret, 'code', 'other\0ABCDEFGHJKLMNPQR'));
  assert.notEqual(one, await digestSecret(config.hmacSecret, 'throttle', 'synthetic\0ABCDEFGHJKLMNPQR'));
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
  const f = fixture(); const response = await f.request({ action: 'owner-issue', username: 'synthetic' }, { headers: ownerHeaders });
  const result = await response.json(); assert.equal(response.status, 200); assert.ok(normalizeCode(result.code));
  const issue = f.calls.find(c => c.name === 'employee_login_issue'); assert.equal(issue.args.p_confirm_email, false);
  assert.match(issue.args.p_code_hash, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(issue).includes(result.code));
  assert.equal(f.calls.some(c => c.name === 'updatePassword'), false);
});
test('individual email confirmation is stored only when explicitly chosen by owner', async () => {
  const f = fixture(); await f.request({ action: 'owner-issue', username: 'synthetic', confirmEmail: true }, { headers: ownerHeaders });
  assert.equal(f.calls.find(c => c.name === 'employee_login_issue').args.p_confirm_email, true);
  const bad = fixture(); await generic(await bad.request({ action: 'owner-issue', username: 'synthetic', confirmEmail: 'true' }, { headers: ownerHeaders }), 400);
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
  const f = fixture(); assert.deepEqual(await (await f.request({ action: 'owner-disable', username: 'synthetic' }, { headers: ownerHeaders })).json(), { ok: true });
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
