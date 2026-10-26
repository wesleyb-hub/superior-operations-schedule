// Full Hub + real pinned SDK + disposable native Auth. No screenshots, traces,
// request bodies, tokens, passwords, URLs with fragments, or provider errors logged.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FIXTURE_ORIGIN = 'http://127.0.0.1:3000';
const sdkVersion = '2.118.0';
const playwrightVersion = '1.56.1';
const password = () => `Aa9!${randomBytes(24).toString('base64url')}`;
function ensure(value) { if (!value) throw new Error('Native Hub recovery assertion failed'); }
const delay = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const safeStages = new Set([
  'prepare full Hub', 'native recovery through full Hub success',
  'phone username form signs in with native private password',
  'other user signs in before stale recovery submission',
  'actual A password request held while B signs in',
  'logout interrupts full Hub recovery', 'cancel recovery clears retained session',
  'native password-policy error cleans recovery session',
]);
export class NativeRecoveryHubFailure extends Error {
  constructor(stage) { super('Native full Hub recovery failed at ' + (safeStages.has(stage) ? stage : 'unknown safe phase') + '; credential diagnostics suppressed.'); }
}

export async function runNativeRecoveryHubBrowser({ root, apiUrl, anonKey, admin, browserEmployee, browserOther, report = () => {} }) {
  const api = new URL(apiUrl);
  ensure(api.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) && api.pathname === '/' && !api.search && !api.hash);
  ensure(browserEmployee.email.endsWith('.invalid') && browserOther.email.endsWith('.invalid') && browserEmployee.uid !== browserOther.uid);
  const { chromium } = require('playwright');
  const { createClient } = require('@supabase/supabase-js');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (url, init) => {
    ensure(new URL(typeof url === 'string' ? url : url.url).origin === api.origin);
    return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000) });
  } } };
  const fresh = () => createClient(api.origin, anonKey, options);
  let server, browser, context, stage = 'prepare full Hub', unexpectedRequests = 0, pageErrors = 0, currentEmployeePassword = browserEmployee.initialPassword;
  const strongOne = password(), strongTwo = password(), invalidNewPassword = 'LettersOnlyPasswordWithoutDigitsOrSymbols';
  const putActors = [], putResponses = [];
  let holdNextPut = false, signalHeld, releasePut, heldRequest, heldActor;
  try {
    ensure(JSON.parse(await readFile(resolve(root, 'node_modules/@supabase/supabase-js/package.json'), 'utf8')).version === sdkVersion);
    ensure(JSON.parse(await readFile(resolve(root, 'node_modules/playwright/package.json'), 'utf8')).version === playwrightVersion);
    const sdk = await readFile(resolve(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
    let html = await readFile(resolve(root, 'index.html'), 'utf8');
    ensure(html.includes(`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${sdkVersion}/dist/umd/supabase.js`) || html.includes(`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${sdkVersion}`));
    html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.118\.0(?:\/dist\/umd\/supabase\.js)?"><\/script>/, '<script src="/fixture-sdk.js"></script>');
    // PDF export is unrelated to authentication; no remote CDN dependency in this fixture.
    html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@[^\"]+"><\/script>/, '');
    ensure(!html.includes('https://cdn.jsdelivr.net/npm/@supabase/supabase-js'));
    const config = `window.SUPERIOR_CONFIG=${JSON.stringify({ supabaseUrl: api.origin, supabaseAnonKey: anonKey, allowedEmailDomain: 'example.invalid', employeeUsernameLoginEnabled: true })};`;
    // B is an independent same-origin native-SDK actor, not a stubbed Hub handler.
    // It shares the actual browser SDK storage key but has no Hub callback/RPC locks.
    const actorHtml = '<!doctype html><meta charset="utf-8"><title>Synthetic native actor</title>' +
      '<script src="/fixture-sdk.js"></script><script src="/config.js"></script>' +
      '<script>window.nativeActor=window.supabase.createClient(window.SUPERIOR_CONFIG.supabaseUrl,window.SUPERIOR_CONFIG.supabaseAnonKey);</script>';
    server = createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      const pathname = new URL(req.url, FIXTURE_ORIGIN).pathname;
      if (pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
      if (pathname === '/fixture-native-actor.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(actorHtml); return; }
      if (pathname === '/fixture-sdk.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(sdk); return; }
      if (pathname === '/config.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(config); return; }
      if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      let file;
      try { file = resolve(root, '.' + decodeURIComponent(pathname)); } catch { res.writeHead(400); res.end(); return; }
      if (!file.startsWith(resolve(root) + sep) || !['.css', '.png', '.svg', '.jpg', '.webp', '.woff2'].includes(extname(file))) { res.writeHead(404); res.end(); return; }
      try { res.setHeader('Content-Type', ({ '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream'); res.end(await readFile(file)); }
      catch { res.writeHead(404); res.end(); }
    });
    await new Promise((done, fail) => { server.once('error', fail); server.listen(3000, '127.0.0.1', done); });
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const startContext = async () => {
      if (context) await context.close();
      context = await browser.newContext({ serviceWorkers: 'block' });
      context.on('response', response => {
        const request = response.request();
        const url = new URL(request.url());
        if (url.origin !== api.origin || url.pathname !== '/auth/v1/user' || request.method() !== 'PUT') return;
        putResponses.push((async () => {
          const status = response.status();
          // Read only the expected error shape in memory; retain only a fixed-code boolean.
          let weakPassword = false;
          if (status === 422) { try { weakPassword = (await response.json()).code === 'weak_password'; } catch {} }
          return { status, weakPassword };
        })());
      });
      await context.route('**/*', async route => {
        const request = route.request(); let url;
        try { url = new URL(request.url()); } catch { unexpectedRequests++; return route.abort(); }
        if (url.origin === FIXTURE_ORIGIN && request.method() === 'GET') return route.continue();
        const authAllowed = url.origin === api.origin && [
          ['/auth/v1/verify', ['GET', 'POST', 'OPTIONS']], ['/auth/v1/token', ['POST', 'OPTIONS']],
          ['/auth/v1/user', ['GET', 'PUT', 'OPTIONS']], ['/auth/v1/logout', ['POST', 'OPTIONS']],
        ].some(([pathname, methods]) => url.pathname === pathname && methods.includes(request.method()));
        const businessRead = url.origin === api.origin && url.pathname.startsWith('/rest/v1/') &&
          (['GET', 'OPTIONS'].includes(request.method()) || (request.method() === 'POST' && /^\/rest\/v1\/rpc\/get_[a-z_]+$/.test(url.pathname)));
        if (!authAllowed && !businessRead) { unexpectedRequests++; return route.abort(); }
        if (url.pathname === '/auth/v1/user' && request.method() === 'PUT') {
          const bearer = (request.headers().authorization || '').replace(/^Bearer /, '');
          const verified = await admin.auth.getUser(bearer);
          const actor = !verified.error ? verified.data.user?.id : null;
          putActors.push(actor);
          if (holdNextPut) {
            holdNextPut = false; heldActor = actor; heldRequest = route;
            signalHeld();
            await new Promise(resolveRelease => { releasePut = resolveRelease; });
            try { return await route.continue(); } catch { return; } // Cancellation is allowed; never resubmit.
          }
        }
        return route.continue();
      });
      const first = await context.newPage(), second = await context.newPage();
      for (const page of [first, second]) { page.setDefaultTimeout(15000); page.on('pageerror', () => { pageErrors++; }); }
      return { first, second };
    };
    const ready = page => page.waitForFunction(() => typeof sb !== 'undefined' && Boolean(sb) && typeof authMode === 'string');
    const makeLink = async () => {
      const response = await admin.auth.admin.generateLink({ type: 'recovery', email: browserEmployee.email, options: { redirectTo: FIXTURE_ORIGIN + '/' } });
      ensure(!response.error && response.data.user?.id === browserEmployee.uid && response.data.user?.email === browserEmployee.email);
      const link = new URL(response.data.properties.action_link);
      ensure(link.origin === api.origin && link.pathname === '/auth/v1/verify' && link.searchParams.get('type') === 'recovery' && link.searchParams.get('redirect_to') === FIXTURE_ORIGIN + '/');
      return response.data.properties.action_link;
    };
    const recovery = async page => {
      await page.goto(await makeLink(), { waitUntil: 'domcontentloaded' });
      await ready(page);
      await page.waitForFunction(() => authMode === 'recovery' && Boolean(recoveryIdentity?.uid) && !document.getElementById('authNewPasswordGroup').hidden);
      ensure(await page.evaluate(uid => recoveryIdentity.uid === uid && document.getElementById('authEmail').readOnly && location.hash === '' && !new URL(location.href).searchParams.has('token_hash'), browserEmployee.uid));
    };
    const fill = async (page, secret) => { await page.locator('#authNewPassword').fill(secret); await page.locator('#authConfirmPassword').fill(secret); };
    const settled = page => page.waitForFunction(() => authMode === 'login' && !employeeSessionInstalling && !employeeCleanupBlocked && recoveryIdentity === null);
    const noRecoveredSessionInNewTab = async () => {
      const extra = await context.newPage(); extra.setDefaultTimeout(15000); extra.on('pageerror', () => { pageErrors++; });
      await extra.goto(FIXTURE_ORIGIN + '/', { waitUntil: 'domcontentloaded' }); await ready(extra);
      await extra.waitForFunction(async () => { const result = await sb.auth.getSession(); return !result.error && !result.data.session && authMode !== 'recovery' && !currentUser && document.querySelector('.app').inert; });
      await extra.close();
    };
    const actorReady = async page => {
      await page.goto(FIXTURE_ORIGIN + '/fixture-native-actor.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.nativeActor));
      ensure(await page.evaluate(async () => !(await window.nativeActor.auth.getSession()).error));
    };
    const signinB = async page => {
      await actorReady(page);
      ensure(await page.evaluate(async ({ email, password, uid }) => {
        try { const response = await window.nativeActor.auth.signInWithPassword({ email, password }); return !response.error && response.data.user?.id === uid; } catch { return false; }
      }, browserOther));
    };
    const passwordWorks = async (identity, secret) => {
      const client = fresh(), response = await client.auth.signInWithPassword({ email: identity.email, password: secret });
      const good = !response.error && response.data.user?.id === identity.uid;
      if (good) await client.auth.signOut({ scope: 'local' });
      return good;
    };
    const unchangedB = async attempted => { ensure(await passwordWorks(browserOther, browserOther.password)); ensure(!await passwordWorks(browserOther, attempted)); };

    stage = 'native recovery through full Hub success';
    let { first, second } = await startContext();
    await recovery(first); await fill(first, strongOne); await first.locator('#authBtn').click(); await settled(first);
    ensure(await passwordWorks(browserEmployee, strongOne)); ensure(!await passwordWorks(browserEmployee, currentEmployeePassword)); currentEmployeePassword = strongOne;
    await unchangedB(strongOne); await noRecoveredSessionInNewTab();
    report('Full Hub actual recovery redirect captures existing UID, saves private password and clears retained recovery session on fresh tab');

    stage = 'phone username form signs in with native private password';
    await first.setViewportSize({ width: 390, height: 844 });
    await first.locator('#employeeLoginBtn').click();
    await first.waitForFunction(() => authMode === 'employee-login');
    await first.locator('#authUsername').fill(browserEmployee.email.split('@')[0]);
    await first.locator('#authPassword').fill(currentEmployeePassword);
    ensure(await first.locator('#authBtn').isVisible());
    await first.locator('#authBtn').click();
    await first.waitForFunction(uid => currentUser?.id === uid && currentUserAuthorized && !employeeSessionInstalling && !employeeCleanupBlocked && !document.querySelector('.app').inert, browserEmployee.uid);
    ensure(await first.evaluate(() => !currentUserIsAdmin && !currentUserCanWrite && currentUserRole === 'walls_inventory_counter' &&
      JSON.stringify([...currentAllowedViews].sort()) === JSON.stringify(['inventory','overview','walls','weekly-planner']) &&
      JSON.stringify(currentAllowedWallSubviews) === JSON.stringify(['production']) && inventoryCanView && inventoryCanAdjust && !inventoryCanManage));
    await first.locator('#signOutBtn').click();
    await settled(first);
    await first.waitForFunction(async () => { const result = await sb.auth.getSession(); return !result.error && !result.data.session && document.getElementById('retrySignOutBtn').hidden; });
    await noRecoveredSessionInNewTab();
    report('Phone-width actual username form signs into the same existing native UID with unchanged restricted access, then signs out without retained recovery session');

    stage = 'other user signs in before stale recovery submission';
    ({ first, second } = await startContext()); await recovery(first); await fill(first, strongTwo);
    const beforeSwitchPuts = putActors.length;
    await signinB(second); await settled(first);
    // Dispatch the old form's button after invalidation without overriding app state.
    await first.evaluate(() => document.getElementById('authBtn').click());
    await delay(150);
    ensure(putActors.length === beforeSwitchPuts);
    await unchangedB(strongTwo); ensure(await passwordWorks(browserEmployee, currentEmployeePassword)); await noRecoveredSessionInNewTab();
    report('Real cross-tab B sign-in invalidates A recovery before submit; stale form never updates B and clean reload has no recovery session');

    stage = 'actual A password request held while B signs in';
    ({ first, second } = await startContext()); await recovery(first); await fill(first, strongTwo);
    let resolveHeld; const held = new Promise(resolveHeldPromise => { resolveHeld = resolveHeldPromise; });
    signalHeld = resolveHeld; holdNextPut = true; heldRequest = null; heldActor = null;
    await first.locator('#authBtn').click();
    await Promise.race([held, delay(15000).then(() => { throw new Error('Expected actual native password request not observed'); })]);
    ensure(heldRequest && heldActor === browserEmployee.uid);
    await signinB(second);
    releasePut(); releasePut = null;
    await settled(first);
    await unchangedB(strongTwo);
    if (await passwordWorks(browserEmployee, strongTwo)) currentEmployeePassword = strongTwo;
    else ensure(await passwordWorks(browserEmployee, currentEmployeePassword));
    await noRecoveredSessionInNewTab();
    report('In-flight real native PUT retains A bearer or is canceled after B signs in; B password unchanged and shared recovery persistence cleared');

    stage = 'logout interrupts full Hub recovery';
    ({ first, second } = await startContext()); await recovery(first);
    await actorReady(second);
    ensure(await second.evaluate(async () => { try { return !(await window.nativeActor.auth.signOut({ scope: 'local' })).error; } catch { return false; } }));
    await settled(first); await noRecoveredSessionInNewTab();
    ensure(await passwordWorks(browserEmployee, currentEmployeePassword));
    report('Native cross-tab logout cancels recovery without changing password or allowing a fresh-tab session resurrection');

    stage = 'cancel recovery clears retained session';
    ({ first, second } = await startContext()); await recovery(first); await first.locator('#backToLoginBtn').click(); await settled(first);
    await noRecoveredSessionInNewTab(); ensure(await passwordWorks(browserEmployee, currentEmployeePassword));
    report('Full Hub Back-to-sign-in cancellation clears recovery binding and shared native persistence');

    stage = 'native password-policy error cleans recovery session';
    ({ first, second } = await startContext()); await recovery(first); await fill(first, invalidNewPassword);
    const beforeErrorPuts = putActors.length, beforeErrorResponses = putResponses.length;
    await first.locator('#authBtn').click(); await settled(first);
    ensure(putActors.length === beforeErrorPuts + 1 && putActors.at(-1) === browserEmployee.uid);
    const errorResponses = await Promise.all(putResponses.slice(beforeErrorResponses));
    ensure(errorResponses.length === 1 && errorResponses[0].status === 422 && errorResponses[0].weakPassword);
    ensure(await passwordWorks(browserEmployee, currentEmployeePassword));
    await noRecoveredSessionInNewTab();
    report('Actual native password-policy rejection preserves password and removes retained recovery session after error');
    ensure(putActors.every(uid => uid === browserEmployee.uid));
    ensure(unexpectedRequests === 0 && pageErrors === 0);
    report('All observed password PUTs are server-verified to A; full Hub fixture used only loopback Auth and read-only synthetic business data');
    return { passed: true, scope: 'full-Hub-native-recovery-cross-tab', sdk: sdkVersion, cases: 8 };
  } catch {
    throw new NativeRecoveryHubFailure(stage);
  } finally {
    if (releasePut) releasePut();
    try { if (context) await context.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
    try { if (server?.listening) await new Promise(done => server.close(done)); } catch {}
  }
}
