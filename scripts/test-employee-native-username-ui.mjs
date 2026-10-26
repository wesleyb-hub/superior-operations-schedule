import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const auth=section("let authMode='login'",'// Invalidate local work before awaiting network logout;');
const flag=html.split(/\r?\n/).find(line=>line.startsWith('const EMPLOYEE_USERNAME_LOGIN_ENABLED='));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(config={employeeUsernameLoginEnabled:true},{markers=new Map()}={}){
 const nodes=new Map(),calls=[],pending=[],started=[],listeners=new Map(),scheduled=[],privateClients=[];let nativeUser=null,authHandler=null,recoveryUser=null,privateSequence=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,textContent:'',style:{},classList:{remove(){}},setAttribute(){},replaceChildren(){this.textContent=''},querySelector(){return null}});return nodes.get(id)};
 const user={id:'synthetic-existing-employee-uid',email:'sample-employee@company.example.invalid'};recoveryUser=user;
 const createPrivateClient=(url,key,options)=>{const captured=recoveryUser;const client={options,captured,updates:[],auth:{setSession:async()=>({data:{session:{user:captured}}}),getUser:async()=>({data:{user:captured}}),updateUser:async args=>{client.updates.push(args);return {data:{user:captured}}},signOut:async args=>{client.signedOut=args;return {}},dispose:async()=>{client.disposed=true}}};privateClients.push(client);calls.push(['private-client',options]);return client};
 const sb={auth:{
  signInWithPassword(args){calls.push(['sign-in',args]);return new Promise((resolve,reject)=>pending.push({resolve:async result=>{nativeUser=result.data?.session?.user||null;if(nativeUser&&authHandler)await authHandler('SIGNED_IN',{user:nativeUser});resolve(result)},reject}))},
  getUser:async()=>{calls.push(['get-user']);return {data:{user:nativeUser},error:null}},
  signOut:async args=>{calls.push(['sign-out',args]);nativeUser=null;if(authHandler)await authHandler('SIGNED_OUT',null);return {error:null}},
  onAuthStateChange(handler){authHandler=handler},
  getSession:async()=>{calls.push(['get-session']);return {data:{session:nativeUser?{user:nativeUser}:null}}},
  resetPasswordForEmail:async(...args)=>{calls.push(['reset-email',...args]);return {}},
  updateUser:async args=>{calls.push(['update-user',args]);return {}}
 },rpc:()=>{throw Error('Username entry must not perform a lookup or grant permissions')},functions:{invoke:()=>{throw Error('No password proxy')}}};
 const c={window:{SUPERIOR_CONFIG:config,supabase:{createClient:createPrivateClient},location:{origin:'https://hub.example.invalid',pathname:'/index.html'},matchMedia:()=>({matches:false}),addEventListener:(event,handler)=>listeners.set(event,handler)},location:{search:'',hash:'',href:'https://hub.example.invalid/index.html'},history:{replaceState(){}},document:{getElementById:node,querySelector:()=>({style:{},setAttribute(){}}),querySelectorAll:()=>[]},sessionStorage:{getItem:key=>markers.get(key)||null,setItem:(key,value)=>markers.set(key,value),removeItem:key=>markers.delete(key)},URL,URLSearchParams,Promise,clearTimeout,setTimeout:handler=>{scheduled.push(handler);return scheduled.length},crypto:{randomUUID:()=>`synthetic-isolated-client-${++privateSequence}`},SUPABASE_ANON_KEY:'synthetic-public-key',SUPABASE_URL:'https://synthetic-project.example.invalid',ALLOWED_EMAIL_DOMAIN:'company.example.invalid',sb,hubSessionEpoch:0,hubSessionLocked:false,currentUser:null,resetLocalSession(){c.hubSessionLocked=true;c.hubSessionEpoch++;c.currentUser=null;node('authBtn').authRequest=null;node('authBtn').disabled=false},startSession:async user=>{started.push(user);c.currentUser=user},fetch(){throw Error('No custom credential requests are permitted')}};
 vm.createContext(c);vm.runInContext(flag+'\n'+auth,c);
 vm.runInContext(html.split(/\r?\n/).filter(line=>line.startsWith("document.getElementById('forgotPasswordBtn').onclick=")||line.startsWith("document.getElementById('employeeLoginBtn').onclick=")||line.startsWith("window.addEventListener('pagehide'")).join('\n'),c);
 c.setAuthMode('employee-login');node('authUsername').value=' Sample-Employee ';node('authPassword').value='synthetic-private-password';
 return {c,node,nodes,calls,pending,started,user,sb,markers,listeners,mode:()=>vm.runInContext('authMode',c),busy:()=>c.employeeNativeAuthBusy(),nativeUser:()=>nativeUser,setNativeUser:u=>nativeUser=u,authHandler:()=>authHandler,privateClients,setRecoveryUser:u=>recoveryUser=u,scheduled,async flushScheduled(){while(scheduled.length)await scheduled.shift()()}};
}
const success=user=>({data:{session:{user}},error:null});
const recoverySession=user=>({user,access_token:'synthetic-recovery-access',refresh_token:'synthetic-recovery-refresh'});
async function completeLogin(f){const work=f.c.handleAuthSubmit();await f.pending.at(-1).resolve(success(f.user));await work;return work}
function bootstrapFixture(config,options){
 const f=fixture(config,options);
 Object.assign(f.c,{INVENTORY_REVIEW_MODE:false,ensureState(){},syncAllLinkedDeliveries(){},syncBilling(){},render(){},clone:value=>JSON.parse(JSON.stringify(value)),seed:{walls:[],jobs:[]},loadUiPrefs:()=>({}),remoteLoadToken:0,inventoryLoadToken:0,importReadToken:0,stateChannel:null,inventoryChannel:null,productionChannel:null,weeklyPlannerChannel:null,wallsInstallationChannel:null,weeklyPlannerRefreshTimer:null,wallsInstallationReloadTimer:null,inventoryToastTimer:null});
 vm.runInContext(section('function resetLocalSession(){','function updateAccessStatus('),f.c);
 vm.runInContext(section('async function bootstrap(){','\nbootstrap();'),f.c);
 return f;
}

test('missing, false, or truthy nonboolean flag keeps employee login unavailable',async()=>{
 for(const config of [undefined,{}, {employeeUsernameLoginEnabled:false},{employeeUsernameLoginEnabled:'true'},{employeeUsernameLoginEnabled:1}]){
  const f=fixture(config===undefined?null:config);assert.equal(f.mode(),'login');assert.equal(f.node('employeeLoginBtn').hidden,true);assert.equal(f.node('authUsernameGroup').hidden,true);await f.c.handleEmployeeNativeAuthSubmit();assert.equal(f.calls.length,0);
 }
});
test('opt-in employee mode uses owner-assigned username and owner-assisted recovery only',()=>{
 const f=fixture();assert.equal(f.node('authEmailGroup').hidden,true);assert.equal(f.node('authUsernameGroup').hidden,false);assert.match(f.node('authDescription').textContent,/username assigned by your owner/);f.node('forgotPasswordBtn').onclick();assert.match(f.node('authMessage').textContent,/Ask your owner/);assert.equal(f.node('authPassword').value,'');assert.equal(f.mode(),'employee-login');assert.equal(f.calls.length,0);
});
test('normalizes ASCII username and sends password directly to native Auth without lookup',async()=>{
 const f=fixture(),work=f.c.handleAuthSubmit();assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'sign-in');assert.equal(f.calls[0][1].email,'sample-employee@company.example.invalid');assert.equal(f.calls[0][1].password,'synthetic-private-password');assert.equal(f.node('authPassword').value,'');assert.equal(f.c.hubSessionLocked,true);assert.equal(f.c.employeeNativeInstallPending(),true);
 await f.pending[0].resolve(success(f.user));await work;assert.equal(f.started.length,1);assert.equal(f.started[0],f.user);assert.equal(f.started[0].id,'synthetic-existing-employee-uid');assert.equal(f.c.hubSessionLocked,false);assert.equal(f.c.employeeNativeInstallPending(),false);assert.equal(f.busy(),false);
});
test('username validation rejects controls, Unicode, emails, invalid shape and length without Auth traffic',async()=>{
 for(const input of ['ab','1abc','_abc','jade@example.invalid','ja de','jade\n','\tjade','j\u0000ade','j\u007fade','jádé','ｊade','\u00a0jade','a'.repeat(33)]){const f=fixture();f.node('authUsername').value=input;await f.c.handleAuthSubmit();assert.equal(f.calls.length,0,input);assert.equal(f.node('authPassword').value,'');assert.match(f.node('authMessage').textContent,/assigned username/)}
 for(const input of ['abc','A_1.-','a'.repeat(32)]){const f=fixture();f.node('authUsername').value=input;const work=f.c.handleAuthSubmit();assert.equal(f.calls[0][1].email,input.toLowerCase()+'@company.example.invalid');await f.pending[0].resolve({error:{message:'synthetic'}});await work}
});
test('missing password does not contact native Auth',async()=>{const f=fixture();f.node('authPassword').value='';await f.c.handleAuthSubmit();assert.equal(f.calls.length,0);assert.match(f.node('authMessage').textContent,/Enter your password/)});
test('existing administrator email sign-in and email reset remain direct and independent',async()=>{
 for(const enabled of [false,true]){const f=fixture({employeeUsernameLoginEnabled:enabled});f.c.setAuthMode('login');f.node('authEmail').value=' OWNER@COMPANY.EXAMPLE.INVALID ';f.node('authPassword').value='synthetic-admin-password';const work=f.c.handleAuthSubmit();assert.equal(f.calls[0][1].email,'owner@company.example.invalid');const user={id:'synthetic-owner-uid',email:'owner@company.example.invalid'};await f.pending[0].resolve(success(user));await work;assert.equal(f.started[0],user);assert.equal(f.markers.size,0);f.c.setAuthMode('forgot');await f.c.handleAuthSubmit();assert.equal(f.calls.at(-1)[0],'reset-email');assert.equal(f.calls.at(-1)[1],'owner@company.example.invalid')}
});
test('existing administrator domain check stays enforced at submit',async()=>{const f=fixture();f.c.setAuthMode('login');f.node('authEmail').value='outside@example.invalid';f.node('authPassword').value='synthetic';await f.c.handleAuthSubmit();assert.equal(f.calls.length,0);assert.match(f.node('authMessage').textContent,/work email/)});
test('invalid account, wrong password, throttling and thrown transport use the same generic error',async()=>{
 const messages=[];for(const detail of ['unknown account','wrong password','rate limited','transport']){const f=fixture(),work=f.c.handleAuthSubmit();if(detail==='transport')f.pending[0].reject(Error('private '+detail));else await f.pending[0].resolve({error:{message:'private '+detail}});await work;messages.push(f.node('authMessage').textContent);assert.equal(f.started.length,0);assert.equal(f.nativeUser(),null);assert.equal(f.c.hubSessionLocked,true);assert.equal(f.c.employeeNativeInstallPending(),false);assert.equal(f.calls.filter(x=>x[0]==='sign-out').length,1);assert.equal(f.node('authPassword').value,'')}
 assert.equal(new Set(messages).size,1);assert.match(messages[0],/ask your owner/);assert.doesNotMatch(messages[0],/private|unknown account|rate limited/);
});
test('returned native identity requires existing UID, expected email and non-anonymous user',async()=>{
 for(const user of [null,{}, {email:'sample-employee@company.example.invalid'},{id:'synthetic-existing-employee-uid'},{id:'wrong-identity',email:'other@company.example.invalid'},{id:'synthetic-existing-employee-uid',email:'sample-employee@company.example.invalid',is_anonymous:true}]){const f=fixture(),work=f.c.handleAuthSubmit();await f.pending[0].resolve(success(user));await work;assert.equal(f.started.length,0);assert.equal(f.nativeUser(),null);assert.equal(f.c.hubSessionLocked,true);assert.equal(f.calls.some(x=>x[0]==='get-user'),false)}
});
test('getUser independently verifies same UID and derived email before loading any workspace',async()=>{
 for(const user of [{id:'different',email:'sample-employee@company.example.invalid'},{id:'synthetic-existing-employee-uid',email:'other@company.example.invalid'},{id:'synthetic-existing-employee-uid',email:'sample-employee@company.example.invalid',is_anonymous:true},null]){const f=fixture();f.sb.auth.getUser=async()=>({data:{user}});const work=f.c.handleAuthSubmit();await f.pending[0].resolve(success(f.user));await work;assert.equal(f.started.length,0);assert.equal(f.nativeUser(),null);assert.equal(f.c.hubSessionLocked,true)}
});
test('repeated submissions and mode switches cannot compete with a pending native write',async()=>{
 const f=fixture(),work=f.c.handleAuthSubmit();await f.c.handleAuthSubmit();f.c.setAuthMode('login');assert.equal(f.mode(),'employee-login');assert.equal(f.pending.length,1);assert.equal(f.node('authBtn').disabled,true);await f.pending[0].resolve(success(f.user));await work;assert.equal(f.started.length,1);
});
test('unreliable marker storage fails before Auth can persist a session',async()=>{
 for(const mode of ['throw','silent']){const f=fixture();f.c.sessionStorage.setItem=()=>{if(mode==='throw')throw Error('synthetic storage denied')};await f.c.handleAuthSubmit();assert.equal(f.calls.length,0);assert.equal(f.started.length,0);assert.equal(f.node('authPassword').value,'');assert.equal(f.c.hubSessionLocked,true);assert.equal(f.busy(),false)}
});
test('logout during native sign-in fences late SDK persistence and compensates only after it settles',async()=>{
 const f=bootstrapFixture();const work=f.c.handleAuthSubmit();await f.c.signOut();assert.equal(f.c.currentUser,null);assert.equal(f.c.employeeNativeInstallPending(),true);assert.equal(f.busy(),true);await f.pending[0].resolve(success(f.user));await work;assert.equal(f.nativeUser(),null);assert.equal(f.started.length,0);assert.equal(f.c.hubSessionLocked,true);assert.equal(f.c.employeeNativeInstallPending(),false);assert.equal(f.calls.at(-1)[1].scope,'local');
});
test('SDK SIGNED_IN is held before result verification and SIGNED_OUT invalidates in-flight employee login',async()=>{
 const f=bootstrapFixture();await f.c.bootstrap();f.c.setAuthMode('employee-login');f.node('authPassword').value='synthetic';const work=f.c.handleAuthSubmit();await f.authHandler()('SIGNED_IN',{user:f.user});assert.equal(f.started.length,0);await f.authHandler()('SIGNED_OUT',null);await f.pending[0].resolve(success(f.user));await work;assert.equal(f.started.length,0);assert.equal(f.nativeUser(),null);assert.equal(f.c.hubSessionLocked,true);
});
test('pagehide clears credentials and invalidates pending native result',async()=>{
 const f=fixture(),work=f.c.handleAuthSubmit();f.node('authPassword').value='typed-after-request';f.listeners.get('pagehide')();assert.equal(f.node('authPassword').value,'');await f.pending[0].resolve(success(f.user));await work;assert.equal(f.started.length,0);assert.equal(f.nativeUser(),null);assert.equal(f.c.employeeNativeInstallPending(),false);
});
test('pending getUser or workspace load cannot revive a logged-out session',async()=>{
 for(const phase of ['verification','workspace']){const f=bootstrapFixture();let release;if(phase==='verification')f.sb.auth.getUser=()=>new Promise(resolve=>release=()=>resolve({data:{user:f.user}}));else f.c.startSession=async user=>{f.c.currentUser=user;await new Promise(resolve=>release=resolve)};const work=f.c.handleAuthSubmit();await f.pending[0].resolve(success(f.user));await tick();assert.equal(typeof release,'function');await f.c.signOut();release();await work;assert.equal(f.c.currentUser,null);assert.equal(f.nativeUser(),null);assert.equal(f.c.hubSessionLocked,true);assert.equal(f.c.employeeNativeInstallPending(),false)}
});
test('cleanup failure retains marker, blocks all login and exposes deliberate Retry Sign Out',async()=>{
 const f=bootstrapFixture();f.sb.auth.signOut=async()=>({error:{message:'synthetic offline'}});const work=f.c.handleAuthSubmit();f.c.resetLocalSession();await f.pending[0].resolve(success(f.user));await work;assert.equal(f.c.employeeNativeInstallPending(),true);assert.equal(f.busy(),true);assert.equal(f.node('retrySignOutBtn').hidden,false);f.c.setAuthMode('login');await f.c.handleAuthSubmit();assert.equal(f.pending.length,1);assert.equal(f.c.currentUser,null);
 f.sb.auth.signOut=async()=>{f.setNativeUser(null);return {}};await f.c.signOut();assert.equal(f.c.employeeNativeInstallPending(),false);assert.equal(f.busy(),false);assert.equal(f.mode(),'login');assert.equal(f.node('authBtn').disabled,false);
});
test('interrupted reload clears retained session before bootstrap and keeps listener for later SIGNED_OUT',async()=>{
 const f=bootstrapFixture();f.c.setEmployeeNativeInstallPending(true);f.setNativeUser(f.user);await f.c.bootstrap();assert.equal(f.nativeUser(),null);assert.equal(f.c.employeeNativeInstallPending(),false);assert.equal(f.calls.some(x=>x[0]==='get-session'),false);assert.equal(typeof f.authHandler(),'function');assert.equal(f.started.length,0);
 f.c.setAuthMode('employee-login');f.node('authPassword').value='synthetic';await completeLogin(f);f.c.inventoryItems=[{id:'synthetic-private-cache'}];f.c.state.walls=[{id:'synthetic-private-wall'}];f.node('view').textContent='synthetic workspace';await f.authHandler()('SIGNED_OUT',null);assert.equal(f.c.currentUser,null);assert.equal(f.c.inventoryItems.length,0);assert.equal(f.c.state.walls.length,0);assert.equal(f.node('view').textContent,'');
});
test('failed interrupted cleanup never restores retained native events but listener remains registered',async()=>{
 const f=bootstrapFixture();f.c.setEmployeeNativeInstallPending(true);f.setNativeUser(f.user);f.sb.auth.signOut=async()=>({error:{message:'synthetic offline'}});await f.c.bootstrap();assert.equal(typeof f.authHandler(),'function');assert.equal(f.calls.some(x=>x[0]==='get-session'),false);for(const event of ['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED','PASSWORD_RECOVERY'])await f.authHandler()(event,{user:f.user});assert.equal(f.started.length,0);assert.equal(f.c.currentUser,null);assert.equal(f.c.employeeNativeInstallPending(),true);assert.equal(f.node('retrySignOutBtn').hidden,false);
});
test('feature-off bootstrap restores ordinary administrator session with no employee cleanup',async()=>{const f=bootstrapFixture({employeeUsernameLoginEnabled:false});const user={id:'synthetic-owner',email:'owner@company.example.invalid'};f.setNativeUser(user);await f.c.bootstrap();assert.equal(f.started[0],user);assert.equal(f.calls.filter(x=>x[0]==='sign-out').length,0);assert.equal(typeof f.authHandler(),'function')});
test('completed employee mode transitions and pagehide clear only credential fields',()=>{const f=fixture();f.node('authNewPassword').value='synthetic-new';f.node('authConfirmPassword').value='synthetic-new';f.c.setAuthMode('login');for(const id of ['authPassword','authNewPassword','authConfirmPassword'])assert.equal(f.node(id).value,'');assert.equal(f.node('authUsername').value,' Sample-Employee ')});
test('source retains domain/backend authorization and contains no credential proxy, account creation or permission grant',()=>{
 const start=section('async function startSession(user){','let state=');assert.match(start,/if\(!authAllowed\(email\)\)/);assert.match(start,/await loadCurrentAccess\(user\)/);assert.doesNotMatch(start,/username|EMPLOYEE/);assert.doesNotMatch(auth,/employee-access|fetch\(|\.rpc\(|\.functions\.|signUp\(|createUser\(|admin\.|localStorage|console\.|document\.cookie/);assert.match(auth,/sessionStorage.setItem\(EMPLOYEE_NATIVE_PENDING_KEY,'pending'\)/);assert.doesNotMatch(auth,/currentUserCanWrite\s*=|currentUserIsAdmin\s*=|currentAllowedViews\s*=/);const releasedConfig={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../config.js',import.meta.url),'utf8'),releasedConfig);assert.equal(releasedConfig.window.SUPERIOR_CONFIG.employeeUsernameLoginEnabled,true);
});

test('bootstrap registers native recovery listener before its first asynchronous boundary when no marker exists',async()=>{
 const f=bootstrapFixture({employeeUsernameLoginEnabled:false});let listenerRegistered=false;
 f.sb.auth.onAuthStateChange=handler=>{listenerRegistered=true;handler('PASSWORD_RECOVERY',recoverySession({id:'synthetic-owner',email:'owner@company.example.invalid'}))};
 const boot=f.c.bootstrap();assert.equal(listenerRegistered,true);assert.equal(f.mode(),'recovery');await boot;assert.equal(f.started.length,0);assert.equal(f.node('authEmail').value,'owner@company.example.invalid');
});
test('bootstrap fences events during pending cleanup and keeps recovery events usable after cleanup settles',async()=>{
 const f=bootstrapFixture();f.c.setEmployeeNativeInstallPending(true);let finish;
 f.sb.auth.signOut=()=>new Promise(resolve=>finish=()=>resolve({}));const boot=f.c.bootstrap();assert.equal(typeof f.authHandler(),'function');
 await f.authHandler()('PASSWORD_RECOVERY',{user:f.user});await f.authHandler()('INITIAL_SESSION',{user:f.user});assert.equal(f.mode(),'login');assert.equal(f.started.length,0);
 finish();await boot;await f.authHandler()('PASSWORD_RECOVERY',recoverySession({id:'synthetic-owner',email:'owner@company.example.invalid'}));assert.equal(f.mode(),'recovery');assert.equal(f.started.length,0);
});

test('workspace initialization failure clears native persistence and leaves the gate locked',async()=>{
 const f=fixture();f.c.startSession=async()=>{throw Error('synthetic private load failure')};const work=f.c.handleAuthSubmit();await f.pending[0].resolve(success(f.user));await work;assert.equal(f.nativeUser(),null);assert.equal(f.c.currentUser,null);assert.equal(f.c.hubSessionLocked,true);assert.equal(f.c.employeeNativeInstallPending(),false);assert.match(f.node('authMessage').textContent,/Sign-in could not be confirmed/);assert.doesNotMatch(f.node('authMessage').textContent,/private load/);
});
test('fresh page instance with an interrupted marker cannot restore the previous native session',async()=>{
 const previous=fixture();previous.c.setEmployeeNativeInstallPending(true);const fresh=bootstrapFixture({employeeUsernameLoginEnabled:true},{markers:previous.markers});fresh.setNativeUser(previous.user);await fresh.c.bootstrap();assert.equal(fresh.nativeUser(),null);assert.equal(fresh.started.length,0);assert.equal(fresh.c.employeeNativeInstallPending(),false);assert.equal(fresh.calls.some(call=>call[0]==='get-session'),false);assert.equal(typeof fresh.authHandler(),'function');
});

test('unreadable marker fails closed with retained native session even after feature is turned off, then deliberate recovery succeeds',async()=>{
 const f=bootstrapFixture({employeeUsernameLoginEnabled:false});f.c.setEmployeeNativeInstallPending(true);f.setNativeUser(f.user);const get=f.c.sessionStorage.getItem;
 f.c.sessionStorage.getItem=()=>{throw Error('synthetic storage unavailable')};await f.c.bootstrap();assert.equal(f.c.employeeNativeInstallPending(),null);assert.equal(f.nativeUser(),null);assert.equal(f.c.currentUser,null);assert.equal(f.started.length,0);assert.equal(f.busy(),true);assert.equal(f.node('retrySignOutBtn').hidden,false);assert.equal(f.calls.some(call=>call[0]==='get-session'),false);
 await f.authHandler()('SIGNED_IN',{user:f.user});assert.equal(f.started.length,0);f.node('authEmail').value='owner@company.example.invalid';f.node('authPassword').value='synthetic-admin';await f.c.handleAuthSubmit();assert.equal(f.pending.length,0);
 f.c.sessionStorage.getItem=get;await f.c.signOut();assert.equal(f.c.employeeNativeInstallPending(),false);assert.equal(f.busy(),false);assert.equal(f.mode(),'login');
 f.node('authPassword').value='synthetic-admin';const work=f.c.handleAuthSubmit();const owner={id:'synthetic-owner',email:'owner@company.example.invalid'};await f.pending[0].resolve(success(owner));await work;assert.equal(f.started[0],owner);
});
test('marker deletion must succeed and verify absent before interrupted recovery is released',async()=>{
 for(const mode of ['throw','silent','readback']){const f=bootstrapFixture();f.c.setEmployeeNativeInstallPending(true);f.setNativeUser(f.user);const remove=f.c.sessionStorage.removeItem,get=f.c.sessionStorage.getItem;
  f.c.sessionStorage.removeItem=key=>{if(mode==='throw')throw Error('synthetic delete denied');if(mode==='readback'){remove(key);f.c.sessionStorage.getItem=()=>{throw Error('synthetic read denied')}}};
  await f.c.bootstrap();assert.equal(f.nativeUser(),null);assert.equal(f.started.length,0);assert.equal(f.busy(),true);assert.equal(f.node('retrySignOutBtn').hidden,false);await f.c.handleAuthSubmit();assert.equal(f.pending.length,0);
  f.c.sessionStorage.removeItem=remove;f.c.sessionStorage.getItem=get;await f.c.signOut();assert.equal(f.c.employeeNativeInstallPending(),false);assert.equal(f.busy(),false);
 }
});
test('malformed pending marker is unresolved rather than proof of a safe retained session',async()=>{
 const f=bootstrapFixture();f.c.setEmployeeNativeInstallPending(true);for(const key of f.markers.keys())f.markers.set(key,'unknown');f.setNativeUser(f.user);assert.equal(f.c.employeeNativeInstallPending(),null);await f.c.bootstrap();assert.equal(f.nativeUser(),null);assert.equal(f.started.length,0);assert.equal(f.c.employeeNativeInstallPending(),false);
});

test('bootstrap honors captured uncertainty even if a one-shot storage failure disappears before cleanup',async()=>{
 const f=bootstrapFixture({employeeUsernameLoginEnabled:false});f.setNativeUser(f.user);const get=f.c.sessionStorage.getItem;let first=true;
 f.c.sessionStorage.getItem=key=>{if(first){first=false;throw Error('synthetic transient read failure')}return get(key)};
 await f.c.bootstrap();assert.equal(f.calls.filter(call=>call[0]==='sign-out').length,1);assert.equal(f.nativeUser(),null);assert.equal(f.started.length,0);assert.equal(f.busy(),false);assert.equal(f.c.employeeNativeInstallPending(),false);assert.equal(f.node('retrySignOutBtn').hidden,true);assert.equal(f.calls.some(call=>call[0]==='get-session'),false);
});

async function recoveryFixture(){const f=bootstrapFixture();await f.c.bootstrap();f.setNativeUser(f.user);await f.authHandler()('PASSWORD_RECOVERY',recoverySession(f.user));return f}
function fillRecovery(f,password='synthetic-private-recovery-password'){f.node('authNewPassword').value=password;f.node('authConfirmPassword').value=password}
test('recovery binds the captured native identity in an isolated client and clears shared persistence before login',async()=>{
 const f=await recoveryFixture();assert.equal(f.mode(),'recovery');assert.equal(f.node('authEmail').readOnly,true);assert.equal(f.c.employeeNativeInstallPending(),true);fillRecovery(f);f.node('authEmail').value='different@company.example.invalid';await f.c.handleAuthSubmit();
 assert.equal(f.privateClients.length,1);const isolated=f.privateClients[0];assert.equal(isolated.captured.id,f.user.id);assert.equal(isolated.updates.length,1);assert.equal(isolated.options.auth.persistSession,false);assert.equal(isolated.options.auth.autoRefreshToken,false);assert.equal(isolated.options.auth.detectSessionInUrl,false);assert.match(isolated.options.auth.storageKey,/superior-private-recovery-/);assert.equal(isolated.signedOut.scope,'local');assert.equal(isolated.disposed,true);assert.equal(f.calls.some(call=>call[0]==='update-user'),false);assert.equal(f.calls.filter(call=>call[0]==='sign-out').at(-1)[1].scope,'local');assert.equal(f.nativeUser(),null);assert.equal(f.mode(),'login');assert.equal(f.c.employeeNativeInstallPending(),false);assert.match(f.node('authMessage').textContent,/Password saved/);assert.equal(vm.runInContext('recoveryIdentity',f.c),null);for(const id of ['authNewPassword','authConfirmPassword'])assert.equal(f.node(id).value,'');
});
test('entering recovery clears previously cached workspace before showing private setup',async()=>{
 const f=bootstrapFixture();await f.c.bootstrap();f.c.currentUser={id:'previous-user'};f.c.inventoryItems=[{id:'previous-private-item'}];f.c.state={walls:[{id:'previous-private-wall'}]};f.node('view').textContent='previous private workspace';await f.authHandler()('PASSWORD_RECOVERY',recoverySession(f.user));assert.equal(f.c.currentUser,null);assert.equal(f.c.inventoryItems.length,0);assert.equal(f.c.state.walls.length,0);assert.equal(f.node('view').textContent,'');assert.equal(f.c.hubSessionLocked,true);
});
test('different-user event before recovery submit clears binding and never changes either password',async()=>{
 const f=await recoveryFixture();fillRecovery(f);const other={id:'synthetic-other',email:'other@company.example.invalid'};f.setNativeUser(other);const before=f.calls.filter(call=>call[0]==='sign-out').length;await f.authHandler()('SIGNED_IN',{user:other});assert.equal(f.calls.filter(call=>call[0]==='sign-out').length,before,'callback must not take Auth lock');assert.equal(vm.runInContext('recoveryIdentity',f.c),null);assert.equal(f.node('authNewPassword').value,'');await f.c.handleAuthSubmit();assert.equal(f.privateClients.length,0);await f.flushScheduled();assert.equal(f.nativeUser(),null);assert.equal(f.mode(),'login');assert.equal(f.c.employeeNativeInstallPending(),false);
});
test('different-user event while private session installation is pending prevents password update and compensates',async()=>{
 const f=await recoveryFixture();let finish;const create=f.c.window.supabase.createClient;f.c.window.supabase.createClient=(...args)=>{const c=create(...args);c.auth.setSession=()=>new Promise(resolve=>finish=()=>resolve(success(f.user)));return c};fillRecovery(f);const work=f.c.handleAuthSubmit();const other={id:'synthetic-other',email:'other@company.example.invalid'};f.setNativeUser(other);await f.authHandler()('SIGNED_IN',{user:other});finish();await work;assert.equal(f.privateClients[0].updates.length,0);assert.equal(f.nativeUser(),null);assert.equal(f.c.employeeNativeInstallPending(),false);assert.doesNotMatch(f.node('authMessage').textContent,/Password saved/);
});
test('different-user event after password request creation cannot retarget the isolated request',async()=>{
 const f=await recoveryFixture();let finish;const create=f.c.window.supabase.createClient;f.c.window.supabase.createClient=(...args)=>{const c=create(...args);c.auth.updateUser=args=>{c.updates.push(args);return new Promise(resolve=>finish=()=>resolve({data:{user:c.captured}}))};return c};fillRecovery(f);const work=f.c.handleAuthSubmit();await tick();assert.equal(typeof finish,'function');const other={id:'synthetic-other',email:'other@company.example.invalid'};f.setNativeUser(other);await f.authHandler()('SIGNED_IN',{user:other});finish();await work;assert.equal(f.privateClients[0].captured.id,f.user.id);assert.equal(f.privateClients[0].updates.length,1);assert.equal(f.calls.some(call=>call[0]==='update-user'),false);assert.equal(f.nativeUser(),null,'conservative cleanup may log out newer session');assert.equal(f.c.currentUser,null);assert.equal(f.c.employeeNativeInstallPending(),false);assert.doesNotMatch(f.node('authMessage').textContent,/Password saved/);
});
test('Back cancels recovery outside the Auth callback and clears its credentials and persistence',async()=>{
 const f=await recoveryFixture();fillRecovery(f);f.c.setAuthMode('login');assert.equal(vm.runInContext('recoveryIdentity',f.c),null);assert.equal(f.node('authNewPassword').value,'');assert.equal(f.scheduled.length,1);await f.flushScheduled();assert.equal(f.nativeUser(),null);assert.equal(f.mode(),'login');assert.equal(f.c.employeeNativeInstallPending(),false);
});
test('logout during recovery is local, invalidates captured identity, and cannot be followed by a stale update',async()=>{
 const f=await recoveryFixture();fillRecovery(f);await f.c.signOut();assert.equal(f.calls.filter(call=>call[0]==='sign-out').at(-1)[1].scope,'local');assert.equal(vm.runInContext('recoveryIdentity',f.c),null);assert.equal(f.nativeUser(),null);await f.c.handleRecoveryAuthSubmit();assert.equal(f.privateClients.length,0);assert.equal(f.c.employeeNativeInstallPending(),false);
});
test('recovery validates captured domain and non-anonymous identity before creating a private client',async()=>{
 for(const user of [{id:'synthetic',email:'outside@example.invalid'},{id:'synthetic',email:'inside@company.example.invalid',is_anonymous:true},{email:'inside@company.example.invalid'}]){const f=bootstrapFixture();await f.c.bootstrap();await f.authHandler()('PASSWORD_RECOVERY',recoverySession(user));fillRecovery(f);await f.c.handleAuthSubmit();await f.flushScheduled();assert.equal(f.privateClients.length,0);assert.equal(vm.runInContext('recoveryIdentity',f.c),null);assert.equal(f.c.hubSessionLocked,true)}
});
test('private native verification rejects mismatched UID or email before password mutation',async()=>{
 for(const stage of ['install','verify'])for(const user of [{id:'different',email:'sample-employee@company.example.invalid'},{id:'synthetic-existing-employee-uid',email:'different@company.example.invalid'},{id:'synthetic-existing-employee-uid',email:'sample-employee@company.example.invalid',is_anonymous:true}]){const f=await recoveryFixture();const create=f.c.window.supabase.createClient;f.c.window.supabase.createClient=(...args)=>{const c=create(...args);if(stage==='install')c.auth.setSession=async()=>success(user);else c.auth.getUser=async()=>({data:{user}});return c};fillRecovery(f);await f.c.handleAuthSubmit();assert.equal(f.privateClients[0].updates.length,0);assert.equal(f.nativeUser(),null);assert.equal(f.c.employeeNativeInstallPending(),false);assert.match(f.node('authMessage').textContent,/could not be confirmed/)}
});
test('native recovery errors are generic and still clean shared native persistence',async()=>{
 const f=await recoveryFixture();const create=f.c.window.supabase.createClient;f.c.window.supabase.createClient=(...args)=>{const c=create(...args);c.auth.updateUser=async()=>({error:{message:'private native password detail'}});return c};fillRecovery(f);await f.c.handleAuthSubmit();assert.equal(f.nativeUser(),null);assert.equal(f.c.employeeNativeInstallPending(),false);assert.match(f.node('authMessage').textContent,/could not be confirmed/);assert.doesNotMatch(f.node('authMessage').textContent,/private native/);assert.equal(vm.runInContext('recoveryIdentity',f.c),null);
});
test('recovery cleanup failure retains nonsecret fence and lock for reload until deliberate cleanup succeeds',async()=>{
 const f=await recoveryFixture();f.sb.auth.signOut=async()=>({error:{message:'synthetic offline'}});fillRecovery(f);await f.c.handleAuthSubmit();assert.equal(f.c.employeeNativeInstallPending(),true);assert.equal(f.busy(),true);assert.equal(f.node('retrySignOutBtn').hidden,false);assert.equal(vm.runInContext('recoveryIdentity',f.c),null);assert.equal(f.mode(),'recovery');assert.doesNotMatch(f.node('authMessage').textContent,/Password saved/);
 const fresh=bootstrapFixture({employeeUsernameLoginEnabled:false},{markers:f.markers});fresh.setNativeUser(f.user);await fresh.c.bootstrap();assert.equal(fresh.nativeUser(),null);assert.equal(fresh.started.length,0);assert.equal(fresh.c.employeeNativeInstallPending(),false);
});
test('recovery storage failure prevents password mutation; no credentials are stored in the cleanup marker',async()=>{
 const f=await recoveryFixture();assert.deepEqual([...f.markers.values()],['pending']);f.c.sessionStorage.setItem=()=>{throw Error('synthetic storage unavailable')};fillRecovery(f);await f.c.handleAuthSubmit();assert.equal(f.privateClients.length,0);assert.equal(f.nativeUser(),null);assert.equal(vm.runInContext('recoveryIdentity',f.c),null);
});
test('each isolated recovery attempt has its own lock namespace and validation-only errors clear password inputs',async()=>{
 const f=await recoveryFixture();fillRecovery(f,'short');await f.c.handleAuthSubmit();assert.equal(f.privateClients.length,0);assert.equal(f.node('authNewPassword').value,'');fillRecovery(f);await f.c.handleAuthSubmit();const first=f.privateClients[0].options.auth.storageKey;f.setNativeUser(f.user);await f.authHandler()('PASSWORD_RECOVERY',recoverySession(f.user));fillRecovery(f);await f.c.handleAuthSubmit();assert.notEqual(f.privateClients[1].options.auth.storageKey,first);
});

test('pagehide discards recovery token references and cannot leave a resumed page able to reuse the old binding',async()=>{
 const f=await recoveryFixture();fillRecovery(f);f.listeners.get('pagehide')();assert.equal(vm.runInContext('recoveryIdentity',f.c),null);assert.equal(f.node('authNewPassword').value,'');assert.equal(f.c.employeeNativeInstallPending(),true);await f.c.handleRecoveryAuthSubmit();assert.equal(f.privateClients.length,0);await f.flushScheduled();assert.equal(f.nativeUser(),null);assert.equal(f.c.employeeNativeInstallPending(),false);
});
test('logout while an isolated password update is pending invalidates UI ownership without changing its target',async()=>{
 const f=await recoveryFixture();let finish;const create=f.c.window.supabase.createClient;f.c.window.supabase.createClient=(...args)=>{const c=create(...args);c.auth.updateUser=args=>{c.updates.push(args);return new Promise(resolve=>finish=()=>resolve({data:{user:c.captured}}))};return c};fillRecovery(f);const work=f.c.handleAuthSubmit();await tick();await f.c.signOut();assert.equal(vm.runInContext('recoveryIdentity',f.c),null);finish();await work;assert.equal(f.privateClients[0].captured.id,f.user.id);assert.equal(f.nativeUser(),null);assert.equal(f.c.currentUser,null);assert.equal(f.c.employeeNativeInstallPending(),false);assert.doesNotMatch(f.node('authMessage').textContent,/Password saved/);
});
