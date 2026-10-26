// CI-only, disposable native Supabase. No hosted project, credentials or data accepted.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { createEmployeeAccessHandler, PasswordRejected } from '../../supabase/functions/employee-access/handler.mjs';
import { bootstrapNativeDatabase } from './employee-native-auth-bootstrap.mjs';
import { runNativeSdkBrowser } from './employee-native-auth-browser.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUN_EMPLOYEE_NATIVE_AUTH_TEST !== '1') {
  throw new Error('This disposable native runner requires the explicitly authorized GitHub test job.');
}
const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, 'artifacts/employee-native-auth');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'superior-native-auth-'));
await fs.chmod(temp, 0o700);
const configDir = path.join(temp, 'supabase');
const cliPath = path.join(temp, 'bin/supabase');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SUPABASE_|GOTRUE_|PG|DATABASE_URL|EMPLOYEE_ACCESS_)/.test(key)));
Object.assign(env, { SUPABASE_HOME: path.join(temp, 'state'), SUPABASE_EXPERIMENTAL_STACK: '1', SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' });
const result = { scope: 'isolated native Supabase on ephemeral GitHub runner', cli: '2.122.0', nativeAuth: '2.197.0', cases: [], cleanup: false, limitations: ['Not the hosted production Auth version/settings', 'Handler uses real Auth/PostgREST adapters in-process, not the hosted Edge gateway', 'Browser covers native SDK cross-tab storage, not full Hub multi-tab lifecycle', 'Hosted ingress and live role/ACL parity still require verification'] };
let stage = 'prepare', started = false, client, exitCode = 0;
const report = label => { result.cases.push(label); console.log(`PASS: ${label}`); };
class TestFailure extends Error {}
const requireThat = (condition, label) => { if (!condition) throw new TestFailure(label); };
const authDenied = (response, codes, label) => requireThat(response.error && response.error.status === (codes.includes('signup_disabled') ? 422 : 400) && codes.includes(response.error.code), label);
const password = () => `Aa9!${randomBytes(22).toString('base64url')}`;
const command = (args, timeout = 240_000) => exec(cliPath, args, { cwd: temp, env, timeout, maxBuffer: 12 * 1024 * 1024 });
const loopback = value => { const u = new URL(value); requireThat(['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname), 'Non-loopback target rejected'); return u; };
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (url, init) => { loopback(typeof url === 'string' ? url : url.url ?? url.href); return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12_000) }); } } };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await fs.mkdir(path.join(temp, 'bin'));
  await fs.mkdir(configDir);
  for (const file of ['config.toml', 'supabase.lock']) await fs.copyFile(path.join(root, 'tests/integration/native-auth', file), path.join(configDir, file));
  const archiveUrl = 'https://github.com/supabase/cli/releases/download/v2.122.0/supabase_2.122.0_linux_amd64.tar.gz';
  const download = await fetch(archiveUrl, { signal: AbortSignal.timeout(120_000) });
  requireThat(download.ok, 'Official CLI download failed');
  const archive = Buffer.from(await download.arrayBuffer());
  const digest = createHash('sha256').update(archive).digest('hex');
  requireThat(digest === '59ed066847b98d7461c60e9109d40cab6b9756177ce06ebb05b51338519f5136', 'Official CLI checksum mismatch');
  await fs.writeFile(path.join(temp, 'cli.tar.gz'), archive, { mode: 0o600 });
  await exec('tar', ['-xzf', path.join(temp, 'cli.tar.gz'), '-C', path.join(temp, 'bin'), 'supabase', 'supabase-go']);
  requireThat((await command(['--version'])).stdout.trim() === '2.122.0', 'Unexpected CLI version');
  report('Official pinned CLI archive checksum verified');

  stage = 'native stack start';
  // Capture stdout privately in memory: CLI start/status include ephemeral local keys.
  // A checked-in lock pins service archive/manifest checksums; no platform login/link occurs.
  const start = await command(['stack', 'start', '--runtime', 'native', '--frozen', '--preparation', 'on-demand', '--exclude', 'realtime,storage,functions,studio,mail,analytics,pooler', '--eager', '--output-format', 'json'], 360_000);
  started = true;
  const state = JSON.parse(start.stdout);
  const vars = state.env ?? state.result?.env;
  requireThat(vars?.API_URL && vars?.DB_URL && vars?.SERVICE_ROLE_KEY && vars?.ANON_KEY, 'Native stack connection response unavailable');
  const api = loopback(vars.API_URL).origin;
  const dbUrl = loopback(vars.DB_URL);
  requireThat(dbUrl.protocol === 'postgresql:' || dbUrl.protocol === 'postgres:', 'Unexpected local DB protocol');
  requireThat(state.runtime === 'native' || state.result?.runtime === 'native', 'Native runtime not confirmed');
  for (const endpoint of Object.values(state.endpoints ?? {})) if (endpoint.url) loopback(endpoint.url);
  report('Native Auth/PostgREST/Postgres started on loopback without a hosted project');
  const health = await fetch(`${api}/auth/v1/health`, { headers: { apikey: vars.ANON_KEY }, redirect: 'error', signal: AbortSignal.timeout(12_000) }).then(r => r.json());
  requireThat(String(health.version).includes('2.197.0'), 'Unexpected native Auth server version');
  const admin = createClient(api, vars.SERVICE_ROLE_KEY, options);
  const fresh = token => createClient(api, vars.ANON_KEY, token ? { ...options, global: { ...options.global, headers: { Authorization: `Bearer ${token}` } } } : options);
  const nativeSignIn = async (email, secret) => fresh().auth.signInWithPassword({ email, password: secret });
  const ownerEmail = 'owner-native-test@example.invalid', employeeEmail = 'employee-native-test@example.invalid';
  const ownerPassword = password(), initialPassword = password(), setupPassword = password(), resetPassword = password();
  client = new pg.Client({ connectionString: vars.DB_URL }); await client.connect();
  requireThat((await client.query('select count(*)::int as count from auth.users')).rows[0].count === 0, 'Native database is not empty');
  const ownerCreated = await admin.auth.admin.createUser({ email: ownerEmail, password: ownerPassword, email_confirm: true });
  const employeeCreated = await admin.auth.admin.createUser({ email: employeeEmail, password: initialPassword, email_confirm: false });
  requireThat(!ownerCreated.error && !employeeCreated.error, 'Synthetic native Admin user creation failed');
  const ownerUid = ownerCreated.data.user.id, employeeUid = employeeCreated.data.user.id, username = 'sample-native-employee';
  requireThat(!employeeCreated.data.user.email_confirmed_at, 'Synthetic employee unexpectedly confirmed');
  report('Two invented identities created through native Admin API, employee initially unconfirmed');

  stage = 'native application bootstrap';
  const bootstrap = await bootstrapNativeDatabase(client, { ownerUid, employeeUid, username });
  result.bootstrap = bootstrap;
  report('Exact application migrations applied while preserving native Auth schema and role defaults');
  const unmapped = (await client.query('select username,setup_completed from employee_login.aliases where user_id=$1', [employeeUid])).rows[0];
  requireThat(unmapped.username === null && unmapped.setup_completed === false, 'Owner must not preassign activation username');
  const reserved = await admin.auth.admin.createUser({ email: 'reserved-native-test@example.invalid', password: password(), email_confirm: true });
  requireThat(!reserved.error, 'Synthetic reserved-name identity creation failed');
  // Inactive historical alias retains its name without adding a business grant.
  await client.query("insert into employee_login.aliases(user_id,username,enabled,state,setup_completed) values($1,'already-taken',false,'setup_required',true)", [reserved.data.user.id]);
  // NOTIFY schema reload is asynchronous; a bounded readiness check, not credential retry.
  for (let i = 0; i < 30; i++) {
    const probe = await admin.rpc('employee_login_check_owner', { p_actor: ownerUid });
    if (!probe.error && probe.data === true) break;
    if (i === 29) throw new Error(`PostgREST readiness failed (${probe.error?.code ?? 'unexpected'})`);
    await wait(250);
  }
  const beforeGrant = JSON.stringify((await client.query('select * from public.app_employee_access where user_id=$1', [employeeUid])).rows);
  let updateCalls = 0;
  const services = () => {
    const a = createClient(api, vars.SERVICE_ROLE_KEY, options), auth = fresh();
    return {
      async rpc(name, args) { const r = await a.rpc(name, args); if (r.error) throw new Error(`Native RPC ${name} (${r.error.code})`); return r.data; },
      async getUser(token) { const r = await a.auth.getUser(token); return r.error ? null : r.data.user; },
      async getUserById(uid) { const r = await a.auth.admin.getUserById(uid); return r.error ? null : r.data.user; },
      async signIn(credentials) { const r = await auth.auth.signInWithPassword(credentials); return r.error ? null : r.data.session; },
      async updatePassword(uid, patch) { updateCalls++; const r = await a.auth.admin.updateUserById(uid, patch); if (r.error?.code === 'weak_password' && r.error.status === 422) throw new PasswordRejected(); if (r.error) throw new Error('Native Auth update failed'); return r.data.user; },
      async revokeSession(jwt) { const r = await a.auth.admin.signOut(jwt, 'local'); if (r.error) throw new Error('Native signout failed'); },
    };
  };
  const handler = createEmployeeAccessHandler({ config: { enabled: true, hmacSecret: randomBytes(32).toString('hex'), origins: ['https://native-test.invalid'], ipHeader: 'x-test-loopback-ip', ipTrustVerified: true }, services });
  const call = async (body, token) => {
    const r = await handler(new Request('https://native-test.invalid/employee-access', { method: 'POST', headers: { origin: 'https://native-test.invalid', 'content-type': 'application/json', 'x-test-loopback-ip': '127.0.0.1', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
    return { status: r.status, data: await r.json() };
  };
  const ownerCall = async body => {
    const r = await nativeSignIn(ownerEmail, ownerPassword);
    requireThat(!r.error && r.data.session, 'Native owner sign-in failed');
    return call(body, r.data.session.access_token);
  };
  const issue = async confirmEmail => { const r = await ownerCall({ action: 'owner-issue', employeeId: employeeUid, confirmEmail }); requireThat(r.status === 200 && r.data.code && r.data.employeeId === employeeUid, 'Owner issue failed'); return r.data.code; };
  const redeem = (code, secret, desiredUsername = username) => call({ action: 'redeem', username: desiredUsername, code, password: secret });
  const aliasSignIn = secret => call({ action: 'sign-in', username, password: secret });
  const signed = async secret => { const r = await nativeSignIn(employeeEmail, secret); requireThat(!r.error && r.data.session, 'Native employee sign-in failed'); return r.data.session; };
  const access = async token => { const r = await fresh(token).rpc('get_app_access'); requireThat(!r.error, 'Native employee access RPC failed'); return r.data; };

  stage = 'native setup and password rejection';
  authDenied(await fresh().auth.signUp({ email: 'blocked-public-signup@example.invalid', password: password() }), ['signup_disabled'], 'Expected native signup_disabled rejection');
  authDenied(await nativeSignIn(employeeEmail, initialPassword), ['email_not_confirmed'], 'Expected native email_not_confirmed rejection');
  requireThat((await call({ action: 'owner-list' })).status === 403, 'Unauthenticated owner directory accepted');
  requireThat((await fresh().rpc('employee_login_resolve', { p_username: username })).error?.code === '42501', 'Anonymous resolver must fail with insufficient privilege');
  report('Native confirmation required, public signup disabled, anonymous owner/resolver denied');
  const rejectedCode = await issue(true);
  requireThat((await redeem(rejectedCode, setupPassword, '  ALREADY-TAKEN  ')).status === 401 && updateCalls === 0, 'Username collision reached Auth or exposed special response');
  const stillPending = (await client.query('select state,username,code_hash is not null as code_retained from employee_login.aliases where user_id=$1', [employeeUid])).rows[0];
  requireThat(stillPending.state === 'pending' && stillPending.username === null && stillPending.code_retained, 'Collision consumed or rebound activation');
  report('Case-insensitive username collision preserves invitation for another choice and never calls Auth');
  const weak = await redeem(rejectedCode, 'Aa9!shorttest', 'provisional-choice');
  requireThat(weak.status === 400 && updateCalls === 1, 'Native weak-password rejection was not recoverable');
  const rejectedUser = await admin.auth.admin.getUserById(employeeUid);
  requireThat(!rejectedUser.data.user.email_confirmed_at, 'Rejected password confirmed identity');
  requireThat((await client.query('select state from employee_login.aliases where user_id=$1', [employeeUid])).rows[0].state === 'setup_required', 'Rejected password did not release new-code issuance');
  report('Actual Auth422 weak password consumes code without changing or confirming identity; owner can reissue unfinished activation');
  const setupCode = await issue(true);
  const setup = await redeem(setupCode, setupPassword);
  requireThat(setup.status === 200 && setup.data.ok === true && !setup.data.session && updateCalls === 2, 'Native setup did not finish without a session');
  const configuredUser = (await admin.auth.admin.getUserById(employeeUid)).data.user;
  requireThat(configuredUser.id === employeeUid && configuredUser.email === employeeEmail && configuredUser.email_confirmed_at, 'Setup changed identity or did not confirm individual employee');
  const activated = (await client.query('select username,setup_completed from employee_login.aliases where user_id=$1', [employeeUid])).rows[0];
  requireThat(activated.username === username && activated.setup_completed === true, 'Employee username choice did not commit with activation');
  const replay = await redeem(setupCode, password());
  requireThat(replay.status === 401 && updateCalls === 2, 'Setup code replay reached Auth');
  authDenied(await nativeSignIn(employeeEmail, initialPassword), ['invalid_credentials'], 'Expected initial password invalid_credentials after setup');
  report('Employee chooses both username and password for owner-authorized existing UID; setup creates no session, replay and old password denied');

  stage = 'native username login and scope';
  const login = await aliasSignIn(setupPassword);
  requireThat(login.status === 200 && login.data.session, 'Username did not return actual native session');
  const session = login.data.session;
  const actualUser = await fresh().auth.getUser(session.access_token);
  requireThat(!actualUser.error && actualUser.data.user.id === employeeUid, 'Alias session does not belong to existing native UID');
  const scope = await access(session.access_token);
  requireThat(scope.authorized && scope.can_write === false && scope.is_admin === false && JSON.stringify(scope.allowed_views) === JSON.stringify(['overview', 'walls', 'inventory', 'weekly-planner']), 'Native JWT has incorrect employee scope');
  requireThat((await fresh(session.access_token).rpc('get_employee_login_access')).data?.enabled === true, 'Caller-bound managed identity did not verify');
  requireThat((await call({ action: 'owner-list' }, session.access_token)).status === 403, 'Employee obtained owner directory');
  requireThat((await fresh(session.access_token).rpc('employee_login_resolve', { p_username: username })).error?.code === '42501', 'Employee resolver must fail with insufficient privilege');
  const snapshot = await fresh(session.access_token).rpc('get_walls_production_snapshot');
  requireThat(!snapshot.error, 'Native restricted production projection denied');
  report('Username uses actual native session for same UID; real PostgREST enforces restricted scope and private service ACLs');

  stage = 'native password reset and sessions';
  const preReset = await signed(setupPassword);
  const resetCode = await issue(false);
  requireThat((await aliasSignIn(setupPassword)).status === 401, 'Pending reset did not pause alias');
  requireThat((await redeem(resetCode, resetPassword, 'attempted-rename')).status === 401 && updateCalls === 2, 'Reset invitation renamed an activated identity or reached Auth');
  const reset = await redeem(resetCode, resetPassword);
  requireThat(reset.status === 200 && updateCalls === 3, 'Native reset failed');
  authDenied(await nativeSignIn(employeeEmail, setupPassword), ['invalid_credentials'], 'Expected old password invalid_credentials after reset');
  authDenied(await fresh().auth.refreshSession({ refresh_token: preReset.refresh_token }), ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'], 'Expected revoked native refresh session rejection');
  requireThat((await access(preReset.access_token)).authorized, 'Expected old unexpired JWT caveat was not observed');
  requireThat((await aliasSignIn(resetPassword)).status === 200, 'New password failed after reset');
  const afterGrant = JSON.stringify((await client.query('select * from public.app_employee_access where user_id=$1', [employeeUid])).rows);
  requireThat(beforeGrant === afterGrant, 'Credential lifecycle changed business grants');
  report('Actual reset rejects old password/refresh session and preserves UID/grants; old unexpired JWT still reaches permitted backend');
  const claims = JSON.parse(Buffer.from(preReset.access_token.split('.')[1], 'base64url').toString());
  // Pinned PostgREST 16.5 permits 30 seconds of clock skew for exp/iat/nbf.
  // https://github.com/PostgREST/postgrest/blob/v16.5/docs/references/auth.rst
  // Wait beyond that documented tolerance, not merely beyond the JWT exp claim.
  const remaining = claims.exp * 1000 - Date.now() + 35_000;
  requireThat(remaining < 100_000, 'Unexpected JWT lifetime; refusing long test wait');
  if (remaining > 0) await wait(remaining);
  const expired = await fresh(preReset.access_token).rpc('get_app_access');
  requireThat(expired.status === 401 && expired.error?.code === 'PGRST303', 'Expected expired native JWT PGRST303/401 rejection');
  report('Old access JWT denied after expiry plus documented PostgREST clock-skew tolerance');

  stage = 'actual browser native SDK cross-tab';
  result.browser = await runNativeSdkBrowser({ apiUrl: api, publishableKey: vars.ANON_KEY, email: employeeEmail, password: resetPassword, report });

  stage = 'native alias disable versus offboarding';
  const beforeDisable = await signed(resetPassword);
  requireThat((await ownerCall({ action: 'owner-disable', employeeId: employeeUid })).status === 200, 'Owner alias disable failed');
  requireThat((await aliasSignIn(resetPassword)).status === 401, 'Disabled alias signed in');
  await signed(resetPassword);
  requireThat((await access(beforeDisable.access_token)).authorized, 'Alias-only disable unexpectedly changed business scope');
  await client.query('update public.app_employee_access set enabled=false where user_id=$1', [employeeUid]);
  requireThat((await access(beforeDisable.access_token)).authorized === false, 'Explicit synthetic grant removal did not block retained JWT');
  report('Alias disable is not offboarding: native login/retained scope persist; explicit synthetic grant removal blocks backend');
  requireThat((await client.query('select count(*)::int as count from auth.users')).rows[0].count === 3, 'Unexpected extra Auth identity');
  result.passed = true;
} catch (error) {
  exitCode = 1;
  result.passed = false;
  // Never serialize native response/session/error objects, request bodies or CLI stdout.
  result.failure = { stage, message: error instanceof TestFailure ? error.message : 'Native test operation failed; provider/parser/process diagnostics suppressed', code: typeof error?.code === 'number' || (typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code)) ? error.code : undefined };
  console.error(`FAIL: ${stage}: ${result.failure.message}`);
} finally {
  if (client) await client.end().catch(() => {});
  try {
    // Also inspect/clean a partially created stack after a failed start.
    const exists = await fs.stat(cliPath).then(() => true, () => false);
    if (exists) {
      const listed = JSON.parse((await command(['stack', 'list', '--output-format', 'json'], 30_000)).stdout);
      const items = Array.isArray(listed) ? listed : listed.stacks ?? listed.result?.stacks ?? [];
      if (started || items.length) await command(['stack', 'destroy', '--yes', '--output-format', 'json'], 90_000);
      result.cleanup = true;
    } else result.cleanup = true;
  } catch { result.cleanup = false; exitCode = 1; console.error('FAIL: isolated stack cleanup failed'); }
  if (result.cleanup) await fs.rm(temp, { recursive: true, force: true });
  // A failed cleanup leaves only the disposable ephemeral runner, never a hosted resource.
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`Native Auth cases: ${result.cases.length}; passed=${result.passed === true}; cleanup=${result.cleanup}`);
  process.exitCode = exitCode;
}
