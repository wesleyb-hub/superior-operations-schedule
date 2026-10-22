// Behavioral tests of the actual inline loader, using synthetic deferred RPCs only.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const loader=html.slice(html.indexOf('function loadWeeklyPlanner('),html.indexOf('function subscribeWeeklyPlanner('));
function setup(){
  const calls=[],errors=[];
  const context={hubSessionEpoch:0,Promise,console:{error:(...args)=>errors.push(args)},state:{week:'2026-10-19',view:'weekly-planner'},currentUser:{id:'synthetic-admin'},currentUserIsAdmin:true,weeklyPlanner:{marker:'initial'},weeklyPlannerReady:false,weeklyPlannerError:'',weeklyPlannerDraftError:'',weeklyPlannerErrorWeek:'',weeklyPlannerRealtimePromise:null,weeklyPlannerRealtimeDirty:false,weeklyPlannerLoadPromise:null,weeklyPlannerLoadToken:null,weeklyPlannerLoadWeek:'',weeklyPlannerLoadedWeek:'',renders:0};
  context.renderWeeklyPlanner=()=>context.renders++;
  context.sb={rpc:(name,args)=>new Promise((resolve,reject)=>calls.push({name,args,resolve,reject}))};
  context.plannerUpdatePendingUI=()=>{};context.weeklyPlannerBusy=false;context.weeklyPlannerProgress=null;context.weeklyPlannerManualRefreshRequest=null;context.showInventoryToast=()=>{};context.plannerSectionFeedback=message=>context.weeklyPlannerDraftError=message;
  vm.createContext(context);vm.runInContext(loader,context);
  vm.runInContext(html.slice(html.indexOf('async function weeklyPlannerRpc('),html.indexOf('function plannerCaptureInputs(')),context);
  return {context,calls,errors,load:force=>context.loadWeeklyPlanner(force)};
}
const tick=()=>Promise.resolve();
const result=marker=>({data:{marker},error:null});
test('ordinary concurrent loads deduplicate; post-write force queues a genuinely fresh read',async()=>{
  const {context:c,calls,load}=setup();const old=load();await tick();
  assert.equal(load(),old);const fresh=load(true);await tick();
  assert.notEqual(fresh,old);assert.equal(calls.length,1,'forced refresh must not overlap transport');
  calls[0].resolve(result('before-generation'));assert.equal(await old,false);await tick();assert.equal(calls.length,2);
  calls[1].resolve(result('generated'));assert.equal(await fresh,true);
  assert.equal(c.weeklyPlanner.marker,'generated');assert.equal(c.renders,1);
});
test('older result resolving first cannot clear the newer in-flight request',async()=>{
  const {context:c,calls,load}=setup();const old=load();await tick();const fresh=load(true);await tick();
  calls[0].resolve(result('old'));assert.equal(await old,false);assert.equal(c.weeklyPlannerLoadPromise,fresh);
  calls[1].resolve(result('new'));assert.equal(await fresh,true);assert.equal(c.weeklyPlannerLoadPromise,null);
});
test('A to B to A navigation coalesces to latest A without launching obsolete B',async()=>{
  const {context:c,calls,load}=setup();const a1=load();await tick();c.state.week='2026-10-26';const b=load();await tick();c.state.week='2026-10-19';const a2=load();await tick();
  assert.equal(calls.length,1);assert.equal(await b,false);calls[0].resolve(result('first-A'));assert.equal(await a1,false);await tick();assert.equal(calls.length,2);assert.equal(calls[1].args.p_week_start,'2026-10-19');
  calls[1].resolve(result('latest-A'));assert.equal(await a2,true);assert.equal(c.weeklyPlanner.marker,'latest-A');assert.equal(c.renders,1);
});
test('missing user, client, or administrator access performs no RPC',async()=>{
  for(const [key,value] of [['currentUser',null],['sb',null],['currentUserIsAdmin',false]]){
    const {context:c,calls,load}=setup();c[key]=value;assert.equal(await load(true),false);assert.equal(calls.length,0);
  }
});
test('sign-out or identity/access change while waiting cannot apply response',async()=>{
  for(const change of [c=>c.currentUser=null,c=>c.currentUser={id:'other-user'},c=>c.currentUserIsAdmin=false,c=>c.sb={}]){
    const {context:c,calls,load}=setup();const pending=load();await tick();change(c);calls[0].resolve(result('private'));
    assert.equal(await pending,false);assert.equal(c.weeklyPlanner.marker,'initial');assert.equal(c.renders,0);
  }
});
test('superseded error cannot poison queued explicit fresh snapshot',async()=>{
  const {context:c,calls,errors,load}=setup();const old=load();await tick();const fresh=load(true);await tick();assert.equal(calls.length,1);
  calls[0].reject(new Error('old failure'));assert.equal(await old,false);await tick();assert.equal(calls.length,2);assert.equal(errors.length,0);
  calls[1].resolve(result('fresh'));await fresh;assert.equal(c.weeklyPlannerReady,true);assert.equal(c.weeklyPlannerError,'');
});
test('current RPC error clears pending slot and allows explicit retry',async()=>{
  const {context:c,calls,load}=setup();const first=load();await tick();calls[0].resolve({error:{message:'Synthetic offline'}});assert.equal(await first,false);assert.equal(c.weeklyPlannerError,'Synthetic offline');assert.equal(c.weeklyPlannerLoadPromise,null);
  const retry=load(true);await tick();calls[1].resolve(result('recovered'));assert.equal(await retry,true);assert.equal(c.weeklyPlannerError,'');
});
test('synchronous RPC failure also clears promise slot rather than rejecting loader',async()=>{
  const {context:c,load}=setup();c.sb.rpc=()=>{throw new Error('Synthetic synchronous failure')};assert.equal(await load(true),false);assert.equal(c.weeklyPlannerLoadPromise,null);assert.equal(c.weeklyPlannerError,'Synthetic synchronous failure');
});
test('cached ready week avoids unnecessary reads unless forced',async()=>{
  const {context:c,calls,load}=setup();c.weeklyPlannerReady=true;c.weeklyPlannerLoadedWeek=c.state.week;c.loadWeeklyPlanner.loadedContext={user:c.currentUser,client:c.sb,epoch:c.hubSessionEpoch};assert.equal(await load(),true);assert.equal(calls.length,0);
  const fresh=load(true);await tick();assert.equal(calls.length,1);calls[0].resolve(result('fresh'));await fresh;
});

test('Generate RPC completion queues a new snapshot strictly after confirmed write and old read settlement',async()=>{
  const {context:c,calls,load}=setup();const old=load();await tick();
  const generation=c.weeklyPlannerRpc('generate_weekly_planner',{p_week_start:c.state.week},'Generated');
  assert.equal(calls[1].name,'generate_weekly_planner');calls[1].resolve({data:true,error:null});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,2);assert.ok(c.weeklyPlannerProgress,'progress remains locked through queued refresh');
  calls[0].resolve(result('before-generation'));assert.equal(await old,false);await tick();assert.equal(calls.length,3);assert.equal(calls[2].name,'get_weekly_planner_snapshot');
  calls[2].resolve(result('generated'));assert.equal(await generation,true);assert.equal(c.weeklyPlannerProgress,null);assert.equal(c.weeklyPlanner.marker,'generated');
});

// Exercise the real renderer as well: a stubbed renderer hides error/reset loops.
function enableRealRender(c){
  const view={innerHTML:''};
  c.document={body:{classList:{remove(){}}},getElementById:()=>view};
  c.plannerTabs=()=>'';c.plannerHeader=()=>'';c.plannerDashboard=()=>'<p>Ready</p>';
  c.bindWeeklyPlanner=()=>{};c.subscribeWeeklyPlanner=()=>{};c.htmlSafe=String;
  vm.runInContext(html.slice(html.indexOf('function renderWeeklyPlanner('),html.indexOf('function loadWeeklyPlanner(')),c);
  return view;
}
test('initial failure stays visible with explicit retry; rendering cannot retry a failed request',async()=>{
  const {context:c,calls}=setup();const view=enableRealRender(c);
  c.renderWeeklyPlanner();await tick();const pending=c.weeklyPlannerLoadPromise;
  calls[0].resolve({error:{message:'Synthetic database timeout'}});await pending;
  assert.equal(calls.length,1,'no immediate request loop on failure');
  assert.match(view.innerHTML,/Synthetic database timeout/);
  assert.match(view.innerHTML,/Try again/);
  for(let i=0;i<50;i++){c.renderWeeklyPlanner();await tick();}
  assert.equal(calls.length,1,'unrelated renders must not silently retry');
  const retry=c.loadWeeklyPlanner(true);await tick();assert.equal(calls.length,2);
  calls[1].resolve(result('recovered'));assert.equal(await retry,true);
});
test('changing week after a failed initial read can load the newly selected week',async()=>{
  const {context:c,calls}=setup();enableRealRender(c);
  c.renderWeeklyPlanner();await tick();const failed=c.weeklyPlannerLoadPromise;
  calls[0].resolve({error:{message:'Synthetic failure for first week'}});await failed;
  c.state.week='2026-10-26';c.renderWeeklyPlanner();await tick();
  assert.equal(calls.length,2);assert.equal(calls[1].args.p_week_start,'2026-10-26');
  const next=c.weeklyPlannerLoadPromise;calls[1].resolve(result('next-week'));await next;
  assert.equal(c.weeklyPlanner.marker,'next-week');assert.equal(c.weeklyPlannerError,'');
});

// Realtime callbacks below are spaced across event-loop turns, not one debounce burst.
const flushRealtime=()=>new Promise(resolve=>setImmediate(resolve));
function setupRealtime(){
  const fixture=setup();
  const c=fixture.context,handlers=[],timers=new Map();let timerId=0;
  c.weeklyPlannerChannel=null;c.weeklyPlannerChannelWeek='';c.weeklyPlannerRefreshTimer=null;
  c.setTimeout=fn=>{timers.set(++timerId,fn);return timerId};c.clearTimeout=id=>timers.delete(id);
  c.sb.channel=()=>({on(_event,_filter,fn){handlers.push(fn);return this},subscribe(){}});c.sb.removeChannel=()=>{};
  vm.runInContext(html.slice(html.indexOf('function subscribeWeeklyPlanner('),html.indexOf('async function weeklyPlannerRpc(')),c);
  c.subscribeWeeklyPlanner();
  fixture.notify=()=>{handlers[0]();for(const [id,fn] of timers){timers.delete(id);fn()}return c.weeklyPlannerRealtimePromise||Promise.resolve(false)};
  return fixture;
}
test('40 realtime notifications coalesce behind initial load, then one trailing refresh',async()=>{
  const {context:c,calls,load,notify}=setupRealtime();
  const initial=load();await flushRealtime();
  const workers=[];
  for(let i=0;i<40;i++){workers.push(notify());await flushRealtime()}
  assert.equal(calls.length,1,'blocked initial read must not fan out RPCs');
  calls[0].resolve(result('initial'));await initial;await flushRealtime();
  assert.equal(calls.length,2,'coalesced notifications require one fresh snapshot');
  for(let i=0;i<40;i++){workers.push(notify());await flushRealtime()}
  assert.equal(calls.length,2,'notifications during fresh read must not run parallel reads');
  calls[1].resolve(result('fresh'));await flushRealtime();
  assert.equal(calls.length,3,'one trailing snapshot captures events during fresh read');
  calls[2].resolve(result('trailing'));await Promise.all(workers);await flushRealtime();
  assert.equal(calls.length,3,'no self-sustaining refresh loop after notifications stop');
  assert.equal(c.weeklyPlanner.marker,'trailing');
});
test('realtime snapshot failure pauses retries until explicit refresh succeeds',async()=>{
  const {context:c,calls,load,notify}=setupRealtime();
  const worker=notify();await flushRealtime();
  assert.equal(calls.length,1);calls[0].resolve({data:null,error:{message:'Synthetic timeout'}});await worker;await flushRealtime();
  for(let i=0;i<40;i++){await notify();await flushRealtime()}
  assert.equal(calls.length,1,'realtime must not hammer a failed backend');
  const retry=load(true);await flushRealtime();assert.equal(calls.length,2);calls[1].resolve(result('manual recovery'));await retry;
  const resumed=notify();await flushRealtime();assert.equal(calls.length,3,'successful explicit retry resumes realtime');
  calls[2].resolve(result('resumed'));await resumed;
});
test('failed preexisting snapshot does not trigger queued realtime read',async()=>{
  const {context:c,calls,load,notify}=setupRealtime();const initial=load();await flushRealtime();const worker=notify();await flushRealtime();
  calls[0].resolve({error:{message:'Synthetic initial failure'}});await initial;await worker;await flushRealtime();assert.equal(calls.length,1);
});
test('week or user change aborts queued realtime work after pending read settles',async()=>{
  for(const change of [c=>c.state.week='2026-10-26',c=>c.currentUser=null,c=>c.currentUser={id:'different-user'},c=>c.currentUserIsAdmin=false,c=>c.state.view='installation']){
    const {context:c,calls,load,notify}=setupRealtime();const initial=load();await flushRealtime();const worker=notify();await flushRealtime();change(c);calls[0].resolve(result('old-context'));await initial;await worker;await flushRealtime();assert.equal(calls.length,1,'must not issue queued reads for obsolete navigation/session');
  }
});
test('post-write forced refresh waits for old transport without accepting pre-write data',async()=>{
  const {context:c,calls,load,notify}=setupRealtime();const initial=load();await flushRealtime();const worker=notify();await flushRealtime();const postWrite=load(true);await flushRealtime();assert.equal(calls.length,1);
  calls[0].resolve(result('before-write'));await initial;await worker;await flushRealtime();assert.equal(calls.length,2);
  calls[1].resolve(result('post-write'));await postWrite;await flushRealtime();assert.equal(c.weeklyPlanner.marker,'post-write');assert.equal(calls.length,2,'superseded initial read must not restart realtime worker');
});
test('failed-save draft protection pauses realtime and rejects preexisting snapshot until explicit refresh',async()=>{
 const {context:c,calls,load}=setup();const pending=load();await tick();c.weeklyPlannerDraftError='Synthetic save failed; keep edits';
 assert.equal(await c.refreshWeeklyPlannerFromRealtime(),false);assert.equal(calls.length,1);
 calls[0].resolve(result('would discard edits'));assert.equal(await pending,false);assert.equal(c.renders,0);
 const explicit=load(true);await tick();assert.equal(c.weeklyPlannerDraftError,'');calls[1].resolve(result('explicit retry'));assert.equal(await explicit,true);
});

test('preexisting snapshot rejection cannot replace a failed-save draft with an error screen',async()=>{
 const {context:c,calls,load}=setup();const pending=load();await tick();c.weeklyPlannerDraftError='Retain draft';calls[0].reject(new Error('Synthetic snapshot timeout'));assert.equal(await pending,false);assert.equal(c.renders,0);assert.equal(c.weeklyPlannerDraftError,'Retain draft');
});

test('pending section-save fences earlier reads before a failure can rerender typed draft',{timeout:2000},async()=>{
 const {context:c,calls,load}=setup();c.plannerSection=()=>({section_id:'synthetic',schedule_version:1});c.plannerCaptureSection=()=>({p_section_id:'synthetic',p_expected_version:1,p_crew_leader:'typed draft',p_people:[]});c.weeklyPlannerSelected='synthetic';c.document={querySelectorAll:()=>[],getElementById:()=>null};vm.runInContext(html.slice(html.indexOf('function plannerUpdatePendingUI('),html.indexOf('function plannerAddAssignment(')),c);
 const old=load();await tick();const save=c.plannerSaveSection();assert.equal(await load(true),false);assert.equal(calls.length,2);calls[0].resolve(result('older server form'));assert.equal(await old,false);assert.equal(c.renders,0);assert.equal(c.weeklyPlanner.marker,'initial');calls[1].reject(Error('Synthetic network loss'));assert.equal(await save,false);assert.match(c.weeklyPlannerDraftError,/on-screen edits are retained/);assert.equal(c.renders,0);
});
test('generic planner input failures preserve draft and block realtime until deliberate refresh',{timeout:2000},async()=>{
 for(const uncertain of [false,true]){
  const {context:c,calls,load}=setup();const old=load();await tick();const save=c.weeklyPlannerRpc('save_weekly_planner_inputs',{p_availability:[{employee_name:'Typed draft'}]},'Saved');calls[0].resolve(result('older inputs'));assert.equal(await old,false);assert.equal(c.renders,0);if(uncertain)calls[1].reject(Error('Synthetic network loss'));else calls[1].resolve({error:{message:'Synthetic failure'}});assert.equal(await save,false);assert.equal(calls.length,2);assert.match(c.weeklyPlannerDraftError,/on-screen edits are retained/);assert.equal(await c.refreshWeeklyPlannerFromRealtime(),false);assert.equal(calls.length,2);const fresh=load(true);await tick();calls[2].resolve(result('explicit retry'));assert.equal(await fresh,true);assert.equal(c.weeklyPlannerDraftError,'');
 }
});
