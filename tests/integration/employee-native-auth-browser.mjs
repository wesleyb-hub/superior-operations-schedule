// Actual pinned Supabase JS + disposable local GoTrue cross-tab acceptance.
// Intentionally NOT a full Hub/UI/RLS test. No screenshots, traces or credential logs.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const root=resolve(import.meta.dirname,'../..');
const SDK_VERSION='2.57.4';
const PLAYWRIGHT_VERSION='1.56.1';
const LABELS=Object.freeze({
  ready:'Native SDK: two same-origin tabs initialized without an authenticated session',
  login:'Native SDK: real password authentication confirmed by local Auth',
  broadcast:'Native SDK: sign-in reached the second tab through native session synchronization',
  restore:'Native SDK: second-tab reload restored and server-verified the shared session',
  signout:'Native SDK: native SIGNED_OUT cleared both tabs and their session storage',
  reload:'Native SDK: reloading both tabs after sign-out did not resurrect authentication',
  network:'Native SDK: only the loopback fixture and allowlisted local Auth routes were used',
});

function localApi(value){
  let url;try{url=new URL(value)}catch{throw new Error('Native SDK browser fixture requires a loopback Auth URL')}
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Native SDK browser fixture requires a root HTTP loopback Auth URL');
  return url.origin;
}
function ensure(value){if(!value)throw new Error('Native SDK browser assertion failed')}

/**
 * Run only in an authorized disposable integration runner with Chromium installed.
 * email/password must belong to a synthetic confirmed local Auth identity created
 * by the caller. report receives fixed success-label strings, never provider data.
 * Browser activity is restricted to loopback; actual signOut uses global scope for
 * this synthetic identity. This module never creates users or touches business data.
 */
export async function runNativeSdkBrowser({apiUrl,publishableKey,email,password,report=()=>{}}={}){
  const apiOrigin=localApi(apiUrl);
  if(typeof publishableKey!=='string'||!publishableKey||typeof email!=='string'||!email||typeof password!=='string'||!password||typeof report!=='function')throw new Error('Native SDK browser fixture inputs are incomplete');
  let browser,context,server,stage='fixture initialization',unexpectedRequests=0,pageErrors=0,checks=0;
  const pass=async label=>{checks++;await report(label)};
  try{
    const sdkPackage=JSON.parse(await readFile(resolve(root,'node_modules/@supabase/supabase-js/package.json'),'utf8'));
    const playwrightPackage=JSON.parse(await readFile(resolve(root,'node_modules/playwright/package.json'),'utf8'));
    ensure(sdkPackage.version===SDK_VERSION&&playwrightPackage.version===PLAYWRIGHT_VERSION);
    const sdk=await readFile(resolve(root,'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
    const {chromium}=require('playwright');
    // Isolated browser context and unique SDK storage key cannot share real sessions.
    const storageKey='synthetic-native-sdk-'+randomUUID();
    const config=JSON.stringify({apiOrigin,publishableKey,storageKey}).replaceAll('<','\\u003c');
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src ${apiOrigin}; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'"><title>Synthetic native Auth acceptance</title></head><body><p>Synthetic local native Auth test only. No operational workspace is loaded.</p><script src="/sdk.js"></script><script>
      (()=>{
        const config=${config};
        const proof={ready:false,initialError:false,hasSession:false,signedInEvents:0,signedOutEvents:0,simulatedWorkspaceVisible:false};
        const client=supabase.createClient(config.apiOrigin,config.publishableKey,{auth:{storageKey:config.storageKey,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,debug:false}});
        window.nativeSdkTest={client,proof,storageKey:config.storageKey};
        client.auth.onAuthStateChange((event,session)=>{
          proof.hasSession=Boolean(session?.user);
          proof.simulatedWorkspaceVisible=Boolean(session?.user);
          if(event==='SIGNED_IN')proof.signedInEvents++;
          if(event==='SIGNED_OUT')proof.signedOutEvents++;
        });
        client.auth.getSession().then(({data,error})=>{
          proof.initialError=Boolean(error);
          proof.hasSession=Boolean(data?.session?.user);
          proof.simulatedWorkspaceVisible=proof.hasSession;
          proof.ready=true;
        }).catch(()=>{proof.initialError=true;proof.ready=true});
      })();
    </script></body></html>`;
    server=createServer((req,res)=>{
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Referrer-Policy','no-referrer');
      if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return}
      if(req.method==='GET'&&req.url==='/sdk.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(sdk);return}
      if(req.method==='GET'&&req.url==='/favicon.ico'){res.writeHead(204);res.end();return}
      res.writeHead(404);res.end('Synthetic fixture route unavailable');
    });
    await new Promise((resolveListen,rejectListen)=>{server.once('error',rejectListen);server.listen(0,'127.0.0.1',resolveListen)});
    const fixtureOrigin=`http://127.0.0.1:${server.address().port}`;
    stage='Chromium launch';
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    context=await browser.newContext({serviceWorkers:'block'});
    await context.route('**/*',route=>{
      const request=route.request();let url;try{url=new URL(request.url())}catch{unexpectedRequests++;return route.abort()}
      const fixtureRequest=url.origin===fixtureOrigin&&request.method()==='GET'&&['/','/sdk.js','/favicon.ico'].includes(url.pathname)&&!url.search;
      const authRequest=url.origin===apiOrigin&&[
        ['/auth/v1/token',['POST','OPTIONS']],
        ['/auth/v1/user',['GET','OPTIONS']],
        ['/auth/v1/logout',['POST','OPTIONS']],
      ].some(([path,methods])=>url.pathname===path&&methods.includes(request.method()));
      if(fixtureRequest||authRequest)return route.continue();
      unexpectedRequests++;return route.abort();
    });
    const first=await context.newPage(),second=await context.newPage();
    for(const page of [first,second]){page.setDefaultTimeout(15000);page.on('pageerror',()=>{pageErrors++})}
    const ready=page=>page.waitForFunction(()=>window.nativeSdkTest?.proof.ready===true&&!window.nativeSdkTest.proof.initialError);
    const noSession=page=>page.evaluate(async()=>{
      const {data,error}=await window.nativeSdkTest.client.auth.getSession();
      return !error&&!data?.session&&!window.nativeSdkTest.proof.hasSession&&!window.nativeSdkTest.proof.simulatedWorkspaceVisible;
    });
    stage='empty two-tab initialization';
    await Promise.all([first.goto(fixtureOrigin+'/'),second.goto(fixtureOrigin+'/')]);
    await Promise.all([ready(first),ready(second)]);
    ensure(await noSession(first));ensure(await noSession(second));await pass(LABELS.ready);

    stage='native password sign-in';
    // Credentials travel only in the ephemeral page call and native
    // loopback Auth POST. Never return error objects, sessions or tokens to Node.
    const signedIn=await first.evaluate(async({email,password})=>{
      try{
        const {data,error}=await window.nativeSdkTest.client.auth.signInWithPassword({email,password});
        return !error&&Boolean(data?.session?.user?.id)&&data.session.user.id===data.user?.id&&data.user?.is_anonymous!==true;
      }catch{return false}
    },{email,password});
    ensure(signedIn);await pass(LABELS.login);

    stage='cross-tab native sign-in synchronization';
    await Promise.all([first,second].map(page=>page.waitForFunction(()=>window.nativeSdkTest.proof.hasSession&&window.nativeSdkTest.proof.simulatedWorkspaceVisible&&window.nativeSdkTest.proof.signedInEvents>0)));
    await pass(LABELS.broadcast);

    stage='shared native session reload and server verification';
    await second.reload();await ready(second);
    ensure(await second.evaluate(async expectedEmail=>{
      try{
        const {data,error}=await window.nativeSdkTest.client.auth.getUser();
        const session=await window.nativeSdkTest.client.auth.getSession();
        return !error&&!session.error&&data.user?.email?.toLowerCase()===expectedEmail.toLowerCase()&&Boolean(data.user?.id)&&data.user.id===session.data?.session?.user?.id&&window.nativeSdkTest.proof.simulatedWorkspaceVisible;
      }catch{return false}
    },email));
    await pass(LABELS.restore);

    stage='native global sign-out propagation';
    ensure(await first.evaluate(async()=>{
      try{return !(await window.nativeSdkTest.client.auth.signOut({scope:'global'})).error}catch{return false}
    }));
    await Promise.all([first,second].map(page=>page.waitForFunction(()=>!window.nativeSdkTest.proof.hasSession&&!window.nativeSdkTest.proof.simulatedWorkspaceVisible&&window.nativeSdkTest.proof.signedOutEvents>0)));
    ensure(await noSession(first));ensure(await noSession(second));
    for(const page of [first,second])ensure(await page.evaluate(()=>localStorage.getItem(window.nativeSdkTest.storageKey)===null));
    await pass(LABELS.signout);

    stage='post-sign-out reload resurrection check';
    await Promise.all([first.reload(),second.reload()]);await Promise.all([ready(first),ready(second)]);
    ensure(await noSession(first));ensure(await noSession(second));await pass(LABELS.reload);
    stage='network and script safety';ensure(unexpectedRequests===0&&pageErrors===0);await pass(LABELS.network);
    return {passed:true,scope:'native-sdk-cross-tab-session',checks};
  }catch{
    // Never surface upstream/browser diagnostics: they can contain request context.
    throw new Error('Native SDK browser check failed at '+stage+'. No credential diagnostics were retained.');
  }finally{
    try{if(context)await context.close()}catch{}
    try{if(browser)await browser.close()}catch{}
    try{if(server?.listening)await new Promise(resolveClose=>server.close(resolveClose))}catch{}
  }
}
