// Actual dedicated approved-packet client path. Synthetic data only, no services.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const plain=value=>JSON.parse(JSON.stringify(value));
function sourceOf(name){const start=html.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert.ok(start>=0,name);const line=html.slice(start,html.indexOf('\n',start)).trimEnd();return line.endsWith('}')?line:html.slice(start,html.indexOf('\n}',start)+2)}
function payload(week='2026-10-26'){
 return {permissions:{view:true},packs:[{pack_id:'synthetic-pack',week_start:week,pack_version:2,is_active:true,published_at:'2026-10-25T12:00:00Z',published_by_email:'PRIVATE ADMIN',draft:'PRIVATE DRAFT',snapshot:{week_start:week,week_end:week==='2026-10-26'?'2026-10-30':'2026-11-06',source_snapshot:'PRIVATE SOURCE',sections:[{section:{section_key:'walls_production',status:'approved',section_name:'Synthetic <script>area</script>',crew_leader:'Synthetic leader',sort_order:1,approved_by_email:'PRIVATE APPROVER'},people:[{employee_name:'Synthetic worker',user_id:'PRIVATE ID'}],assignments:[{work_date:week,project_location:'Synthetic <img> site',assignment_text:'Synthetic approved work',start_time:'08:00',status_hold:'Confirm current conditions',backup_instructions:'Ask supervisor',readiness_status:'PRIVATE READINESS',source_id:'PRIVATE SOURCE ID'}]}]}}]};
}
function fixture(){
 const pending=[],opened=[],routes=[],nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',classList:{remove(){}},querySelector:()=>null,replaceChildren(){this.innerHTML='';this.textContent=''}});return nodes.get(id)};
 const c={console,Date,Number,Set,Promise,clearTimeout,employeeCrewPacksCache:null,currentUser:{id:'synthetic-employee'},currentUserAuthorized:true,currentUserIsAdmin:false,currentAllowedViews:['weekly-planner'],hubSessionEpoch:1,state:{view:'weekly-planner',week:'2026-10-26'},seed:{},clone:plain,loadUiPrefs:()=>({}),showAuthGate(){},stateChannel:null,inventoryChannel:null,productionChannel:null,weeklyPlannerChannel:null,wallsInstallationChannel:null,weeklyPlannerRefreshTimer:null,wallsInstallationReloadTimer:null,inventoryToastTimer:null,remoteLoadToken:0,inventoryLoadToken:0,importReadToken:0,document:{body:{classList:{remove(){}}},getElementById:node,querySelectorAll:()=>[]},htmlSafe:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),plannerDateLabel:s=>s,setView:view=>{routes.push(view);c.state.view=view},openProductionModal:(...args)=>opened.push(args),plannerPublishVerificationRequired:()=>{throw Error('Read admin publication state')},subscribeWeeklyPlanner:()=>{throw Error('Subscribed broad planner')},loadWeeklyPlanner:()=>{throw Error('Loaded broad planner')},weeklyPlanner:{sections:[],recent_packs:[{snapshot:'PRIVATE MANAGER CACHE'}]}};
 c.sb={rpc:(name,args)=>new Promise((resolve,reject)=>pending.push({name,args,resolve,reject})),removeChannel:async()=>{}};
 vm.createContext(c);vm.runInContext(['viewAllowed','employeeCrewAccessAllowed','employeeCrewContextCurrent','resetEmployeeCrewSchedules','employeeCrewCache','employeeCrewProjection','loadEmployeeCrewSchedules','readEmployeeCrewPack','renderEmployeeCrewSchedules','renderWeeklyPlanner','plannerReadPack','resetLocalSession'].map(sourceOf).join('\n'),c);
 return {c,pending,opened,routes,nodes,node};
}
async function loaded(f,data=payload()){const request=f.c.loadEmployeeCrewSchedules();await tick();f.pending.at(-1).resolve({data});assert.equal(await request,true);return f}
test('employee planner route loads only dedicated active-approved RPC, with no management snapshot or actions',async()=>{
 const f=fixture();Object.defineProperty(f.c,'weeklyPlanner',{get(){throw Error('Read management cache')}});f.c.renderWeeklyPlanner();await tick();assert.equal(f.pending.length,1);assert.equal(f.pending[0].name,'get_employee_approved_crew_packs');assert.deepEqual(plain(f.pending[0].args),{p_week_start:'2026-10-26'});f.pending[0].resolve({data:payload()});await tick();
 const markup=f.node('view').innerHTML;assert.match(markup,/Approved division schedules|ACTIVE APPROVED PACKET/);assert.match(markup,/not personal assignments/);assert.match(markup,/Revision 2/);assert.doesNotMatch(markup,/data-planner-action|PRIVATE|<script>/);assert.match(markup,/&lt;script&gt;/);
 const read=f.c.readEmployeeCrewPack('synthetic-pack');await tick();assert.equal(f.pending.length,2);assert.equal(f.pending[1].name,'get_employee_approved_crew_packs');f.pending[1].resolve({data:payload()});assert.equal(await read,true);assert.equal(f.opened.length,1);assert.equal(f.opened[0][0],'Approved division schedule');assert.match(f.opened[0][2],/Synthetic approved work/);assert.doesNotMatch(f.opened[0][2],/Readiness|PRIVATE|<img>/);assert.equal(f.opened[0][4],null);assert.equal(f.pending.length,2);
});
test('client cache strips unknown admin, readiness, identity and draft payload fields',()=>{
 const f=fixture(),safe=f.c.employeeCrewProjection(payload(),'2026-10-26');assert.doesNotMatch(JSON.stringify(safe),/PRIVATE|readiness_status|source_snapshot|published_by_email|approved_by_email|user_id/);assert.equal(safe[0].snapshot.sections[0].assignments[0].status_hold,'Confirm current conditions');
});
for(const [name,mutate] of [
 ['inactive packet',x=>x.packs[0].is_active=false],['draft section',x=>x.packs[0].snapshot.sections[0].section.status='draft'],['unpermitted division section',x=>x.packs[0].snapshot.sections[0].section.section_key='box_precast_support'],['duplicate section',x=>x.packs[0].snapshot.sections.push(x.packs[0].snapshot.sections[0])],['wrong requested week',x=>x.packs[0].week_start='2026-11-02'],['wrong snapshot week',x=>x.packs[0].snapshot.week_start='2026-11-02'],['malformed revision',x=>x.packs[0].pack_version='2'],['missing active marker',x=>delete x.packs[0].is_active],['empty sections',x=>x.packs[0].snapshot.sections=[]],['multiple packets',x=>x.packs.push(x.packs[0])],['invalid assignment calendar date',x=>x.packs[0].snapshot.sections[0].assignments[0].work_date='2026-99-99'],['invalid week end calendar date',x=>x.packs[0].snapshot.week_end='2026-02-30'],['malformed assignment',x=>x.packs[0].snapshot.sections[0].assignments[0].assignment_text={text:'bad'}]
])test(`${name} fails closed instead of rendering cached approval`,async()=>{
 const f=fixture(),data=payload();mutate(data);const request=f.c.loadEmployeeCrewSchedules();await tick();f.pending[0].resolve({data});assert.equal(await request,false);assert.deepEqual(plain(f.c.employeeCrewPacksCache.packs),[]);assert.match(f.node('view').innerHTML,/could not be loaded/);assert.equal(await f.c.readEmployeeCrewPack('synthetic-pack'),false);
});
test('empty approved response has a useful terminal state and no automatic retry',async()=>{
 const f=await loaded(fixture(),{permissions:{view:true},packs:[]});assert.match(f.node('view').innerHTML,/No active approved division schedule/);assert.doesNotMatch(f.node('view').innerHTML,/data-employee-crew-read/);f.c.renderEmployeeCrewSchedules();await tick();assert.equal(f.pending.length,1);
});
for(const kind of ['no grant','admin','no identity','unauthorized'])test(`${kind} cannot call employee loader or reuse another cache`,async()=>{
 const f=fixture();if(kind==='no grant')f.c.currentAllowedViews=[];if(kind==='admin')f.c.currentUserIsAdmin=true;if(kind==='no identity')f.c.currentUser=null;if(kind==='unauthorized')f.c.currentUserAuthorized=false;
 assert.equal(await f.c.loadEmployeeCrewSchedules(),false);f.c.renderEmployeeCrewSchedules();assert.equal(f.pending.length,0);assert.match(f.node('view').innerHTML,/not enabled for this account/);assert.equal(f.c.employeeCrewPacksCache,null);
});
test('explicit remote denial is terminal and reveals no returned packets',async()=>{
 const f=fixture(),request=f.c.loadEmployeeCrewSchedules();await tick();f.pending[0].resolve({data:{...payload(),permissions:{view:false}}});assert.equal(await request,false);assert.equal(f.c.employeeCrewPacksCache.denied,true);assert.equal(f.c.employeeCrewPacksCache.packs.length,0);assert.match(f.node('view').innerHTML,/not enabled/);f.c.renderEmployeeCrewSchedules();await tick();assert.equal(f.pending.length,1);
});
test('failed read is retryable, repeated refresh joins one read, and stale packets are hidden',async()=>{
 const f=await loaded(fixture());const request=f.c.loadEmployeeCrewSchedules(true),repeat=f.c.loadEmployeeCrewSchedules(true);assert.equal(request,repeat);assert.equal(await f.c.readEmployeeCrewPack('synthetic-pack'),false);assert.equal(f.c.employeeCrewPacksCache.packs.length,0);await tick();f.pending[1].reject(Error('PRIVATE DATABASE DETAIL'));assert.equal(await request,false);assert.doesNotMatch(f.node('view').innerHTML,/PRIVATE DATABASE DETAIL/);assert.match(f.node('view').innerHTML,/Try again/);assert.equal(f.pending.length,2);
 const retry=f.c.loadEmployeeCrewSchedules(true);await tick();f.pending[2].resolve({data:payload()});assert.equal(await retry,true);const read=f.c.readEmployeeCrewPack('synthetic-pack');await tick();f.pending[3].resolve({data:payload()});assert.equal(await read,true);
});
for(const changed of ['user','client','epoch','permission','admin'])test(`pending read cannot populate cache after ${changed} changes`,async()=>{
 const f=fixture(),request=f.c.loadEmployeeCrewSchedules();await tick();if(changed==='user')f.c.currentUser={id:'replacement'};if(changed==='client')f.c.sb={rpc:()=>{throw Error('Wrong transport')}};if(changed==='epoch')f.c.hubSessionEpoch++;if(changed==='permission')f.c.currentAllowedViews=[];if(changed==='admin')f.c.currentUserIsAdmin=true;f.pending[0].resolve({data:payload()});assert.equal(await request,false);assert.equal(await f.c.readEmployeeCrewPack('synthetic-pack'),false);assert.equal(f.c.employeeCrewPacksCache.packs.length,0);
});
test('older week response cannot overwrite a newer week request',async()=>{
 const f=fixture(),old=f.c.loadEmployeeCrewSchedules();await tick();f.c.state.week='2026-11-02';const fresh=f.c.loadEmployeeCrewSchedules();await tick();f.pending[1].resolve({data:payload('2026-11-02')});assert.equal(await fresh,true);f.pending[0].resolve({data:payload()});assert.equal(await old,false);assert.equal(f.c.employeeCrewPacksCache.week,'2026-11-02');assert.equal(f.c.employeeCrewPacksCache.packs[0].week_start,'2026-11-02');
});
test('actual signout reset clears dedicated cache and pending result cannot restore it',async()=>{
 const f=await loaded(fixture());const pending=f.c.loadEmployeeCrewSchedules(true);await tick();f.c.resetLocalSession();assert.equal(f.c.employeeCrewPacksCache,null);f.pending[1].resolve({data:payload()});assert.equal(await pending,false);assert.equal(f.c.employeeCrewPacksCache,null);assert.equal(await f.c.readEmployeeCrewPack('synthetic-pack'),false);
});
test('detached packet control is denied after local view revocation, week change or session replacement',async()=>{
 for(const change of [c=>c.currentAllowedViews=[],c=>c.state.week='2026-11-02',c=>c.currentUser={id:'another'}]){const f=await loaded(fixture());change(f.c);assert.equal(await f.c.readEmployeeCrewPack('synthetic-pack'),false);assert.equal(f.opened.length,0)}
});

test('packet open freshly verifies approval and repeated taps share one read and one modal',async()=>{
 const f=await loaded(fixture()),read=f.c.readEmployeeCrewPack('synthetic-pack'),repeat=f.c.readEmployeeCrewPack('synthetic-pack');assert.equal(read,repeat);assert.equal(f.opened.length,0);await tick();assert.equal(f.pending.length,2);f.pending[1].resolve({data:payload()});assert.equal(await read,true);assert.equal(f.opened.length,1);
});
for(const outcome of ['replaced','inactive','error','navigated away'])test(`fresh packet open does not display stale content when ${outcome}`,async()=>{
 const f=await loaded(fixture()),read=f.c.readEmployeeCrewPack('synthetic-pack');await tick();const data=payload();if(outcome==='replaced')data.packs[0].pack_id='new-approved-pack';if(outcome==='inactive')data.packs=[];if(outcome==='navigated away')f.c.state.view='today';if(outcome==='error')f.pending[1].reject(Error('offline'));else f.pending[1].resolve({data});assert.equal(await read,false);assert.equal(f.opened.length,0);if(['replaced','inactive'].includes(outcome))assert.match(f.node('view').innerHTML,/no longer the current approved schedule/);
});
test('old session result cannot clear or overwrite replacement session read',async()=>{
 const f=fixture(),old=f.c.loadEmployeeCrewSchedules();await tick();f.c.currentUser={id:'new-employee'};const fresh=f.c.loadEmployeeCrewSchedules();await tick();const cache=f.c.employeeCrewPacksCache;f.pending[0].resolve({data:payload()});assert.equal(await old,false);assert.equal(f.c.employeeCrewPacksCache,cache);assert.equal(f.c.employeeCrewPacksCache.promise,fresh);f.pending[1].resolve({data:payload()});assert.equal(await fresh,true);
});
