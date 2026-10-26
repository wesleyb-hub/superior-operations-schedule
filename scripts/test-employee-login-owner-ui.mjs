import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../employee-access-owner.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({enabled=true}={}){
 const nodes=new Map(),calls=[],pending=[],windowHandlers={},documentHandlers={},timers=[];let authHandler,session={access_token:'synthetic-owner-token',user:{id:'synthetic-owner'}},verified={id:'synthetic-owner'};
 function node(id){if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,checked:false,textContent:'',style:{},handlers:{},addEventListener(name,fn){this.handlers[name]=fn},replaceChildren(...options){this.options=options;this.value=options[0]?.value||''}});return nodes.get(id)}
 node('ownerCodePanel').hidden=true;node('ownerIssueForm').hidden=true;
 const client={auth:{async getSession(){return {data:{session},error:null}},async getUser(){return {data:{user:verified},error:null}},onAuthStateChange(fn){authHandler=fn}}};
 const c={window:{SUPERIOR_CONFIG:{employeeUsernameLoginEnabled:enabled,supabaseUrl:'https://employee-demo.invalid',supabaseAnonKey:'synthetic-publishable'},supabase:{createClient(){calls.push(['createClient']);return client}},addEventListener:(name,fn)=>windowHandlers[name]=fn},document:{hidden:false,getElementById:node,createElement:()=>({}),addEventListener:(name,fn)=>documentHandlers[name]=fn},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},AbortController,Date,JSON,Promise,fetch:(url,options)=>{calls.push(['fetch',url,JSON.parse(options.body),options]);return new Promise((resolve,reject)=>pending.push({resolve,reject}))}};
 vm.createContext(c);vm.runInContext(source,c);
 return {c,node,nodes,calls,pending,timers,windowHandlers,documentHandlers,auth:()=>authHandler,setSession:(s,u=s?.user)=>{session=s;verified=u},submit:()=>node('ownerIssueForm').handlers.submit({preventDefault(){}})};
}
const okay=data=>({ok:true,json:async()=>data});
async function ready(){const f=fixture();await tick();f.pending[0].resolve(okay({employees:[{username:'sample-employee',user_id:'synthetic-employee',status:'active',enabled:true}]}));await tick();return f}
const issued=()=>({username:'sample-employee',code:'DEMO-ONLY-CODE-HERE',expires_at:new Date(Date.now()+600000).toISOString()});
test('owner helper feature disabled does not initialize Auth or call network',async()=>{const f=fixture({enabled:false});await tick();assert.equal(f.calls.length,0);assert.equal(f.node('ownerIssueForm').hidden,true);assert.match(f.node('ownerMessage').textContent,/not enabled/)});
test('owner list requires verified bearer user and no implicit writer capability',async()=>{const f=await ready();assert.equal(f.calls[1][2].action,'owner-list');assert.equal(f.calls[1][3].headers.Authorization,'Bearer synthetic-owner-token');assert.equal(f.node('ownerIssueForm').hidden,false);assert.equal(f.node('ownerEmployee').value,'sample-employee');assert.equal(f.node('ownerCodePanel').hidden,true);assert.doesNotMatch(source,/can_write|is_operations_admin|app_user_roles/)});
test('unverified owner session cannot enumerate employees',async()=>{const f=fixture();f.setSession({access_token:'synthetic-owner-token',user:{id:'one'}},{id:'another'});await tick();assert.equal(f.pending.length,0);assert.equal(f.node('ownerIssueForm').hidden,true);assert.match(f.node('ownerMessage').textContent,/could not be confirmed/)});
test('owner denial keeps issue controls and employee mapping hidden',async()=>{const f=fixture();await tick();f.pending[0].resolve({ok:false});await tick();assert.equal(f.node('ownerIssueForm').hidden,true);assert.equal(f.node('ownerReload').hidden,true);assert.equal(f.node('ownerCodePanel').hidden,true)});
test('issuing code is explicit, duplicate blocked, confirmation opt-in, transient response only',async()=>{const f=await ready();assert.equal(f.calls.filter(x=>x[2]?.action==='owner-issue').length,0);const first=f.submit();await f.submit();await tick();assert.equal(f.pending.length,2);assert.equal(f.calls.at(-1)[2].action,'owner-issue');assert.equal(f.calls.at(-1)[2].confirmEmail,false);f.pending[1].resolve(okay(issued()));await first;assert.equal(f.node('ownerIssuedCode').textContent,'DEMO-ONLY-CODE-HERE');assert.equal(f.node('ownerCodePanel').hidden,false);assert.ok(f.timers.at(-1).ms<=600000);f.node('ownerHideCode').onclick();assert.equal(f.node('ownerIssuedCode').textContent,'');assert.equal(f.node('ownerCodePanel').hidden,true)});
test('switching away clears code and obsolete issuance response cannot show it',async()=>{for(const event of ['pagehide','visibilitychange']){const f=await ready(),work=f.submit();await tick();if(event==='pagehide')f.windowHandlers[event]();else{f.c.document.hidden=true;f.documentHandlers[event]()};assert.equal(f.calls.at(-1)[3].signal.aborted,true);f.pending[1].resolve(okay(issued()));await work;assert.equal(f.node('ownerIssuedCode').textContent,'');assert.equal(f.node('ownerCodePanel').hidden,true)}});
test('Auth identity switch closes owner access and clears issued code',async()=>{const f=await ready(),work=f.submit();await tick();f.pending[1].resolve(okay(issued()));await work;f.auth()('SIGNED_IN',{user:{id:'another'}});assert.equal(f.node('ownerIssueForm').hidden,true);assert.equal(f.node('ownerIssuedCode').textContent,'');assert.match(f.node('ownerMessage').textContent,/ended or changed/)});
test('ambiguous owner issue response never auto-retries and guides status refresh',async()=>{const f=await ready(),work=f.submit();await tick();f.pending[1].reject(Error('provider private secret'));await work;assert.equal(f.pending.length,2);assert.equal(f.node('ownerCodePanel').hidden,true);assert.match(f.node('ownerMessage').textContent,/not confirmed.*Refresh employee status/);assert.doesNotMatch(f.node('ownerMessage').textContent,/provider private/)});
test('owner source has no credential persistence, clipboard writes, logging or account creation',()=>{assert.doesNotMatch(source,/localStorage|sessionStorage|document\.cookie|console\.|clipboard|createUser|updateUser|user_metadata/);assert.match(source,/credentials:'omit'/);assert.match(source,/cache:'no-store'/);assert.match(source,/referrerPolicy:'no-referrer'/)});

test('initial owner-list response cannot reveal the former owner directory after native identity changes',async()=>{
 const f=fixture();await tick();assert.equal(f.pending.length,1);f.setSession({access_token:'synthetic-new-token',user:{id:'synthetic-new-user'}});f.auth()('SIGNED_IN',{user:{id:'synthetic-new-user'}});
 f.pending[0].resolve(okay({employees:[{username:'former-owner-private-alias',user_id:'synthetic-private-uid',status:'active',enabled:true}]}));await tick();
 assert.equal(f.node('ownerIssueForm').hidden,true);assert.equal(f.node('ownerReload').hidden,true);assert.equal(f.node('ownerEmployee').value,'');assert.equal(f.node('ownerEmployee').options.length,0);assert.equal(f.node('ownerCodePanel').hidden,true);assert.match(f.node('ownerMessage').textContent,/ended or changed/);
});
test('owner lock removes previously rendered directory names as well as hiding controls',async()=>{
 const f=await ready();assert.equal(f.node('ownerEmployee').value,'sample-employee');f.auth()('SIGNED_OUT',null);assert.equal(f.node('ownerEmployee').value,'');assert.equal(f.node('ownerEmployee').options.length,0);assert.equal(f.node('ownerEmployeeStatus').textContent,'');assert.equal(f.node('ownerIssueForm').hidden,true);
});
test('refresh owner-list cannot restore the prior directory after the native user changes',async()=>{
 const f=await ready(),refresh=f.node('ownerReload').onclick();await tick();assert.equal(f.pending.length,2);f.setSession({access_token:'synthetic-new-token',user:{id:'synthetic-new-user'}});f.auth()('SIGNED_IN',{user:{id:'synthetic-new-user'}});
 f.pending[1].resolve(okay({employees:[{username:'late-private-alias',user_id:'synthetic-private-uid',status:'active',enabled:true}]}));await refresh;
 assert.equal(f.node('ownerIssueForm').hidden,true);assert.equal(f.node('ownerEmployee').options.length,0);assert.equal(f.node('ownerEmployee').value,'');assert.match(f.node('ownerMessage').textContent,/ended or changed/);
});
test('identity change during initial owner verification cannot start directory enumeration',async()=>{
 const f=fixture();f.setSession({access_token:'synthetic-new-token',user:{id:'synthetic-new-user'}});f.auth()('SIGNED_IN',{user:{id:'synthetic-new-user'}});await tick();assert.equal(f.pending.length,0);assert.equal(f.node('ownerIssueForm').hidden,true);assert.match(f.node('ownerMessage').textContent,/could not be confirmed/);
});
