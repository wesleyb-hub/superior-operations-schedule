import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
function fixture(){
  const pending=[],alerts=[],toasts=[];
  const c={hubSessionEpoch:0,console:{error(){}},state:{productionDay:'2026-10-19',view:'other',subview:{}},currentUser:{id:'synthetic'},wallsProduction:{marker:'initial'},wallsProductionReady:false,wallsProductionError:'',productionBusy:false,wallSubviewAllowed:()=>true,normalizeDate:x=>x,todayISO:()=>'',weekStart:x=>x,addDays:x=>x,alert:x=>alerts.push(x),showInventoryToast:x=>toasts.push(x),sb:{rpc:(name,args)=>new Promise((resolve,reject)=>pending.push({name,args,resolve,reject}))}};
  vm.createContext(c);
  vm.runInContext(part('let wallsProductionLoadToken=','let wallsInstallationLoadPromise='),c);
  vm.runInContext(part('async function wallsProductionRpc(', 'function closeProductionModal('),c);
  return {c,pending,alerts,toasts,resolve:(offset,marker)=>{pending[offset].resolve({data:{marker}});pending[offset+1].resolve({data:{}})}};
}
test('older date response cannot overwrite latest production data',async()=>{
  const f=fixture(),old=f.c.loadWallsProduction();f.c.state.productionDay='2026-10-26';
  const latest=f.c.loadWallsProduction();f.resolve(2,'new');assert.equal(await latest,true);
  f.resolve(0,'old');assert.equal(await old,false);assert.equal(f.c.wallsProduction.marker,'new');
});
test('older same-day response cannot overwrite newer refresh',async()=>{
  const f=fixture(),old=f.c.loadWallsProduction(),latest=f.c.loadWallsProduction();
  f.resolve(2,'new');await latest;f.resolve(0,'old');await old;assert.equal(f.c.wallsProduction.marker,'new');
});
test('sign-out and replacement user reject pending production data',async()=>{
  for(const replacement of [null,{id:'another-synthetic'}]){
    const f=fixture(),load=f.c.loadWallsProduction();f.c.currentUser=replacement;
    f.resolve(0,'private');assert.equal(await load,false);assert.equal(f.c.wallsProduction.marker,'initial');
  }
});
test('stale failures do not replace current ready state',async()=>{
  const f=fixture(),old=f.c.loadWallsProduction(),latest=f.c.loadWallsProduction();
  f.resolve(2,'new');await latest;f.pending[0].reject(Error('old failure'));
  assert.equal(await old,false);assert.equal(f.c.wallsProductionReady,true);assert.equal(f.c.wallsProductionError,'');
});
test('current rejected load returns false with actionable error',async()=>{
  const f=fixture(),load=f.c.loadWallsProduction();f.pending[0].reject(Error('synthetic offline'));
  assert.equal(await load,false);assert.equal(f.c.wallsProductionReady,false);assert.equal(f.c.wallsProductionError,'synthetic offline');
});
test('rejected save releases busy latch and never reports success',async()=>{
  const f=fixture(),save=f.c.wallsProductionRpc('synthetic',{},'Saved');
  assert.equal(f.c.productionBusy,true);f.pending[0].reject(Error('synthetic offline'));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.c.productionBusy,false);
  f.resolve(1,'refresh');assert.equal(await save,false);assert.equal(f.alerts.length,1);assert.equal(f.toasts.length,0);
});
test('successful write with failed refresh is not reported as failed write',async()=>{
  const f=fixture(),save=f.c.wallsProductionRpc('synthetic',{},'Saved');
  f.pending[0].resolve({data:{}});await new Promise(resolve=>setImmediate(resolve));
  f.pending[1].reject(Error('refresh offline'));assert.equal(await save,true);
  assert.match(f.toasts[0],/^Saved\. Refresh/);assert.equal(f.alerts.length,0);assert.equal(f.c.productionBusy,false);
});
test('save finishing after sign-out does not reload or display private status',async()=>{
  const f=fixture(),save=f.c.wallsProductionRpc('synthetic',{},'Saved');f.c.currentUser=null;f.c.hubSessionEpoch++;f.c.productionBusy=false;
  f.pending[0].resolve({data:{}});assert.equal(await save,false);assert.equal(f.pending.length,1);assert.equal(f.toasts.length,0);assert.equal(f.c.productionBusy,false);
});
test('client replacement or revoked access discards pending production data',async()=>{
  for(const change of [c=>{c.sb={}},c=>{c.wallSubviewAllowed=()=>false}]){
    const f=fixture(),load=f.c.loadWallsProduction();change(f.c);f.resolve(0,'private');
    assert.equal(await load,false);assert.equal(f.c.wallsProduction.marker,'initial');
  }
});
test('returning to first date still rejects its obsolete request',async()=>{
  const f=fixture(),first=f.c.loadWallsProduction();f.c.state.productionDay='2026-10-26';
  const middle=f.c.loadWallsProduction();f.c.state.productionDay='2026-10-19';const latest=f.c.loadWallsProduction();
  f.resolve(4,'latest');await latest;f.resolve(0,'obsolete');f.resolve(2,'middle');
  await Promise.all([first,middle]);assert.equal(f.c.wallsProduction.marker,'latest');
});
test('transport failure tells staff result is unconfirmed, without retrying the write',async()=>{
  const f=fixture(),save=f.c.wallsProductionRpc('synthetic',{},'Saved');f.pending[0].reject(Error('connection lost'));
  await new Promise(resolve=>setImmediate(resolve));f.resolve(1,'refresh');await save;
  assert.match(f.alerts[0],/Could not confirm/);assert.equal(f.pending.filter(x=>x.name==='synthetic').length,1);
});

test('old production save cannot clear a replacement session busy latch or publish feedback',async()=>{
  for(const settle of ['resolve','reject'])for(const change of [c=>{c.currentUser={id:'new'}},c=>{c.sb={}},c=>{c.hubSessionEpoch++}]){
    const f=fixture(),save=f.c.wallsProductionRpc('synthetic',{},'Saved');change(f.c);f.c.productionBusy=true;
    f.pending[0][settle](settle==='resolve'?{data:{}}:Error('old response lost'));
    assert.equal(await save,false);assert.equal(f.c.productionBusy,true);assert.equal(f.pending.length,1);assert.equal(f.alerts.length,0);assert.equal(f.toasts.length,0);
  }
});
test('production read rejects reused user and client identities after session epoch advances',async()=>{
  const f=fixture(),load=f.c.loadWallsProduction();f.c.hubSessionEpoch++;f.resolve(0,'private');
  assert.equal(await load,false);assert.equal(f.c.wallsProduction.marker,'initial');
});
test('production save refreshing across replacement session never posts old success',async()=>{
  const f=fixture(),save=f.c.wallsProductionRpc('synthetic',{},'Saved');f.pending[0].resolve({data:{}});
  await new Promise(resolve=>setImmediate(resolve));f.c.hubSessionEpoch++;f.c.productionBusy=true;f.resolve(1,'old');
  await save;assert.equal(f.c.productionBusy,true);assert.equal(f.toasts.length,0);assert.equal(f.c.wallsProduction.marker,'initial');
});
