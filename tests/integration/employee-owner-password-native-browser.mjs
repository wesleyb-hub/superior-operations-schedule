// SOURCE-ONLY until the separately approved isolated GitHub job invokes it.
// Real Hub + pinned native SDK + vendored JWE + injected actual handler + native
// loopback Auth/PostgREST. No screenshots, traces, HAR, credentials or raw errors.
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
const require=createRequire(import.meta.url);
const HUB='https://hub.example.invalid',AUTH='https://auth.example.invalid';
const ENDPOINT=AUTH+'/functions/v1/employee-password';
const phases=new Set(['fixture preparation','desktop owner sign-in','responsive owner disclosure','non-owner disclosure','phone owner sign-in','cancel before encryption module resolves','native initial password through phone UI','native password reset through phone UI','native identity switch before prepare','final assertions']);
export class EmployeeOwnerPasswordBrowserFailure extends Error{constructor(phase){const safePhase=phases.has(phase)?phase:'unknown safe phase';super('Native owner password browser failed at '+safePhase+'; credential diagnostics suppressed.');this.safePhase=safePhase}}
const ensure=value=>{if(!value)throw Error('Synthetic native browser assertion failed')};
const strong=()=>`Aa9!${randomBytes(24).toString('base64url')}`;
const gate=()=>{let release,seen;const waiting=new Promise(resolve=>{release=resolve}),reached=new Promise(resolve=>{seen=resolve});return {waiting,reached,release,seen}};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic fixture timed out')),15000)})])}finally{clearTimeout(timer)}}
export async function runEmployeeOwnerPasswordNativeBrowser({root,apiUrl,anonKey,handler,owner,employee,publicKeyConfig,report=()=>{}}){
  let phase='fixture preparation',browser,context,ownerAccessToken='',transportFailures=0,unexpectedRequests=0,pageErrors=0,edgeCalls=0;
  let holdImport=null,holdCapability=null;const pauseGates=[];
  const initialPassword=strong(),resetPassword=strong(),cancelledPassword=strong();
  try{
    ensure(process.env.GITHUB_ACTIONS==='true'&&process.env.RUN_EMPLOYEE_OWNER_PASSWORD_NATIVE_TEST==='1');
    const api=new URL(apiUrl);ensure(api.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(api.hostname)&&api.pathname==='/'&&!api.search&&!api.hash&&!api.username&&!api.password);
    ensure(typeof handler==='function'&&owner.uid!==employee.uid&&owner.email.endsWith('.invalid')&&employee.email.endsWith('@company.example.invalid')&&employee.record_id&&publicKeyConfig?.kid);
    ensure(JSON.parse(await readFile(resolve(root,'node_modules/@supabase/supabase-js/package.json'),'utf8')).version==='2.118.0');
    ensure(JSON.parse(await readFile(resolve(root,'node_modules/playwright/package.json'),'utf8')).version==='1.56.1');
    const {chromium}=require('playwright'),{createClient}=require('@supabase/supabase-js');
    const nativeFetch=(url,init)=>{const target=new URL(typeof url==='string'?url:url.url);ensure(target.origin===api.origin);return fetch(target,{...init,redirect:'error',signal:AbortSignal.timeout(12000)})};
    const fresh=()=>createClient(api.origin,anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:nativeFetch}});
    const passwordWorks=async secret=>{const client=fresh();try{const result=await client.auth.signInWithPassword({email:employee.email,password:secret});const okay=!result.error&&result.data.user?.id===employee.uid;if(okay)await client.auth.signOut({scope:'local'});return okay}finally{await client.auth.dispose()}};
    const expectPasswordRejected=async secret=>{const client=fresh();try{const result=await client.auth.signInWithPassword({email:employee.email,password:secret});if(result.data.session)await client.auth.signOut({scope:'local'});ensure(result.error?.status===400&&result.error?.code==='invalid_credentials'&&!result.data.user&&!result.data.session)}finally{await client.auth.dispose()}};
    const sdk=await readFile(resolve(root,'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
    let html=await readFile(resolve(root,'index.html'),'utf8');
    ensure(html.includes('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0'));
    html=html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.118\.0(?:\/dist\/umd\/supabase\.js)?"><\/script>/,'<script src="/fixture-sdk.js"></script>');
    // PDF export is unrelated; remove its external CDN rather than permit network.
    html=html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@[^\"]+"><\/script>/,'');
    ensure(!html.includes('https://cdn.jsdelivr.net/'));
    const config='window.SUPERIOR_CONFIG='+JSON.stringify({supabaseUrl:AUTH,supabaseAnonKey:anonKey,allowedEmailDomain:owner.email.split('@')[1],employeeUsernameLoginEnabled:true,employeePasswordAdminEnabled:true,employeePasswordEndpoint:ENDPOINT,employeePasswordKey:publicKeyConfig})+';';
    const actorHtml='<!doctype html><meta charset="utf-8"><title>Synthetic native actor</title><script src="/fixture-sdk.js"></script><script src="/config.js"></script><script>window.nativeActor=window.supabase.createClient(window.SUPERIOR_CONFIG.supabaseUrl,window.SUPERIOR_CONFIG.supabaseAnonKey);</script>';
    const cors={'access-control-allow-origin':HUB,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'apikey,authorization,content-type,x-client-info,x-supabase-api-version','cache-control':'no-store'};
    const localAsset=async pathname=>{
      if(pathname==='/'||pathname==='/index.html')return {contentType:'text/html; charset=utf-8',body:html};
      if(pathname==='/config.js')return {contentType:'text/javascript',body:config};
      if(pathname==='/fixture-sdk.js')return {contentType:'text/javascript',body:sdk};
      if(pathname==='/fixture-native-actor.html')return {contentType:'text/html',body:actorHtml};
      if(pathname==='/favicon.ico')return {status:204,body:''};
      const file=resolve(root,'.'+decodeURIComponent(pathname));ensure(file.startsWith(resolve(root)+sep));
      const javascript=pathname==='/employee-password-candidate/browser-crypto.mjs'||pathname.startsWith('/employee-password-candidate/vendor/jose-6.2.13/');
      ensure(javascript||['.css','.png','.svg','.jpg','.webp','.woff2'].includes(extname(file)));
      return {contentType:javascript?'text/javascript':({'.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream',body:await readFile(file)};
    };
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    async function newContext(viewport={width:390,height:844}){
      if(context)await context.close();
      context=await browser.newContext({viewport,serviceWorkers:'block'});
      // Realtime is deliberately absent from the native stack. Block sockets,
      // including any unexpected origin, rather than contacting external hosts.
      ensure(typeof context.routeWebSocket==='function');
      await context.routeWebSocket('**/*',socket=>{if(new URL(socket.url()).origin!=='wss://auth.example.invalid')unexpectedRequests++;socket.close()});
      await context.route('**/*',async route=>{
        try{
          const request=route.request(),url=new URL(request.url()),method=request.method();
          if(url.origin===HUB&&method==='GET'){
            const asset=await localAsset(url.pathname);
            if(url.pathname==='/employee-password-candidate/browser-crypto.mjs'&&holdImport){const held=holdImport;holdImport=null;held.seen();await held.waiting}
            return await route.fulfill({status:200,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'},...asset});
          }
          if(url.origin!==AUTH){unexpectedRequests++;return await route.abort()}
          if(method==='OPTIONS')return await route.fulfill({status:204,headers:cors,body:''});
          if(url.pathname==='/functions/v1/employee-password'){
            const headers=request.headers();let body=request.postData()||'';
            ensure(method==='POST'&&!headers.authorization&&headers.apikey===anonKey&&headers['content-type']==='application/jose');
            ensure(body.length<=16384&&/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){4}$/.test(body));
            ensure(!body.includes(initialPassword)&&!body.includes(resetPassword)&&!body.includes(cancelledPassword)&&(!ownerAccessToken||!body.includes(ownerAccessToken)));
            edgeCalls++;
            // Only the disposable public-key namespace is translated; the real
            // browser-produced JWE bytes go unchanged to the actual handler.
            const result=await handler(new Request(ENDPOINT,{method:'POST',headers:{origin:HUB,apikey:'synthetic-public-key','content-type':'application/jose'},body}));body='';
            return await route.fulfill({status:result.status,headers:{...cors,'content-type':'application/json'},body:await result.text()});
          }
          const auth=/^\/auth\/v1\/(token|user|logout)$/.test(url.pathname)&&['GET','POST'].includes(method);
          const ownerRead=/^\/rest\/v1\/rpc\/employee_password_owner_(status|targets)$/.test(url.pathname)&&method==='POST';
          const businessRead=url.pathname.startsWith('/rest/v1/')&&(method==='GET'||method==='POST'&&/^\/rest\/v1\/rpc\/get_[a-z_]+$/.test(url.pathname));
          if(!auth&&!ownerRead&&!businessRead){unexpectedRequests++;return await route.abort()}
          const headers=new Headers();for(const name of ['apikey','authorization','content-type','x-client-info','x-supabase-api-version','prefer','accept','range','range-unit']){const value=request.headers()[name];if(value)headers.set(name,value)}
          ensure(headers.get('apikey')===anonKey);
          const native=await nativeFetch(api.origin+url.pathname+url.search,{method,headers,...(method==='POST'?{body:request.postDataBuffer()}:{} )});
          const body=Buffer.from(await native.arrayBuffer());
          if(url.pathname==='/rest/v1/rpc/employee_password_owner_status'&&holdCapability){const held=holdCapability;holdCapability=null;held.seen();await held.waiting}
          return await route.fulfill({status:native.status,headers:{...cors,'content-type':native.headers.get('content-type')||'application/json'},body});
        }catch{transportFailures++;try{await route.abort()}catch{}}
      });
      const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',()=>{pageErrors++});return page;
    }
    async function ownerPage(viewport={width:390,height:844}){
      phase=viewport.width>1000?'desktop owner sign-in':'phone owner sign-in';const page=await newContext(viewport);await page.goto(HUB+'/',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>typeof sb!=='undefined'&&Boolean(sb)&&authMode==='login');
      // Use the real native username form's ordered session installation. The
      // synthetic owner still receives only its actual server-assigned role.
      await page.locator('#employeeLoginBtn').click();await page.locator('#authUsername').fill(owner.email.split('@')[0]);await page.locator('#authPassword').fill(owner.password);await page.locator('#authBtn').click();
      await page.waitForFunction(uid=>currentUser?.id===uid&&currentUserAuthorized&&!employeeSessionInstalling&&!employeeCleanupBlocked&&!document.querySelector('.app').inert,owner.uid);
      await page.waitForFunction(()=>!document.getElementById('employeePasswordBtn').hidden);
      ownerAccessToken=await page.evaluate(async()=>{const result=await sb.auth.getSession();return result.data.session?.access_token||''});ensure(ownerAccessToken);
      if(viewport.width<=1000)await page.locator('#mobileToolsToggle').click();
      ensure(await page.locator('.header-more > summary').isVisible());await page.locator('.header-more > summary').click();ensure(await page.locator('#employeePasswordBtn').isVisible());
      return page;
    }
    async function selectEmployee(page){
      await page.waitForFunction(()=>employeePasswordOpen&&!employeePasswordLoading&&employeePasswordTargets.length>0);
      await page.locator('#employeePasswordTarget').selectOption(employee.record_id);
      ensure(await page.locator('#employeePasswordUsername').textContent()===employee.username);
      ensure((await page.locator('#employeePasswordVersion').textContent()).includes(employee.uid));
      ensure(await page.locator('#employeePasswordNew').getAttribute('type')==='password'&&await page.locator('#employeePasswordConfirm').getAttribute('type')==='password');
    }
    async function openEmployee(page){
      await page.locator('#employeePasswordBtn').click();await selectEmployee(page);
      // Observe settlement of the actual click handler without altering its
      // body/crypto/Auth calls or returning any secret from the browser.
      await page.evaluate(()=>{const button=document.getElementById('employeePasswordSave');if(button.dataset.fixtureTracked)return;const actual=button.onclick;button.onclick=function(...args){window.fixturePasswordSubmission=Promise.resolve(actual.apply(this,args)).then(()=>true,()=>false);return window.fixturePasswordSubmission};button.dataset.fixtureTracked='true'});
    }
    async function choose(page,secret){await page.locator('#employeePasswordNew').fill(secret);await page.locator('#employeePasswordConfirm').fill(secret);await page.locator('#employeePasswordReview').check();if(await page.locator('#employeePasswordEmailApproval').isVisible())await page.locator('#employeePasswordConfirmEmail').check();ensure(await page.locator('#employeePasswordSave').isEnabled());await page.locator('#employeePasswordSave').click()}
    const settled=page=>page.evaluate(()=>window.fixturePasswordSubmission);

    let page=await ownerPage({width:1440,height:900});phase='responsive owner disclosure';
    const summary=page.locator('.header-more > summary');
    await summary.click();ensure(!await page.locator('#employeePasswordBtn').isVisible());
    for(const width of [1001,1440,1920]){
      await page.setViewportSize({width,height:900});ensure(await summary.isVisible());
      await summary.focus();await summary.press('Enter');ensure(await page.locator('#employeePasswordBtn').isVisible());
      const panel=await page.locator('.header-more-actions').boundingBox();ensure(panel&&panel.x>=0&&panel.y>=0&&panel.x+panel.width<=width&&panel.y+panel.height<=900);
      ensure(await page.locator('#signOutBtn').isVisible()&&await page.locator('#refreshLiveBtn').isVisible());
      await openEmployee(page);await page.locator('#employeePasswordClose').click();
      await summary.focus();await summary.press('Space');ensure(!await page.locator('#employeePasswordBtn').isVisible());
    }
    for(const width of [1000,760,390]){
      await page.setViewportSize({width,height:844});ensure(await page.locator('#mobileToolsToggle').isVisible());
      ensure(!await summary.isVisible());await page.locator('#mobileToolsToggle').click();await summary.click();
      ensure(await page.locator('#employeePasswordBtn').isVisible());await openEmployee(page);await page.locator('#employeePasswordClose').click();
      await summary.click();await page.locator('#mobileToolsToggle').click();ensure(!await summary.isVisible());
    }
    ensure(edgeCalls===0);report('Native owner desktop disclosure is keyboard and pointer accessible at 1001/1440/1920px; mobile parity at 1000/760/390px; opening or closing dispatches no protected command');

    page=await ownerPage();await openEmployee(page);phase='cancel before encryption module resolves';
    holdImport=gate();const importGate=holdImport;pauseGates.push(importGate);await choose(page,cancelledPassword);await bounded(importGate.reached);
    await page.locator('#employeePasswordClose').click();importGate.release();await settled(page);
    ensure(edgeCalls===0&&await page.locator('#employeePasswordNew').inputValue()===''&&await page.locator('#employeePasswordConfirm').inputValue()==='');
    report('Phone owner cancellation clears masked fields before any protected command or native password write');

    page=await ownerPage();await openEmployee(page);phase='native initial password through phone UI';
    ensure((await page.locator('#employeePasswordAction').textContent())==='Set initial password');await choose(page,initialPassword);await settled(page);
    ensure(edgeCalls===2&&(await page.locator('#employeePasswordStatus').textContent()).startsWith('Password updated.'));
    ensure(await passwordWorks(initialPassword));await expectPasswordRejected(employee.initialPassword);
    ensure(await page.locator('#employeePasswordNew').inputValue()===''&&await page.locator('#employeePasswordConfirm').inputValue()==='');
    report('Phone owner initial setup uses actual vendored JWE and native exact-UID password update without email');

    phase='native password reset through phone UI';await page.locator('#employeePasswordReload').click();await selectEmployee(page);ensure((await page.locator('#employeePasswordAction').textContent())==='Reset password');
    ensure(!await page.locator('#employeePasswordEmailApproval').isVisible());await choose(page,resetPassword);await settled(page);
    ensure(edgeCalls===4&&(await page.locator('#employeePasswordStatus').textContent()).startsWith('Password updated.'));
    ensure(await passwordWorks(resetPassword));await expectPasswordRejected(initialPassword);
    report('Phone owner reset changes only the existing native identity password and rejects its previous password');

    phase='native identity switch before prepare';await page.locator('#employeePasswordReload').click();await selectEmployee(page);
    const actor=await context.newPage();actor.setDefaultTimeout(15000);actor.on('pageerror',()=>{pageErrors++});await actor.goto(HUB+'/fixture-native-actor.html',{waitUntil:'domcontentloaded'});await actor.waitForFunction(()=>Boolean(window.nativeActor));
    holdCapability=gate();const capabilityGate=holdCapability;pauseGates.push(capabilityGate);await choose(page,cancelledPassword);await bounded(capabilityGate.reached);
    ensure(await actor.evaluate(async({email,password,uid})=>{try{const result=await nativeActor.auth.signInWithPassword({email,password});return !result.error&&result.data.user?.id===uid}catch{return false}},{email:employee.email,password:resetPassword,uid:employee.uid}));
    await page.waitForFunction(()=>!employeePasswordOpen&&document.getElementById('employeePasswordUsername').textContent==='');capabilityGate.release();await settled(page);
    ensure(edgeCalls===4&&await passwordWorks(resetPassword));await expectPasswordRejected(cancelledPassword);
    ensure(await page.locator('#employeePasswordNew').inputValue()===''&&await page.locator('#employeePasswordConfirm').inputValue()==='');
    report('Real native identity switch before prepare invalidates owner UI and prevents another protected password command');

    phase='non-owner disclosure';
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});ensure(await page.locator('.header-more > summary').isVisible());
      ensure(await page.locator('#employeePasswordBtn').evaluate(button=>button.hidden));
      ensure(!await page.locator('#employeePasswordBtn').isVisible());
    }
    report('After native identity switch, non-owner Employees remains hidden on desktop and phone even with More actions open');

    phase='final assertions';ensure(edgeCalls===4&&transportFailures===0&&unexpectedRequests===0&&pageErrors===0);
    report('All four custom requests contain ciphertext and public apikey only; native owner bearer and password sentinels are absent outside JWE');
  }catch{throw new EmployeeOwnerPasswordBrowserFailure(phase)}
  finally{ownerAccessToken='';for(const pause of pauseGates)pause.release();if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{})}
}
