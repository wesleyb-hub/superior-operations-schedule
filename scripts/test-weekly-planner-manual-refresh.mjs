import {installHubReaderHelpers} from './hub-reader-test-helpers.mjs';
// Actual manual-refresh and snapshot-loader functions; deferred synthetic reads only.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const calls=[],messages=[],c={Promise,console:{error(){}},state:{week:'2026-10-26',view:'weekly-planner'},currentUser:{id:'synthetic'},currentUserIsAdmin:true,hubSessionEpoch:1,weeklyPlanner:{},weeklyPlannerBusy:false,weeklyPlannerProgress:null,weeklyPlannerManualRefreshRequest:null,weeklyPlannerDraftError:'',weeklyPlannerLoadPromise:null,weeklyPlannerLoadToken:null,weeklyPlannerLoadWeek:'',weeklyPlannerLoadedWeek:'',weeklyPlannerReady:false,weeklyPlannerError:'',weeklyPlannerErrorWeek:'',document:{querySelectorAll:()=>[],getElementById:()=>null},renderWeeklyPlanner:()=>{},showInventoryToast:m=>messages.push(m),names:0};
 c.sb={rpc:(name,args)=>new Promise((resolve,reject)=>calls.push({name,args,resolve,reject}))};
 for(const name of ['loadWeeklyPlannerInstallEmployees','loadPlannerEmployeeHistory','loadPlannerCompanyRoster'])c[name]=async()=>{c.names++;return true};
 vm.createContext(c);installHubReaderHelpers(c,html);
 vm.runInContext(html.slice(html.indexOf('function loadWeeklyPlanner('),html.indexOf('// Realtime invalidations')),c);
 vm.runInContext(html.slice(html.indexOf('function plannerUpdatePendingUI('),html.indexOf('function plannerRefreshSectionMetadata(')),c);
 return {c,calls,messages};
}
test('40 manual refresh clicks share one stalled snapshot and settle without an automatic trailing read',async()=>{
 const {c,calls}=setup(),first=c.refreshWeeklyPlannerManually();await tick();
 for(let i=0;i<40;i++)assert.equal(c.refreshWeeklyPlannerManually(),first);
 assert.equal(calls.length,1);calls[0].resolve({data:{sections:[]}});assert.equal(await first,true);assert.equal(calls.length,1);assert.equal(c.names,3);assert.equal(c.weeklyPlannerManualRefreshRequest,null);
});
test('rejected manual snapshot settles and only a new deliberate refresh retries',async()=>{
 const {c,calls}=setup(),first=c.refreshWeeklyPlannerManually();await tick();calls[0].reject(Error('synthetic timeout'));assert.equal(await first,false);assert.equal(c.names,0);assert.equal(c.weeklyPlannerManualRefreshRequest,null);
 await tick();assert.equal(calls.length,1);const next=c.refreshWeeklyPlannerManually();await tick();calls[1].resolve({data:{}});assert.equal(await next,true);
});
test('manual refresh cannot reuse or clear a newer session or week owner',async()=>{
 for(const change of [c=>{c.currentUser={id:'new'};c.hubSessionEpoch++},c=>{c.state.week='2026-11-02'}]){
  const {c,calls}=setup(),old=c.refreshWeeklyPlannerManually();await tick();change(c);const fresh=c.refreshWeeklyPlannerManually();await tick();assert.notEqual(fresh,old);assert.equal(calls.length,1);const owner=c.weeklyPlannerManualRefreshRequest;
  calls[0].resolve({data:{marker:'old'}});assert.equal(await old,false);assert.equal(c.weeklyPlannerManualRefreshRequest,owner);assert.equal(c.names,0);await tick();assert.equal(calls.length,2);calls[1].resolve({data:{marker:'fresh'}});assert.equal(await fresh,true);assert.equal(c.weeklyPlanner.marker,'fresh');
 }
});
test('post-write forced load queues behind manual transport but never reuses its pre-write response',async()=>{
 const {c,calls}=setup(),manual=c.refreshWeeklyPlannerManually();await tick();const postWrite=c.loadWeeklyPlanner(true);await tick();assert.equal(calls.length,1);
 calls[0].resolve({data:{marker:'old'}});assert.equal(await manual,false);await tick();assert.equal(calls.length,2);calls[1].resolve({data:{marker:'saved'}});assert.equal(await postWrite,true);assert.equal(c.weeklyPlanner.marker,'saved');
});
test('manual refresh does not start while approval is still pending',async()=>{
 const {c,calls}=setup();c.weeklyPlannerProgress={action:'approve-section'};assert.equal(await c.refreshWeeklyPlannerManually(),false);assert.equal(calls.length,0);
});

test('manual refresh replaces its pending feedback with a confirmed terminal message',async()=>{
 const {c,calls}=setup(),feedback={textContent:''};c.document.getElementById=()=>feedback;
 const request=c.refreshWeeklyPlannerManually();await tick();assert.match(feedback.textContent,/Refreshing this weekly plan/);
 calls[0].resolve({data:{sections:[]}});assert.equal(await request,true);assert.equal(feedback.textContent,'Weekly plan refreshed.');
});

test('superseded-week manual refresh restores owned controls without stale feedback',async()=>{
 const {c,calls}=setup(),button={dataset:{plannerAction:'reload'},disabled:false,textContent:'Refresh screen'},preDisabled={dataset:{plannerAction:'publish'},disabled:true,textContent:'Publish'},feedback={textContent:''};
 c.document.querySelectorAll=()=>[button,preDisabled];c.document.getElementById=()=>feedback;
 const pending=c.refreshWeeklyPlannerManually();await tick();assert.equal(button.disabled,true);assert.equal(button.textContent,'Refreshing…');
 c.state.week='2026-11-02';feedback.textContent='New week view';calls[0].resolve({data:{marker:'old'}});assert.equal(await pending,false);
 assert.equal(c.weeklyPlannerManualRefreshRequest,null);assert.equal(button.disabled,false);assert.equal(button.textContent,'Refresh screen');assert.equal(preDisabled.disabled,true);assert.equal(feedback.textContent,'New week view');
});
