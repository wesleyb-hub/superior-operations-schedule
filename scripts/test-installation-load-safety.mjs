// Actual inline Installation loader/coalescer; all requests are deferred synthetic reads.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const pending=[],renders=[];
 const c={console:{error(){}},hubSessionEpoch:0,currentUser:{id:'synthetic'},state:{view:'delivery',subview:{walls:'installation'},installationDay:'2026-10-19',installationView:'today',installationWeek:'2026-10-19',week:'2026-10-19'},wallsInstallationReady:true,wallsInstallationError:'',wallsInstallation:{jobs:[{record_id:'initial'}]},wallsInstallationChannel:{},wallSubviewAllowed:()=>true,normalizeDate:x=>x,todayISO:()=>'',weekStart:x=>x,addDays:(x,n)=>x+':'+n,render:()=>renders.push(true)};
 const request=(name,args)=>new Promise((resolve,reject)=>pending.push({name,args,resolve,reject}));
 c.sb={rpc:request,from:table=>({select:columns=>request(table,{columns})})};
 vm.createContext(c);vm.runInContext(part('let wallsInstallationLoadPromise=', 'function subscribeWallsInstallation('),c);
 return {c,pending,renders};
}
async function resolveSnapshot(f,index,id){f.pending[index].resolve({data:{jobs:[{record_id:id,activities:[{activity_id:'activity'}]}]}});await tick();f.pending[index+1].resolve({data:[{activity_id:'activity',assignment_id:'run'}]});await tick()}
test('Installation transport rejection settles false, clears coalescer and shows retryable error',{timeout:2000},async()=>{
 const f=fixture(),read=f.c.ensureWallsInstallationLoaded(true);f.pending[0].reject(Error('Synthetic offline'));assert.equal(await read,false);assert.equal(f.c.wallsInstallationReady,false);assert.equal(f.c.wallsInstallationError,'Synthetic offline');assert.equal(vm.runInContext('wallsInstallationLoadPromise',f.c),null);assert.equal(f.renders.length,1);
 const retry=f.c.ensureWallsInstallationLoaded(true);await resolveSnapshot(f,1,'recovered');assert.equal(await retry,true);assert.equal(f.c.wallsInstallationReady,true);assert.equal(f.c.wallsInstallationError,'');
});
test('Installation scope read rejection also settles false without partially applying snapshot',{timeout:2000},async()=>{
 const f=fixture(),read=f.c.loadWallsInstallation();f.pending[0].resolve({data:{jobs:[{record_id:'partial'}]}});await tick();f.pending[1].reject(Error('Synthetic scope offline'));assert.equal(await read,false);assert.equal(f.c.wallsInstallationReady,false);assert.equal(f.c.wallsInstallation.jobs[0].record_id,'initial');assert.equal(f.c.wallsInstallationError,'Synthetic scope offline');
});
test('Installation stale day or week result cannot apply or issue its follow-up scope query',{timeout:2000},async()=>{
 for(const change of [c=>{c.state.installationDay='2026-10-26'},c=>{c.state.installationView='week';c.state.installationWeek='2026-11-02'}]){
  const f=fixture(),read=f.c.loadWallsInstallation();change(f.c);f.pending[0].resolve({data:{jobs:[{record_id:'stale'}]}});assert.equal(await read,false);assert.equal(f.pending.length,1);assert.equal(f.c.wallsInstallation.jobs[0].record_id,'initial');assert.equal(f.renders.length,0);
 }
});
test('Installation stale scope response cannot replace a newer same-day snapshot',{timeout:2000},async()=>{
 const f=fixture(),old=f.c.loadWallsInstallation();f.pending[0].resolve({data:{jobs:[{record_id:'old'}]}});await tick();const fresh=f.c.loadWallsInstallation();await resolveSnapshot(f,2,'fresh');assert.equal(await fresh,true);f.pending[1].resolve({data:[]});assert.equal(await old,false);assert.equal(f.c.wallsInstallation.jobs[0].record_id,'fresh');assert.equal(f.c.wallsInstallation.jobs[0].activities[0].production_scope[0].assignment_id,'run');
});
test('Installation stale rejection cannot replace a replacement session state',{timeout:2000},async()=>{
 for(const change of [c=>{c.currentUser={id:'new'}},c=>{c.sb={}},c=>{c.hubSessionEpoch++},c=>{c.wallSubviewAllowed=()=>false}]){
  const f=fixture(),read=f.c.loadWallsInstallation();change(f.c);f.pending[0].reject(Error('Old private failure'));assert.equal(await read,false);assert.equal(f.c.wallsInstallationReady,true);assert.equal(f.c.wallsInstallationError,'');assert.equal(f.renders.length,0);
 }
});
test('forced Installation refresh invalidates old read and waits for one fresh trailing snapshot',{timeout:2000},async()=>{
 const f=fixture(),old=f.c.ensureWallsInstallationLoaded(true);f.c.state.installationDay='2026-10-26';const fresh=f.c.ensureWallsInstallationLoaded(true),alsoFresh=f.c.ensureWallsInstallationLoaded(true);let settled=false;fresh.then(()=>settled=true);assert.equal(f.pending.length,1);
 f.pending[0].resolve({data:{jobs:[{record_id:'old'}]}});assert.equal(await old,false);await tick();assert.equal(settled,false);assert.equal(f.pending.length,2);assert.match(f.pending[1].args.p_from,/2026-10-26/);await resolveSnapshot(f,1,'fresh');assert.equal(await fresh,true);assert.equal(await alsoFresh,true);assert.equal(f.c.wallsInstallation.jobs[0].record_id,'fresh');assert.equal(f.pending.length,3);
});
test('forced Installation trailing retry survives a failed older read',{timeout:2000},async()=>{
 const f=fixture(),old=f.c.ensureWallsInstallationLoaded(true),fresh=f.c.ensureWallsInstallationLoaded(true);f.pending[0].reject(Error('Obsolete failure'));assert.equal(await old,false);await tick();assert.equal(f.c.wallsInstallationError,'');await resolveSnapshot(f,1,'fresh');assert.equal(await fresh,true);
});
test('queued Installation refresh never follows a replacement session promise',{timeout:2000},async()=>{
 const f=fixture(),old=f.c.ensureWallsInstallationLoaded(true),queued=f.c.ensureWallsInstallationLoaded(true);f.c.hubSessionEpoch++;f.c.currentUser={id:'new'};vm.runInContext('wallsInstallationLoadPromise=null;wallsInstallationReloadQueued=false',f.c);const fresh=f.c.ensureWallsInstallationLoaded(true);f.pending[0].resolve({data:{jobs:[]}});assert.equal(await old,false);assert.equal(await queued,false);await resolveSnapshot(f,1,'new');assert.equal(await fresh,true);
});
