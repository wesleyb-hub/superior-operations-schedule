// Behavioral tests of the actual inline loader, using synthetic deferred RPCs only.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const loader=html.slice(html.indexOf('function loadWeeklyPlanner('),html.indexOf('function subscribeWeeklyPlanner('));
function setup(){
  const calls=[],errors=[];
  const context={Promise,console:{error:(...args)=>errors.push(args)},state:{week:'2026-10-19',view:'weekly-planner'},currentUser:{id:'synthetic-admin'},currentUserIsAdmin:true,weeklyPlanner:{marker:'initial'},weeklyPlannerReady:false,weeklyPlannerError:'',weeklyPlannerLoadPromise:null,weeklyPlannerLoadToken:null,weeklyPlannerLoadWeek:'',weeklyPlannerLoadedWeek:'',renders:0};
  context.renderWeeklyPlanner=()=>context.renders++;
  context.sb={rpc:(name,args)=>new Promise((resolve,reject)=>calls.push({name,args,resolve,reject}))};
  context.weeklyPlannerBusy=false;context.showInventoryToast=()=>{};
  vm.createContext(context);vm.runInContext(loader,context);
  vm.runInContext(html.slice(html.indexOf('async function weeklyPlannerRpc('),html.indexOf('function plannerCaptureInputs(')),context);
  return {context,calls,errors,load:force=>context.loadWeeklyPlanner(force)};
}
const tick=()=>Promise.resolve();
const result=marker=>({data:{marker},error:null});
test('ordinary concurrent loads deduplicate; forced post-write load does not reuse old read',async()=>{
  const {context:c,calls,load}=setup();const old=load();await tick();
  assert.equal(load(),old);const fresh=load(true);await tick();
  assert.notEqual(fresh,old);assert.equal(calls.length,2);
  calls[1].resolve(result('generated'));assert.equal(await fresh,true);
  calls[0].resolve(result('before-generation'));assert.equal(await old,false);
  assert.equal(c.weeklyPlanner.marker,'generated');assert.equal(c.renders,1);
});
test('older result resolving first cannot clear the newer in-flight request',async()=>{
  const {context:c,calls,load}=setup();const old=load();await tick();const fresh=load(true);await tick();
  calls[0].resolve(result('old'));assert.equal(await old,false);assert.equal(c.weeklyPlannerLoadPromise,fresh);
  calls[1].resolve(result('new'));assert.equal(await fresh,true);assert.equal(c.weeklyPlannerLoadPromise,null);
});
test('A to B to A navigation accepts only latest request, not first A',async()=>{
  const {context:c,calls,load}=setup();const a1=load();await tick();c.state.week='2026-10-26';const b=load();await tick();c.state.week='2026-10-19';const a2=load();await tick();
  assert.equal(calls.length,3);calls[2].resolve(result('latest-A'));await a2;
  calls[0].resolve(result('first-A'));calls[1].resolve(result('B'));assert.equal(await a1,false);assert.equal(await b,false);
  assert.equal(c.weeklyPlanner.marker,'latest-A');assert.equal(c.renders,1);
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
test('superseded error cannot replace successful newer snapshot with error screen',async()=>{
  const {context:c,calls,errors,load}=setup();const old=load();await tick();const fresh=load(true);await tick();calls[1].resolve(result('fresh'));await fresh;
  calls[0].reject(new Error('old failure'));assert.equal(await old,false);assert.equal(c.weeklyPlannerReady,true);assert.equal(c.weeklyPlannerError,'');assert.equal(errors.length,0);
});
test('current RPC error clears pending slot and allows explicit retry',async()=>{
  const {context:c,calls,load}=setup();const first=load();await tick();calls[0].resolve({error:{message:'Synthetic offline'}});assert.equal(await first,false);assert.equal(c.weeklyPlannerError,'Synthetic offline');assert.equal(c.weeklyPlannerLoadPromise,null);
  const retry=load(true);await tick();calls[1].resolve(result('recovered'));assert.equal(await retry,true);assert.equal(c.weeklyPlannerError,'');
});
test('synchronous RPC failure also clears promise slot rather than rejecting loader',async()=>{
  const {context:c,load}=setup();c.sb.rpc=()=>{throw new Error('Synthetic synchronous failure')};assert.equal(await load(true),false);assert.equal(c.weeklyPlannerLoadPromise,null);assert.equal(c.weeklyPlannerError,'Synthetic synchronous failure');
});
test('cached ready week avoids unnecessary reads unless forced',async()=>{
  const {context:c,calls,load}=setup();c.weeklyPlannerReady=true;c.weeklyPlannerLoadedWeek=c.state.week;assert.equal(await load(),true);assert.equal(calls.length,0);
  const fresh=load(true);await tick();assert.equal(calls.length,1);calls[0].resolve(result('fresh'));await fresh;
});

test('Generate RPC completion waits for a new snapshot instead of pre-generation read',async()=>{
  const {context:c,calls,load}=setup();const old=load();await tick();
  const generation=c.weeklyPlannerRpc('generate_weekly_planner',{p_week_start:c.state.week},'Generated');
  assert.equal(calls[1].name,'generate_weekly_planner');calls[1].resolve({data:true,error:null});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,3);assert.equal(calls[2].name,'get_weekly_planner_snapshot');
  calls[2].resolve(result('generated'));assert.equal(await generation,true);
  calls[0].resolve(result('before-generation'));assert.equal(await old,false);assert.equal(c.weeklyPlanner.marker,'generated');
});
