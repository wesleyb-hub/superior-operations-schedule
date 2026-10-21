import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const pending=[],messages=[],nodes=new Map(),removed=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',replaceChildren(){this.cleared=true}});return nodes.get(id)};
 const c={console:{error(){}},Promise,clearTimeout,Date,JSON,clone:x=>JSON.parse(JSON.stringify(x)),seed:{walls:[]},state:{view:'other',walls:[{id:'draft'}]},currentUser:{id:'test',email:'test@example.invalid'},sb:null,currentUserCanWrite:true,currentUserIsAdmin:true,remoteReady:true,structuredBackendReady:true,lastRevision:1,lastRemoteData:{},lastSharedJson:'',lastRemoteUpdatedAt:'',saveBusy:false,saveQueued:false,queuedReason:'Saved',inventoryScopeKey:'walls-production',inventoryAvailableScopes:[],inventoryItems:[],inventoryEvents:[],inventoryReady:false,inventoryLoadError:'',inventoryBusy:false,inventoryScopeDefinitions:[{key:'walls-production',division:'walls',area:'production'},{key:'walls-install',division:'walls',area:'install'}],stateChannel:{id:1},inventoryChannel:{id:2},productionChannel:null,weeklyPlannerChannel:null,wallsInstallationChannel:null,weeklyPlannerRefreshTimer:null,wallsInstallationReloadTimer:null,loadUiPrefs:()=>({}),showAuthGate(){},setAuthMode(){},setAuthMessage:m=>messages.push(m),document:{getElementById:node,querySelectorAll:()=>[]},alert:m=>messages.push(m),showInventoryToast:m=>messages.push(m),renderInventory(){},saveUiPrefs(){},sharedDataFromState:s=>JSON.parse(JSON.stringify(s)),validateOperationalTransition:()=>'',applyRemoteRow:async row=>{c.applied=row;return true}};
 const request=(name,args)=>new Promise((resolve,reject)=>pending.push({name,args,resolve,reject}));
 c.sb={rpc:request,from(table){const q={};for(const method of ['select','eq','order','in','limit','update'])q[method]=()=>q;q.then=(resolve,reject)=>request(table).then(resolve,reject);return q},removeChannel:async channel=>removed.push(channel),auth:{signOut:()=>request('signOut')}};
 vm.createContext(c);vm.runInContext(part('let hubSessionEpoch=','function updateAccessStatus('),c);
 vm.runInContext(part('async function loadRemoteState(', 'function validateOperationalTransition('),c);
 vm.runInContext(part('async function persistState(', 'function subscribeLive('),c);
 vm.runInContext(part('async function loadInventory(', 'function subscribeInventory('),c);
 vm.runInContext(part('async function inventoryRpc(', 'function defaultWallPlanReview('),c);
 return {c,pending,messages,nodes,removed};
}
const scopes={data:[{division_key:'walls',inventory_area:'production',can_view:true},{division_key:'walls',inventory_area:'install',can_view:true}]};
async function finishInventory(f,index,id){f.pending[index].resolve(scopes);await tick();f.pending[index+1].resolve({data:[{item_id:id,description:id}]});await tick();f.pending[index+2].resolve({data:[]});await tick()}
test('master rejected save releases latch, preserves draft, drops queue and never resubmits unknown outcome',async()=>{
 const f=fixture(),save=f.c.persistState();assert.equal(f.c.saveBusy,true);await f.c.persistState('queued');
 f.pending[0].reject(Error('network lost'));assert.equal(await save,false);
 assert.equal(f.c.saveBusy,false);assert.equal(f.c.saveQueued,false);assert.equal(f.c.remoteReady,false);assert.equal(f.c.state.walls[0].id,'draft');assert.equal(f.pending.length,1);assert.match(f.messages[0],/may have been saved/);assert.equal(await f.c.persistState(),false);
});
test('master returned save error preserves draft and requires deliberate refresh',async()=>{
 const f=fixture(),save=f.c.persistState();f.pending[0].resolve({error:{message:'synthetic failure'}});assert.equal(await save,false);assert.equal(f.c.saveBusy,false);assert.equal(f.c.remoteReady,false);assert.equal(f.pending.length,1);
 const refresh=f.c.loadRemoteState();f.pending[1].resolve({data:{revision:2}});assert.equal(await refresh,true);
});
test('master successful save keeps queued newer edits',async()=>{
 const f=fixture(),save=f.c.persistState();f.c.state.walls.push({id:'newer'});await f.c.persistState();f.pending[0].resolve({data:{revision:2}});assert.equal(await save,true);assert.equal(f.pending.length,2);f.pending[1].resolve({data:{revision:3}});await tick();assert.equal(f.c.lastRevision,3);assert.equal(f.c.saveBusy,false);
});
test('master latest response wins and stale errors are ignored',async()=>{
 const f=fixture(),old=f.c.loadRemoteState(),fresh=f.c.loadRemoteState();f.pending[1].resolve({data:{revision:3}});await fresh;f.pending[0].reject(Error('old'));assert.equal(await old,false);assert.equal(f.c.applied.revision,3);assert.equal(f.c.remoteReady,true);
});
test('inventory same-scope older read cannot replace latest data',async()=>{
 const f=fixture(),old=f.c.loadInventory(),fresh=f.c.loadInventory();await finishInventory(f,1,'latest');assert.equal(await fresh,true);f.pending[0].resolve(scopes);assert.equal(await old,false);assert.equal(f.c.inventoryItems[0].id,'latest');
});
test('inventory scope switch ignores late item response',async()=>{
 const f=fixture(),old=f.c.loadInventory();f.pending[0].resolve(scopes);await tick();f.c.inventoryScopeKey='walls-install';const fresh=f.c.loadInventory();await finishInventory(f,2,'install');await fresh;f.pending[1].resolve({data:[{item_id:'old-production'}]});assert.equal(await old,false);assert.equal(f.c.inventoryItems[0].id,'install');
});
test('inventory rejected loader produces retryable error',async()=>{
 const f=fixture(),load=f.c.loadInventory();f.pending[0].reject(Error('offline'));assert.equal(await load,false);assert.equal(f.c.inventoryReady,false);assert.equal(f.c.inventoryLoadError,'offline');
});
test('inventory rejected save clears busy and reports unknown outcome without resubmit',async()=>{
 const f=fixture(),save=f.c.inventoryRpc('test',{},'Saved');f.pending[0].reject(Error('offline'));assert.equal(await save,false);assert.equal(f.c.inventoryBusy,false);assert.equal(f.c.inventoryReady,false);assert.match(f.c.inventoryLoadError,/unknown/);assert.match(f.messages[0],/no automatic retry/);assert.equal(f.pending.length,1);
});
test('inventory saved but refresh fails is not described as failed write',async()=>{
 const f=fixture(),save=f.c.inventoryRpc('test',{},'Saved');f.pending[0].resolve({data:{}});await tick();f.pending[1].reject(Error('offline'));assert.equal(await save,true);assert.match(f.messages[0],/^Saved\. Inventory could not refresh/);
});
test('signout invalidates pending reads and saves synchronously even while network is stalled',async()=>{
 const f=fixture(),master=f.c.loadRemoteState(),inventory=f.c.loadInventory(),save=f.c.persistState(),logout=f.c.signOut();
 assert.equal(f.c.currentUser,null);assert.equal(f.c.saveBusy,false);assert.equal(f.c.inventoryItems.length,0);assert.equal(f.nodes.get('view').cleared,true);
 f.pending[0].resolve({data:{revision:20}});f.pending[1].resolve(scopes);f.pending[2].resolve({data:{revision:20}});
 assert.equal(await master,false);assert.equal(await inventory,false);assert.equal(await save,false);assert.equal(f.c.lastRevision,0);assert.equal(f.c.applied,undefined);await tick();assert.equal(f.removed.length,2);
 f.pending[3].reject(Error('logout offline'));await logout;assert.match(f.messages.at(-1),/screen is locked/);
});
test('old-session save cannot clear new-session busy state',async()=>{
 const f=fixture(),save=f.c.persistState();f.c.resetLocalSession();f.c.currentUser={id:'new'};f.c.saveBusy=true;f.pending[0].resolve({data:{revision:9}});assert.equal(await save,false);assert.equal(f.c.saveBusy,true);assert.equal(f.c.lastRevision,0);
});
test('pending access lookup cannot restore roles after signout',async()=>{
 const f=fixture();f.c.applyAccessNavigation=()=>{};f.c.updateAccessStatus=()=>{};
 vm.runInContext(part('async function loadCurrentAccess(', 'async function applyRemoteRow('),f.c);
 const access=f.c.loadCurrentAccess(f.c.currentUser);f.c.resetLocalSession();f.pending[0].resolve({data:{authorized:true,is_admin:true,can_write:true}});await access;assert.equal(f.c.currentUserIsAdmin,false);assert.equal(f.c.currentUserAuthorized,false);
});
test('pending installation snapshot cannot repopulate signed-out cache',async()=>{
 const f=fixture();Object.assign(f.c,{wallSubviewAllowed:()=>true,normalizeDate:x=>x,todayISO:()=>'',weekStart:x=>x,addDays:x=>x});
 vm.runInContext(part('async function loadWallsInstallation(', 'function subscribeWallsInstallation('),f.c);
 const request=f.c.loadWallsInstallation();f.c.resetLocalSession();f.pending[0].resolve({data:{jobs:[{id:'private'}]}});assert.equal(await request,false);assert.equal(f.c.wallsInstallation.jobs.length,0);
});
test('installation coalescer never clears a replacement session request',async()=>{
 const f=fixture(),loads=[];Object.assign(f.c,{wallsInstallationReady:false,wallsInstallationChannel:{},subscribeWallsInstallation(){},loadWallsInstallation:()=>new Promise(resolve=>loads.push(resolve))});
 vm.runInContext(part('let wallsInstallationLoadPromise=', 'async function loadWallsInstallation('),f.c);
 const old=f.c.ensureWallsInstallationLoaded();f.c.resetLocalSession();f.c.currentUser={id:'replacement'};const fresh=f.c.ensureWallsInstallationLoaded();loads[0](false);await old;assert.equal(f.c.ensureWallsInstallationLoaded(),fresh);loads[1](true);assert.equal(await fresh,true);
});
test('late assistant answer is discarded after logout',async()=>{
 const f=fixture();f.c.appendAssistantMessage=()=>{throw Error('stale answer leaked')};f.c.sb.auth.getSession=async()=>({data:{session:{access_token:'synthetic-not-a-token'}}});f.c.sb.functions={invoke:()=>new Promise(resolve=>f.pending.push({resolve}))};
 vm.runInContext(part('async function askOperationsAgent(', 'function openAssistant('),f.c);
 const answer=f.c.askOperationsAgent('synthetic');await tick();f.c.resetLocalSession();f.pending[0].resolve({data:{type:'answer',message:'synthetic'}});await answer;
});
test('legacy installation employee response cannot restore old-session names',async()=>{
 const f=fixture();Object.assign(f.c,{weeklyPlannerInstallEmployeesPromise:null,weeklyPlannerInstallEmployeesReady:false,weeklyPlannerInstallEmployees:[]});
 f.c.sb.from=()=>{const q={};for(const method of ['select','eq','not','limit'])q[method]=()=>q;q.then=(resolve,reject)=>new Promise((r,j)=>f.pending.push({resolve:r,reject:j})).then(resolve,reject);return q};
 vm.runInContext(html.split(/\r?\n/).find(line=>line.startsWith('async function loadWeeklyPlannerInstallEmployees(')),f.c);
 const load=f.c.loadWeeklyPlannerInstallEmployees();await tick();f.c.resetLocalSession();f.pending[0].resolve({data:[{resource_name:'Old synthetic employee'}]});assert.equal(await load,false);assert.equal(f.c.weeklyPlannerInstallEmployees.length,0);assert.equal(f.c.weeklyPlannerInstallEmployeesReady,false);
});
test('pending master refresh cannot discard retained draft after failed save',async()=>{
 const f=fixture(),read=f.c.loadRemoteState(),save=f.c.persistState();f.pending[1].reject(Error('unknown outcome'));await save;f.pending[0].resolve({data:{revision:9}});assert.equal(await read,false);assert.equal(f.c.applied,undefined);assert.equal(f.c.remoteReady,false);assert.equal(f.c.state.walls[0].id,'draft');
});
test('pending inventory read cannot unlock unknown-outcome save',async()=>{
 const f=fixture(),read=f.c.loadInventory(),save=f.c.inventoryRpc('test',{},'Saved');f.pending[1].reject(Error('unknown outcome'));await save;f.pending[0].resolve(scopes);assert.equal(await read,false);assert.equal(f.c.inventoryReady,false);assert.match(f.c.inventoryLoadError,/unknown/);
});
