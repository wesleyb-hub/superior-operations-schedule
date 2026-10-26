// Authorized disposable CI only. No hosted endpoints, real identities or credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { bootstrapNativeDatabase } from './employee-native-recovery-bootstrap.mjs';
import { runNativeRecoveryHubBrowser, NativeRecoveryHubFailure } from './employee-native-recovery-hub-browser.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUN_EMPLOYEE_NATIVE_RECOVERY_TEST !== '1') {
  throw new Error('Requires the explicitly authorized isolated GitHub test job.');
}
const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, 'artifacts/employee-native-recovery');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'superior-native-recovery-'));
await fs.chmod(temp, 0o700);
const configDir = path.join(temp, 'supabase'), cliPath = path.join(temp, 'bin/supabase');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SUPABASE_|GOTRUE_|PG|DATABASE_URL|EMPLOYEE_ACCESS_)/.test(key)));
Object.assign(env, { SUPABASE_HOME: path.join(temp, 'state'), SUPABASE_EXPERIMENTAL_STACK: '1', SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' });
const result = { scope: 'isolated loopback native Auth on ephemeral GitHub runner', cli: '2.122.0', nativeAuth: '2.197.0', cases: [], passed: false, cleanup: false, limitations: ['Not the hosted production Auth version', 'No real account or link, email sender, personal mailbox, or delivery test', 'Opaque hosted secret-key gateway translation is not exercised by legacy local service-role key'] };
let stage = 'prepare', started = false, db, exitCode = 0;
class TestFailure extends Error {}
const requireThat = (condition, label) => { if (!condition) throw new TestFailure(label); };
const report = label => { result.cases.push(label); console.log(`PASS: ${label}`); };
const password = () => `Aa9!${randomBytes(24).toString('base64url')}`;
const command = (args, timeout = 240000) => exec(cliPath, args, { cwd: temp, env, timeout, maxBuffer: 12 * 1024 * 1024 });
const loopback = value => { const u = new URL(value); requireThat(['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname), 'Non-loopback target rejected'); return u; };
const localFetch = (url, init) => { loopback(typeof url === 'string' ? url : url.url ?? url.href); return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000) }); };
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: localFetch } };
try {
  await fs.mkdir(path.join(temp, 'bin')); await fs.mkdir(configDir);
  for (const file of ['config.toml', 'supabase.lock']) await fs.copyFile(path.join(root, 'tests/integration/native-recovery', file), path.join(configDir, file));
  const archiveUrl = 'https://github.com/supabase/cli/releases/download/v2.122.0/supabase_2.122.0_linux_amd64.tar.gz';
  const download = await fetch(archiveUrl, { signal: AbortSignal.timeout(120000) });
  requireThat(download.ok, 'Official CLI download failed');
  const archive = Buffer.from(await download.arrayBuffer());
  requireThat(createHash('sha256').update(archive).digest('hex') === '59ed066847b98d7461c60e9109d40cab6b9756177ce06ebb05b51338519f5136', 'CLI checksum mismatch');
  await fs.writeFile(path.join(temp, 'cli.tar.gz'), archive, { mode: 0o600 });
  await exec('tar', ['-xzf', path.join(temp, 'cli.tar.gz'), '-C', path.join(temp, 'bin'), 'supabase', 'supabase-go']);
  requireThat((await command(['--version'])).stdout.trim() === '2.122.0', 'Unexpected CLI version');
  stage = 'native stack start';
  const start = await command(['stack', 'start', '--runtime', 'native', '--frozen', '--preparation', 'on-demand', '--exclude', 'realtime,storage,functions,studio,mail,analytics,pooler', '--eager', '--output-format', 'json'], 360000);
  started = true;
  const state = JSON.parse(start.stdout), vars = state.env ?? state.result?.env;
  requireThat(vars?.API_URL && vars?.DB_URL && vars?.SERVICE_ROLE_KEY && vars?.ANON_KEY, 'Missing local runtime connection details');
  const api = loopback(vars.API_URL).origin, dbUrl = loopback(vars.DB_URL);
  requireThat(['postgresql:', 'postgres:'].includes(dbUrl.protocol), 'Unexpected local DB protocol');
  requireThat(state.runtime === 'native' || state.result?.runtime === 'native', 'Native runtime not confirmed');
  for (const endpoint of Object.values(state.endpoints ?? {})) if (endpoint.url) loopback(endpoint.url);
  const health = await localFetch(`${api}/auth/v1/health`, { headers: { apikey: vars.ANON_KEY } }).then(r => r.json());
  requireThat(String(health.version).includes('2.197.0'), 'Unexpected native Auth version');
  report('Pinned native Auth/Postgres started only on loopback; no hosted configuration');
  const admin = createClient(api, vars.SERVICE_ROLE_KEY, options);
  const fresh = () => createClient(api, vars.ANON_KEY, options);
  const ownerEmail = 'owner-recovery-test@example.invalid', employeeEmail = 'employee-recovery-test@example.invalid';
  const ownerPassword = password(), initialPassword = password(), setupPassword = password();
  db = new pg.Client({ connectionString: vars.DB_URL });
  const effectiveDb = db.connectionParameters;
  requireThat(['127.0.0.1', 'localhost', '::1'].includes(effectiveDb.host) && effectiveDb.database === 'postgres' && dbUrl.port && Number(effectiveDb.port) === Number(dbUrl.port) && Number(effectiveDb.port) > 0 && !dbUrl.search && !dbUrl.hash, 'Effective native database connection is not the expected loopback target');
  await db.connect();
  requireThat((await db.query('select count(*)::int as count from auth.users')).rows[0].count === 0, 'Requires an empty native database');
  const ownerCreated = await admin.auth.admin.createUser({ email: ownerEmail, password: ownerPassword, email_confirm: true });
  const employeeCreated = await admin.auth.admin.createUser({ email: employeeEmail, password: initialPassword, email_confirm: false });
  requireThat(!ownerCreated.error && !employeeCreated.error, 'Synthetic native user creation failed');
  const ownerUid = ownerCreated.data.user.id, employeeUid = employeeCreated.data.user.id;
  requireThat(!employeeCreated.data.user.email_confirmed_at, 'Employee must start unconfirmed');
  result.bootstrap = await bootstrapNativeDatabase(db, { ownerUid, employeeUid });
  const beforeGrant = JSON.stringify((await db.query('select * from public.app_employee_access where user_id=$1', [employeeUid])).rows);
  const ownerGrantBefore = JSON.stringify((await db.query('select * from public.app_user_roles where user_id=$1', [ownerUid])).rows);
  const initialDenied = await fresh().auth.signInWithPassword({ email: employeeEmail, password: initialPassword });
  requireThat(initialDenied.error?.code === 'email_not_confirmed', 'Unconfirmed email sign-in must fail');

  stage = 'native recovery generation wire contract';
  const adminHeaders = { apikey: vars.SERVICE_ROLE_KEY, authorization: `Bearer ${vars.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' };
  const getRawUser = async uid => {
    const r = await localFetch(`${api}/auth/v1/admin/users/${uid}`, { headers: adminHeaders });
    requireThat(r.status === 200, 'Raw native Admin GET failed'); return r.json();
  };
  const before = await getRawUser(employeeUid);
  requireThat(before.id === employeeUid && before.email === employeeEmail && before.is_anonymous === false && before.is_sso_user === false && !before.email_confirmed_at && !before.recovery_sent_at, 'Private helper preflight shape not supported');
  requireThat(before.identities?.length === 1 && before.identities[0].provider === 'email' && before.identities[0].user_id === employeeUid && before.identities[0].identity_data.email === employeeEmail, 'Native email identity shape differs from helper contract');
  const rawGenerated = await localFetch(`${api}/auth/v1/admin/generate_link`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ type: 'recovery', email: employeeEmail, redirect_to: 'http://127.0.0.1:3000/' }) });
  requireThat(rawGenerated.status === 200, 'Native recovery link generation failed');
  const generated = await rawGenerated.json();
  requireThat(generated.id === employeeUid && generated.email === employeeEmail && generated.verification_type === 'recovery' && generated.redirect_to === 'http://127.0.0.1:3000/', 'Generation response changed target or redirect');
  const issued = new URL(generated.action_link);
  requireThat(issued.origin === api && issued.pathname === '/auth/v1/verify' && issued.searchParams.get('type') === 'recovery' && issued.searchParams.get('redirect_to') === 'http://127.0.0.1:3000/' && issued.searchParams.get('token') === generated.hashed_token, 'Native generated link wire contract mismatch');
  const afterGeneration = await getRawUser(employeeUid);
  requireThat(afterGeneration.id === employeeUid && afterGeneration.email === employeeEmail && !afterGeneration.email_confirmed_at && !afterGeneration.last_sign_in_at && afterGeneration.recovery_sent_at, 'Generation must not activate or replace existing user');
  report('Native generate_link uses existing unconfirmed UID; no email, user recreation, backing-email change or confirmation at issue');

  stage = 'native redemption and private password';
  const recovering = fresh();
  const events = [];
  const listener = recovering.auth.onAuthStateChange(event => { events.push(event); });
  const redeemed = await recovering.auth.verifyOtp({ token_hash: generated.hashed_token, type: 'recovery' });
  requireThat(!redeemed.error && redeemed.data.session?.user?.id === employeeUid, 'Native recovery redemption failed');
  requireThat(events.includes('PASSWORD_RECOVERY'), 'Native SDK did not emit PASSWORD_RECOVERY');
  const afterRedeem = await getRawUser(employeeUid);
  requireThat(afterRedeem.id === employeeUid && afterRedeem.email === employeeEmail && afterRedeem.email_confirmed_at, 'Redemption did not confirm the same existing account');
  const saved = await recovering.auth.updateUser({ password: setupPassword });
  requireThat(!saved.error && saved.data.user?.id === employeeUid, 'Native recovery password update failed');
  requireThat(!(await recovering.auth.signOut()).error, 'Native signout failed'); listener.data.subscription.unsubscribe();
  const signed = await fresh().auth.signInWithPassword({ email: employeeEmail, password: setupPassword });
  requireThat(!signed.error && signed.data.user?.id === employeeUid, 'Private password cannot sign in to same UID');
  const oldDenied = await fresh().auth.signInWithPassword({ email: employeeEmail, password: initialPassword });
  requireThat(oldDenied.error?.code === 'invalid_credentials', 'Old password unexpectedly valid');
  const replay = await fresh().auth.verifyOtp({ token_hash: generated.hashed_token, type: 'recovery' });
  requireThat(replay.error?.code === 'otp_expired', 'Redeemed recovery token replay accepted');
  requireThat(beforeGrant === JSON.stringify((await db.query('select * from public.app_employee_access where user_id=$1', [employeeUid])).rows), 'Native recovery changed employee grants');
  requireThat(ownerGrantBefore === JSON.stringify((await db.query('select * from public.app_user_roles where user_id=$1', [ownerUid])).rows), 'Native recovery changed owner grants');
  requireThat(!(await fresh().auth.signInWithPassword({ email: ownerEmail, password: ownerPassword })).error, 'Other user password changed');
  report('Redemption confirms same UID, emits PASSWORD_RECOVERY; private password works, old password/replay denied, both grants preserved');

  stage = 'full Hub identity-bound recovery regressions';
  const browserEmail = 'browser-recovery-test@example.invalid', browserInitial = password();
  const browserCreated = await admin.auth.admin.createUser({ email: browserEmail, password: browserInitial, email_confirm: false });
  requireThat(!browserCreated.error, 'Browser synthetic account creation failed');
  const browserUid = browserCreated.data.user.id;
  result.totalSyntheticUsers = 3;
  await db.query(`insert into public.app_employee_access(user_id,profile_key,allowed_views,allowed_wall_subviews,enabled,inventory_can_view,inventory_can_adjust,inventory_can_manage,updated_by)
    select $1,profile_key,allowed_views,allowed_wall_subviews,enabled,inventory_can_view,inventory_can_adjust,inventory_can_manage,'SYNTHETIC native recovery browser' from public.app_employee_access where user_id=$2`, [browserUid, employeeUid]);
  const browserGrantBefore = JSON.stringify((await db.query('select * from public.app_employee_access where user_id=$1', [browserUid])).rows);
  await runNativeRecoveryHubBrowser({ root, apiUrl: api, anonKey: vars.ANON_KEY, admin, fresh,
    browserOther: { uid: ownerUid, email: ownerEmail, password: ownerPassword },
    browserEmployee: { uid: browserUid, email: browserEmail, initialPassword: browserInitial },
    report, assert: requireThat });
  requireThat(browserGrantBefore === JSON.stringify((await db.query('select * from public.app_employee_access where user_id=$1', [browserUid])).rows), 'Full Hub recovery changed employee grants');
  requireThat(ownerGrantBefore === JSON.stringify((await db.query('select * from public.app_user_roles where user_id=$1', [ownerUid])).rows), 'Full Hub recovery changed owner grants');

  stage = 'native challenge expiry';
  const expiryLink = await admin.auth.admin.generateLink({ type: 'recovery', email: employeeEmail, options: { redirectTo: 'http://127.0.0.1:3000/' } });
  requireThat(!expiryLink.error && expiryLink.data.user?.id === employeeUid, 'Expiry fixture generation failed');
  await new Promise(resolve => setTimeout(resolve, 62000));
  const expired = await fresh().auth.verifyOtp({ token_hash: expiryLink.data.properties.hashed_token, type: 'recovery' });
  requireThat(expired.error?.code === 'otp_expired', 'Expired native challenge accepted');
  requireThat((await db.query('select count(*)::int as count from auth.users')).rows[0].count === 3, 'Unexpected native Auth identity creation');
  report('Configured short-lived native recovery token expires without auth-table patches');
  result.passed = true;
} catch (error) {
  exitCode = 1;
  result.failure = { stage, message: (error instanceof TestFailure || error instanceof NativeRecoveryHubFailure) ? error.message : 'Native operation failed; raw provider/parser/process diagnostics suppressed' };
  console.error(`FAIL: ${stage}: ${result.failure.message}`);
} finally {
  if (db) await db.end().catch(() => {});
  try {
    const exists = await fs.stat(cliPath).then(() => true, () => false);
    if (exists) {
      const listed = JSON.parse((await command(['stack', 'list', '--output-format', 'json'], 30000)).stdout);
      const items = Array.isArray(listed) ? listed : listed.stacks ?? listed.result?.stacks ?? [];
      if (started || items.length) await command(['stack', 'destroy', '--yes', '--output-format', 'json'], 90000);
    }
    result.cleanup = true;
  } catch { result.cleanup = false; exitCode = 1; console.error('FAIL: disposable cleanup failed'); }
  if (result.cleanup) await fs.rm(temp, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`Native recovery cases: ${result.cases.length}; passed=${result.passed}; cleanup=${result.cleanup}`);
  process.exitCode = exitCode;
}
