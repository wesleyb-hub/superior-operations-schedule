// Real inline orchestration with controlled transport/DOM/time. No live service access.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const html=readFileSync(process.env.PLANNER_SOURCE||new URL('../index.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const snapshot=marker=>({data:{marker,sections:[],permissions:{}}});
function setup(){
 const calls=[],channels=[],timers=new Map(),messages=[];let active=0,maxActive=0,time=0,timerId=0;
 const controls=['reload','generate','save-section'].map(action=>({dataset:{plannerAction:action},disabled:false,textContent:action}));
 const feedback={textContent:''};
 const view={innerHTML:'',querySelectorAll:()=>controls,replaceChildren(){this.innerHTML=''}};
 const c={Promise,console:{error(){}},state:{week:'2026-10-26',view:'weekly-planner',weeklyPlannerView:'planner'},currentUser:{id:'synthetic'},currentUserIsAdmin:true,hubSessionEpoch:1,weeklyPlanner:{sections:[]},weeklyPlannerBusy:false,weeklyPlannerProgress:null,weeklyPlannerManualRefreshRequest:null,weeklyPlannerDraftError:'',weeklyPlannerLoadPromise:null,weeklyPlannerLoadToken:null,weeklyPlannerLoadWeek:'',weeklyPlannerLoadedWeek:'',weeklyPlannerReady:false,weeklyPlannerError:'',weeklyPlannerErrorWeek:'',weeklyPlannerRealtimeDirty:false,weeklyPlannerRealtimePromise:null,weeklyPlannerChannel:null,weeklyPlannerChannelWeek:'',weeklyPlannerRefreshTimer:null,document:{body:{classList:{remove(){}}},querySelectorAll:q=>q.startsWith('#view [data-planner-action],')?controls:[],getElementById:id=>id==='view'?view:['plannerSectionFeedback','plannerSaveFeedback'].includes(id)?feedback:null},htmlSafe:String,plannerTabs:()=>'',plannerHeader:()=>'<button data-planner-action="reload">Refresh</button>',plannerDashboard:()=>'<p>Snapshot</p>',showInventoryToast:message=>messages.push(message),bindPlannerEmployeePicker(){},loadWeeklyPlannerInstallEmployees:async()=>true,loadPlannerEmployeeHistory:async()=>true,loadPlannerCompanyRoster:async()=>true,setTimeout(fn,ms){timers.set(++timerId,{fn,due:time+ms});return timerId},clearTimeout(id){timers.delete(id)},saveUiPrefs(){},confirm:()=>true};
 c.sb={rpc(name,args){const isSnapshot=name==='get_weekly_planner_snapshot';if(isSnapshot){active++;maxActive=Math.max(maxActive,active)}const call={name,args,headers:{},at:time};calls.push(call);const promise=new Promise((resolve,reject)=>{let settled=false;call.resolve=value=>{if(!settled){settled=true;if(isSnapshot)active--;resolve(value)}};call.reject=error=>{if(!settled){settled=true;if(isSnapshot)active--;reject(error)}}});return {setHeader(name,value){call.headers[name]=value;return this},then:promise.then.bind(promise)}} ,channel(name){const channel={name,handlers:[],on(_event,filter,fn){this.handlers.push({filter,fn});return this},subscribe(){return this}};channels.push(channel);return channel},removeChannel(){}};
 vm.createContext(c);
 for(const [start,end] of [['function renderWeeklyPlanner(','function plannerCaptureInputs('],['function plannerSectionFeedback(','function plannerRefreshSectionMetadata('],['function bindWeeklyPlanner(','function render(){']])vm.runInContext(html.slice(html.indexOf(start),html.indexOf(end)),c);
 const advance=async(ms=450)=>{time+=ms;for(const[id,timer]of [...timers])if(timer.due<=time){timers.delete(id);timer.fn()}await tick()};
 const init=async()=>{c.renderWeeklyPlanner();await tick();calls[0].resolve(snapshot('initial'));await tick()};
 const installReset=()=>{Object.assign(c,{hubSessionLocked:false,remoteLoadToken:0,inventoryLoadToken:0,importReadToken:0,stateChannel:null,inventoryChannel:null,productionChannel:null,wallsInstallationChannel:null,wallsInstallationReloadTimer:null,inventoryToastTimer:null,seed:{},clone:structuredClone,loadUiPrefs:()=>({week:'2026-10-26',view:'weekly-planner',weeklyPlannerView:'planner'}),showAuthGate(){}});vm.runInContext(html.slice(html.indexOf('function resetLocalSession('),html.indexOf('async function signOut(')),c)};
 return {c,calls,channels,controls,feedback,view,messages,advance,init,installReset,notify:()=>channels.at(-1).handlers[0].fn(),snapshots:()=>calls.filter(x=>x.name==='get_weekly_planner_snapshot'),active:()=>active,maxActive:()=>maxActive};
}

test('actual initial/render/realtime/manual burst uses one active transport and one fresh trailing request',async()=>{
 const f=setup(),c=f.c;c.renderWeeklyPlanner();await tick();const old=c.weeklyPlannerLoadPromise;
 for(let i=0;i<100;i++){f.notify();await f.advance();c.renderWeeklyPlanner()}
 const manual=c.refreshWeeklyPlannerManually();await tick();
 for(let i=0;i<100;i++){assert.equal(c.refreshWeeklyPlannerManually(),manual);f.notify();await f.advance();c.renderWeeklyPlanner()}
 assert.equal(f.snapshots().length,1);assert.equal(f.maxActive(),1);
 f.calls[0].resolve(snapshot('old'));assert.equal(await old,false);await tick();assert.equal(f.snapshots().length,2);assert.notEqual(c.weeklyPlanner.marker,'old');
 f.calls[1].resolve(snapshot('fresh'));assert.equal(await manual,true);await f.advance(60_000);
 assert.equal(c.weeklyPlanner.marker,'fresh');assert.equal(f.snapshots().length,2);assert.equal(f.maxActive(),1);assert.equal(f.active(),0);
});

for(const oldFinishesBeforeWrite of [false,true])test(`post-write freshness survives obsolete read failure ${oldFinishesBeforeWrite?'before':'after'} mutation completion`,async()=>{
 const f=setup(),c=f.c;c.renderWeeklyPlanner();await tick();const old=c.weeklyPlannerLoadPromise;
 const write=c.weeklyPlannerRpc('generate_weekly_planner',{p_week_start:c.state.week},'Generated');assert.equal(f.calls[1].name,'generate_weekly_planner');
 if(oldFinishesBeforeWrite){f.calls[0].reject(Error('obsolete timeout'));assert.equal(await old,false);await tick();assert.equal(f.snapshots().length,1)}
 f.calls[1].resolve({data:true});await tick();assert.ok(c.weeklyPlannerProgress);assert.equal(c.weeklyPlannerBusy,false);assert.ok(f.controls.every(control=>control.disabled));
 assert.equal(await c.weeklyPlannerRpc('generate_weekly_planner',{},'Duplicate'),false);assert.equal(await c.refreshWeeklyPlannerManually(),false);
 if(!oldFinishesBeforeWrite){assert.equal(f.snapshots().length,1);f.calls[0].reject(Error('obsolete timeout'));assert.equal(await old,false);await tick()}
 assert.equal(f.snapshots().length,2);assert.equal(c.weeklyPlannerError,'');assert.notEqual(c.weeklyPlanner.marker,'old');
 const fresh=f.snapshots()[1];assert.match(fresh.headers['x-client-info'],/trigger=post-write$/);fresh.resolve(snapshot('post-write'));assert.equal(await write,true);
 assert.equal(c.weeklyPlanner.marker,'post-write');assert.equal(f.feedback.textContent,'Generated');assert.equal(c.weeklyPlannerProgress,null);assert.ok(f.controls.every(control=>!control.disabled));assert.equal(f.maxActive(),1);
});

test('A to B to A and many supersessions retain only latest queued context and settle all obsolete waiters',async()=>{
 const f=setup(),c=f.c;c.renderWeeklyPlanner();await tick();const first=c.weeklyPlannerLoadPromise,obsolete=[];
 for(let i=0;i<40;i++){c.state.week=i%2?'2026-10-26':'2026-11-02';c.renderWeeklyPlanner();obsolete.push(c.weeklyPlannerLoadPromise);await tick()}
 const latest=obsolete.pop();assert.equal(f.snapshots().length,1);assert.equal(f.active(),1);
 assert.ok((await Promise.all(obsolete)).every(value=>value===false));
 f.calls[0].resolve(snapshot('first-A'));assert.equal(await first,false);await tick();assert.equal(f.snapshots().length,2);assert.equal(f.snapshots()[1].args.p_week_start,'2026-10-26');assert.notEqual(c.weeklyPlanner.marker,'first-A');
 f.snapshots()[1].resolve(snapshot('last-A'));assert.equal(await latest,true);assert.equal(c.weeklyPlanner.marker,'last-A');assert.equal(f.maxActive(),1);
});

test('same-week changed user or epoch does not dedupe against obsolete logical request',async()=>{
 for(const change of [c=>c.currentUser={id:'replacement'},c=>c.hubSessionEpoch++]){
  const f=setup(),c=f.c,old=c.loadWeeklyPlanner();await tick();change(c);const next=c.loadWeeklyPlanner();await tick();assert.notEqual(next,old);assert.equal(f.snapshots().length,1);
  f.calls[0].resolve(snapshot('old-context'));assert.equal(await old,false);await tick();assert.equal(f.snapshots().length,2);f.calls[1].resolve(snapshot('new-context'));assert.equal(await next,true);assert.equal(c.weeklyPlanner.marker,'new-context');assert.equal(f.maxActive(),1);
 }
});

test('physical snapshot slot survives actual sign-out/cache resets and only newest login issues trailing read',async()=>{
 const f=setup(),c=f.c;f.installReset();c.renderWeeklyPlanner();await tick();const old=c.weeklyPlannerLoadPromise,obsolete=[];
 for(let i=0;i<20;i++){c.resetLocalSession();c.currentUser={id:`synthetic-${i}`};c.currentUserIsAdmin=true;c.renderWeeklyPlanner();obsolete.push(c.weeklyPlannerLoadPromise);await tick()}
 const newest=obsolete.pop();assert.equal(f.snapshots().length,1);assert.ok((await Promise.all(obsolete)).every(value=>value===false));
 f.calls[0].resolve(snapshot('signed-out-user'));assert.equal(await old,false);await tick();assert.equal(f.snapshots().length,2);assert.notEqual(c.weeklyPlanner.marker,'signed-out-user');
 f.calls[1].resolve(snapshot('current-login'));assert.equal(await newest,true);assert.equal(c.weeklyPlanner.marker,'current-login');assert.equal(f.maxActive(),1);
});

test('current failure latches real rendering/realtime but queued explicit request survives obsolete failure',async()=>{
 const f=setup(),c=f.c;c.renderWeeklyPlanner();await tick();const old=c.weeklyPlannerLoadPromise,manual=c.refreshWeeklyPlannerManually();await tick();
 f.calls[0].reject(Error('old failure'));assert.equal(await old,false);await tick();assert.equal(f.snapshots().length,2);assert.equal(c.weeklyPlannerError,'');
 f.calls[1].resolve({error:{message:'current timeout'}});assert.equal(await manual,false);await tick();
 for(let i=0;i<100;i++){c.renderWeeklyPlanner();f.notify();await f.advance()}
 assert.equal(f.snapshots().length,2);assert.equal(c.weeklyPlannerError,'current timeout');
 const recover=c.refreshWeeklyPlannerManually();await tick();assert.equal(f.snapshots().length,3);f.calls[2].resolve(snapshot('recovered'));assert.equal(await recover,true);assert.equal(f.maxActive(),1);
});

test('queued context that loses access is discarded without RPC and old response never paints',async()=>{
 const f=setup(),c=f.c,old=c.loadWeeklyPlanner();await tick();c.state.week='2026-11-02';const queued=c.loadWeeklyPlanner();await tick();c.currentUserIsAdmin=false;
 f.calls[0].resolve(snapshot('private'));assert.equal(await old,false);assert.equal(await queued,false);assert.equal(f.snapshots().length,1);assert.notEqual(c.weeklyPlanner.marker,'private');assert.equal(f.active(),0);
});

test('synchronous transport failure frees physical ownership and explicit recovery works once',async()=>{
 const f=setup(),c=f.c,rpc=c.sb.rpc;c.sb.rpc=()=>{throw Error('sync transport failure')};assert.equal(await c.loadWeeklyPlanner(),false);assert.equal(c.plannerQueueSnapshot.queue.active,null);assert.equal(c.plannerQueueSnapshot.queue.pending,null);
 c.sb.rpc=rpc;const recover=c.refreshWeeklyPlannerManually();await tick();assert.equal(f.snapshots().length,1);f.calls[0].resolve(snapshot('recovered'));assert.equal(await recover,true);assert.equal(f.maxActive(),1);
});

test('request correlation header contains fixed build/category only, never RPC inputs or untrusted category',async()=>{
 const f=setup(),c=f.c,args={p_week_start:'2099-12-31',employee_name:'Private Synthetic Input',p_section_id:'private-record'};
 for(const trigger of ['render','manual','realtime','post-write','mutation','save','approve','private-category']){
  const pending=c.plannerRpcRequest(c.sb,'synthetic_rpc',args,trigger),call=f.calls.at(-1);const header=call.headers['x-client-info'];
  assert.match(header,/^superior-hub\/planner-queue-20261022; trigger=(render|manual|realtime|post-write|mutation|save|approve|other)$/);
  for(const secret of Object.values(args))assert.ok(!header.includes(secret));assert.ok(!header.includes('private-category'));call.resolve({data:true});await pending;
 }
});


test('ready cache is never rendered or reused under a replaced user, client, or session epoch',async()=>{
 for(const change of [c=>c.currentUser={id:'replacement'},c=>c.sb={...c.sb},c=>c.hubSessionEpoch++]){
  const f=setup(),c=f.c;await f.init();assert.equal(c.weeklyPlannerReady,true);change(c);c.renderWeeklyPlanner();await tick();
  assert.equal(c.weeklyPlannerReady,false);assert.match(f.view.innerHTML,/Loading Weekly Planner/);assert.equal(f.snapshots().length,2);
  f.snapshots()[1].resolve(snapshot('new-owner'));await tick();assert.equal(c.weeklyPlanner.marker,'new-owner');assert.equal(c.weeklyPlannerReady,true);assert.equal(f.maxActive(),1);
 }
});

test('failure latch belongs to its user/client/epoch, not a later same-week context',async()=>{
 for(const change of [c=>c.currentUser={id:'replacement'},c=>c.sb={...c.sb},c=>c.hubSessionEpoch++]){
  const f=setup(),c=f.c;c.renderWeeklyPlanner();await tick();f.calls[0].resolve({error:{message:'prior owner timeout'}});await tick();assert.equal(c.weeklyPlannerError,'prior owner timeout');
  change(c);c.renderWeeklyPlanner();await tick();assert.equal(c.weeklyPlannerError,'');assert.match(f.view.innerHTML,/Loading Weekly Planner/);assert.equal(f.snapshots().length,2);
  f.calls[1].resolve(snapshot('new-owner'));await tick();assert.equal(c.weeklyPlanner.marker,'new-owner');assert.equal(f.maxActive(),1);
 }
});


test('uncertain mutation fences older snapshot and pauses automatic refresh until deliberate verification',async()=>{
 const f=setup(),c=f.c;await f.init();c.weeklyPlanner.sections=[{section_id:'synthetic',status:'approved',schedule_version:4}];
 const old=c.loadWeeklyPlanner(true,'realtime');await tick();
 const mutation=c.weeklyPlannerRpc('generate_weekly_planner',{},'Generated');f.calls[2].resolve({status:0,error:{message:'Failed to fetch',code:''}});
 assert.equal(await mutation,false);assert.equal(c.weeklyPlanner.sections[0].status,'approval_unverified');assert.equal(c.weeklyPlanner.sections[0].schedule_version,4);
 assert.match(c.weeklyPlannerDraftError,/outcome unknown/);assert.equal(f.calls.length,3);
 f.calls[1].resolve({data:{marker:'stale-approved',sections:[{section_id:'synthetic',status:'approved',schedule_version:4}]}});assert.equal(await old,false);
 for(let i=0;i<50;i++){f.notify();await f.advance();c.renderWeeklyPlanner()}
 assert.equal(f.calls.length,3);assert.equal(c.weeklyPlanner.sections[0].status,'approval_unverified');assert.notEqual(c.weeklyPlanner.marker,'stale-approved');
 const verify=c.refreshWeeklyPlannerManually();await tick();assert.equal(f.calls.length,4);f.calls[3].resolve({data:{marker:'verified',sections:[{section_id:'synthetic',status:'approved',schedule_version:5}]}});assert.equal(await verify,true);assert.equal(c.weeklyPlanner.sections[0].status,'approved');assert.equal(c.weeklyPlannerDraftError,'');assert.equal(f.maxActive(),1);
});

test('unknown publication stays blocked through cached, failed, malformed, obsolete and other-context reads until matching authoritative packet history',async()=>{
 const f=setup(),c=f.c;await f.init();const user=c.currentUser,week=c.state.week;
 const validData=()=>({marker:'authoritative',week:{source_stale:false},permissions:{publish:true},sections:Array.from({length:8},(_,i)=>({section_id:'section-'+i,status:'approved'})),recent_packs:[]});Object.assign(c.weeklyPlanner,validData());
 vm.runInContext(html.slice(html.indexOf('function plannerPublicationState('),html.indexOf('function plannerPacks(')),c);assert.equal(c.plannerPublicationState(c.weeklyPlanner).canPublish,true);
 const publishButton={dataset:{plannerAction:'publish'},disabled:false,textContent:'Publish'};f.controls.push(publishButton);const original=c.document.querySelectorAll;c.document.querySelectorAll=q=>q==='#view [data-planner-action="publish"]'?[publishButton]:original(q);c.bindWeeklyPlanner();
 const old=c.loadWeeklyPlanner(true,'realtime');await tick();const oldCall=f.calls.at(-1);
 const unknown=c.weeklyPlannerRpc('publish_weekly_planner_pack',{p_week_start:week},'Published');f.calls.at(-1).resolve({status:504,error:{message:'Gateway timeout',code:''}});assert.equal(await unknown,false);
 assert.equal(c.plannerPublishVerificationRequired(),true);assert.equal(publishButton.disabled,true);assert.equal(c.plannerPublicationState(c.weeklyPlanner).canPublish,false);assert.ok(c.weeklyPlanner.sections.every(section=>section.status==='approved'));
 const afterUnknown=f.calls.length;await publishButton.onclick();assert.equal(await c.weeklyPlannerRpc('publish_weekly_planner_pack',{},'Published'),false);assert.equal(f.calls.length,afterUnknown);
 assert.equal(await c.loadWeeklyPlanner(),true,'cached ready result is not packet-history verification');assert.equal(f.calls.length,afterUnknown);assert.equal(c.plannerPublishVerificationRequired(),true);
 oldCall.resolve({data:validData()});assert.equal(await old,false);assert.equal(c.plannerPublishVerificationRequired(),true,'pre-publication response cannot clear the latch');
 let read=c.loadWeeklyPlanner(true);await tick();f.calls.at(-1).resolve({status:500,error:{code:'57014',message:'Definitive timeout'}});assert.equal(await read,false);assert.equal(c.plannerPublishVerificationRequired(),true);
 read=c.loadWeeklyPlanner(true);await tick();const malformed=validData();delete malformed.recent_packs;f.calls.at(-1).resolve({data:malformed});assert.equal(await read,true);assert.equal(c.plannerPublishVerificationRequired(),true,'a payload without packet history cannot verify publication');
 c.state.week='2026-11-02';read=c.loadWeeklyPlanner(true);await tick();f.calls.at(-1).resolve({data:validData()});assert.equal(await read,true);assert.equal(c.plannerPublishVerificationRequired(user,week),true);
 c.state.week=week;c.currentUser={id:'other-user'};c.hubSessionEpoch++;read=c.loadWeeklyPlanner(true);await tick();f.calls.at(-1).resolve({data:validData()});assert.equal(await read,true);assert.equal(c.plannerPublishVerificationRequired(user,week),true);
 c.currentUser={id:user.id};c.hubSessionEpoch++;assert.equal(c.plannerPublishVerificationRequired(),true,'latch survives re-login with the same user id');
 const renderLatch=[];c.plannerDashboard=()=>{renderLatch.push(c.plannerPublishVerificationRequired());return '<p>Snapshot</p>'};read=c.loadWeeklyPlanner(true);await tick();f.calls.at(-1).resolve({data:validData()});assert.equal(await read,true);
 assert.equal(c.plannerPublishVerificationRequired(),false);assert.equal(renderLatch.at(-1),false,'verified packet history clears the latch before rendering');assert.equal(c.plannerPublicationState(c.weeklyPlanner).canPublish,true);
 const beforePublish=f.calls.length,explicit=c.weeklyPlannerRpc('publish_weekly_planner_pack',{p_week_start:week},'Published');assert.equal(f.calls.length,beforePublish+1);assert.equal(await c.weeklyPlannerRpc('publish_weekly_planner_pack',{},'Duplicate'),false);
 f.calls.at(-1).resolve({data:{pack_version:2}});await tick();assert.equal(f.calls.at(-1).name,'get_weekly_planner_snapshot');f.calls.at(-1).resolve({data:validData()});assert.deepEqual(await explicit,{pack_version:2});
 assert.equal(f.calls.filter(call=>call.name==='publish_weekly_planner_pack').length,2,'only unknown original and one deliberate verified publication');assert.equal(f.maxActive(),1);
});

test('packet-history presentation failure restores publication latch until a later successful authoritative refresh',async()=>{
 const f=setup(),c=f.c;await f.init();const data={week:{source_stale:false},permissions:{publish:true},sections:Array.from({length:8},(_,i)=>({section_id:'section-'+i,status:'approved'})),recent_packs:[]};Object.assign(c.weeklyPlanner,data);
 const unknown=c.weeklyPlannerRpc('publish_weekly_planner_pack',{},'Published');f.calls.at(-1).resolve({status:0,error:{message:'Failed to fetch',code:''}});assert.equal(await unknown,false);assert.equal(c.plannerPublishVerificationRequired(),true);
 const other={id:'unrelated'};c.plannerPublishVerificationRequired.pending.push({user:other,userId:other.id,week:c.state.week});let failOnce=true;const rendered=[];
 c.plannerDashboard=()=>{rendered.push(c.plannerPublishVerificationRequired());if(failOnce){failOnce=false;throw Error('Synthetic packet-history presentation failure')}return '<p>Snapshot</p>'};
 let refresh=c.loadWeeklyPlanner(true);await tick();f.calls.at(-1).resolve({data:structuredClone(data)});assert.equal(await refresh,false);assert.deepEqual(rendered,[false]);assert.equal(c.plannerPublishVerificationRequired(),true);assert.equal(c.plannerPublishVerificationRequired(other),true);assert.equal(c.plannerPublishVerificationRequired.pending.length,2);assert.match(c.weeklyPlannerError,/presentation failure/);
 const before=f.calls.length;assert.equal(await c.weeklyPlannerRpc('publish_weekly_planner_pack',{},'Blocked'),false);await tick();assert.equal(f.calls.length,before,'presentation failure must not silently retry publication or snapshot');
 refresh=c.loadWeeklyPlanner(true);await tick();f.calls.at(-1).resolve({data:structuredClone(data)});assert.equal(await refresh,true);assert.equal(c.plannerPublishVerificationRequired(),false);assert.equal(c.plannerPublishVerificationRequired(other),true);assert.equal(c.plannerPublishVerificationRequired.pending.length,1);assert.deepEqual(rendered,[false,false]);assert.equal(f.maxActive(),1);
});
