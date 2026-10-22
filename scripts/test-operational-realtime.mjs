// Actual inline realtime queues/subscriptions, synthetic deferred reads and fake clock only.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(kind){
 const reads=[],channels=[],timers=new Map();let timer=0;
 const c={Promise,hubSessionEpoch:0,currentUser:{id:'synthetic'},state:{productionDay:'2026-10-19'},productionBusy:false,inventoryBusy:false,productionChannel:null,inventoryChannel:null,wallsProductionReady:true,wallsProductionError:'',inventoryReady:true,inventoryLoadError:'',inventoryScopeKey:'walls-production',inventoryScopeDefinitions:[{key:'walls-production',division:'walls',area:'production'},{key:'walls-install',division:'walls',area:'install'}],normalizeDate:x=>x,todayISO:()=>'',wallSubviewAllowed:()=>true,setTimeout(fn,ms){assert.equal(ms,350);timers.set(++timer,fn);return timer}};
 c.sb={channel(name){const channel={name,handlers:[],on(_event,filter,handler){this.handlers.push({filter,handler});return this},subscribe(){return this}};channels.push(channel);return channel},removeChannel(){}};
 c.loadWallsProduction=c.loadInventory=()=>new Promise((resolve,reject)=>reads.push({resolve,reject,key:kind==='production'?c.state.productionDay:c.inventoryScopeKey}));
 vm.createContext(c);
 vm.runInContext(part('function createOperationalRealtimeRefresh(', 'async function wallsProductionRpc('),c);
 vm.runInContext(part('function subscribeInventory(', 'async function inventoryRpc('),c);
 const subscribe=()=>kind==='production'?c.subscribeWallsProduction():c.subscribeInventory();subscribe();
 const notify=(index=channels.length-1,payload={new:{}})=>channels[index].handlers[0].handler(payload);
 const advance=async()=>{await tick();const due=[...timers.values()];timers.clear();due.forEach(fn=>fn());await tick()};
 const setFailed=()=>{if(kind==='production'){c.wallsProductionReady=false;c.wallsProductionError='Synthetic offline'}else{c.inventoryReady=false;c.inventoryLoadError='Synthetic offline'}};
 const recover=()=>{if(kind==='production'){c.wallsProductionReady=true;c.wallsProductionError=''}else{c.inventoryReady=true;c.inventoryLoadError=''}};
 const busy=value=>{c[kind==='production'?'productionBusy':'inventoryBusy']=value};
 const key=value=>{if(kind==='production')c.state.productionDay=value;else c.inventoryScopeKey=value};
 return {c,reads,channels,timers,notify,advance,setFailed,recover,busy,key,subscribe};
}
for(const kind of ['production','inventory']){
 test(`${kind}: bursts have one in-flight read and one paced trailing refresh`,async()=>{
  const f=fixture(kind);for(let n=0;n<100;n++){f.notify();await tick()}
  assert.equal(f.reads.length,0);assert.equal(f.timers.size,1);
  await f.advance();assert.equal(f.reads.length,1);
  for(let n=0;n<100;n++){f.notify();await tick()}
  assert.equal(f.reads.length,1);assert.equal(f.timers.size,0);
  f.reads[0].resolve(true);await tick();assert.equal(f.timers.size,1);
  await f.advance();assert.equal(f.reads.length,2);f.reads[1].resolve(true);await tick();
  assert.equal(f.timers.size,0);assert.equal(f.reads.length,2);
 });
 test(`${kind}: rejected request pauses storms until explicit recovery`,async()=>{
  const f=fixture(kind);f.notify();await f.advance();f.setFailed();f.reads[0].reject(Error('Synthetic rejected read'));await tick();
  for(let n=0;n<40;n++){f.notify();await f.advance()}
  assert.equal(f.reads.length,1);f.recover();f.notify();await f.advance();assert.equal(f.reads.length,2);f.reads[1].resolve(true);await tick();
 });
 test(`${kind}: failed result drops queued trailing work and does not hammer backend`,async()=>{
  const f=fixture(kind);f.notify();await f.advance();f.notify();f.setFailed();f.reads[0].resolve(false);await tick();
  for(let n=0;n<40;n++){f.notify();await f.advance()}
  assert.equal(f.reads.length,1);assert.equal(f.timers.size,0);
 });
 test(`${kind}: an existing error requires successful refresh before realtime resumes`,async()=>{
  const f=fixture(kind);f.setFailed();f.notify();await f.advance();assert.equal(f.reads.length,0);
  // Starting an explicit retry clears an error in the inventory loader, but is not success.
  f.c.inventoryLoadError='';f.notify();await f.advance();assert.equal(f.reads.length,0);
  f.recover();f.notify();await f.advance();assert.equal(f.reads.length,1);f.reads[0].resolve(true);await tick();
 });
 test(`${kind}: obsolete subscription and session cannot start or trail reads`,async()=>{
  for(const change of [f=>f.c.currentUser=null,f=>f.c.currentUser={id:'replacement'},f=>f.c.hubSessionEpoch++,f=>f.c.sb={},f=>f.subscribe()]){
   const f=fixture(kind);f.notify();await f.advance();f.notify();change(f);f.reads[0].resolve(true);await f.advance();f.notify(0);await f.advance();assert.equal(f.reads.length,1);
  }
 });
 test(`${kind}: A-to-B-to-A rejects obsolete queue and old completion cannot clear new queue`,async()=>{
  const f=fixture(kind),a=kind==='production'?f.c.state.productionDay:f.c.inventoryScopeKey;
  f.notify();await f.advance();f.notify();f.key('context-B');f.notify();await f.advance();f.key(a);f.notify();await f.advance();
  assert.equal(f.reads.length,3);f.reads[0].resolve(true);f.reads[1].resolve(true);await f.advance();assert.equal(f.reads.length,3);
  f.notify();f.reads[2].resolve(true);await f.advance();assert.equal(f.reads.length,4);assert.equal(f.reads[3].key,a);f.reads[3].resolve(true);await tick();
 });
 test(`${kind}: pending debounce is canceled by busy save, while post-write refresh stays independent`,async()=>{
  const f=fixture(kind);f.notify();f.busy(true);await f.advance();assert.equal(f.reads.length,0);f.notify();await f.advance();assert.equal(f.reads.length,0);
  f.busy(false);const postWrite=kind==='production'?f.c.loadWallsProduction():f.c.loadInventory();assert.equal(f.reads.length,1);
  f.notify();await f.advance();assert.equal(f.reads.length,2,'at most one realtime read may coexist with an explicit load');
  f.reads[0].resolve(true);await postWrite;f.reads[1].resolve(true);await tick();
 });
 test(`${kind}: events after a newer explicit read began survive obsolete realtime completion`,async()=>{
  const f=fixture(kind);f.notify();await f.advance();
  const direct=kind==='production'?f.c.loadWallsProduction():f.c.loadInventory();assert.equal(f.reads.length,2);
  f.notify(); // This invalidation was not covered by the already-started direct read.
  f.reads[0].resolve(false);await tick();assert.equal(f.timers.size,1,'superseded result must retain the dirty trailing snapshot');
  f.reads[1].resolve(true);await direct;await f.advance();assert.equal(f.reads.length,3);
  f.reads[2].resolve(true);await tick();assert.equal(f.timers.size,0);
 });
 test(`${kind}: post-write refresh never waits for or reuses stalled realtime read`,async()=>{
  const f=fixture(kind);f.notify();await f.advance();const direct=kind==='production'?f.c.loadWallsProduction():f.c.loadInventory();
  assert.equal(f.reads.length,2);f.reads[1].resolve(true);assert.equal(await direct,true);f.reads[0].resolve(false);await tick();assert.equal(f.timers.size,0);
 });
}
test('inventory: unrelated area item events do not spend the refresh budget',async()=>{
 const f=fixture('inventory');f.notify(0,{new:{division_key:'boxes',inventory_area:'production'}});await f.advance();assert.equal(f.reads.length,0);
 f.notify(0,{new:{division_key:'walls',inventory_area:'production'}});await f.advance();assert.equal(f.reads.length,1);f.reads[0].resolve(true);await tick();
});
test('production: permission revocation cancels queued reads',async()=>{
 const f=fixture('production');f.notify();f.c.wallSubviewAllowed=()=>false;await f.advance();assert.equal(f.reads.length,0);
});
