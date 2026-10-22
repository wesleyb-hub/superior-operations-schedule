import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const pending=[],messages=[],nodes=new Map(),removed=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',classList:{remove(){}},querySelector(){return null},replaceChildren(){this.cleared=true}});return nodes.get(id)};
 const c={wallsInstallationLoadToken:0,console:{error(){}},Promise,clearTimeout,Date,JSON,clone:x=>JSON.parse(JSON.stringify(x)),seed:{walls:[]},state:{view:'other',walls:[{id:'draft'}]},currentUser:{id:'test',email:'test@example.invalid'},sb:null,currentUserCanWrite:true,currentUserIsAdmin:true,remoteReady:true,structuredBackendReady:true,lastRevision:1,lastRemoteData:{},lastSharedJson:'',lastRemoteUpdatedAt:'',saveBusy:false,saveQueued:false,queuedReason:'Saved',inventoryScopeKey:'walls-production',inventoryAvailableScopes:[],inventoryItems:[],inventoryEvents:[],inventoryReady:false,inventoryLoadError:'',inventoryBusy:false,inventoryScopeDefinitions:[{key:'walls-production',division:'walls',area:'production'},{key:'walls-install',division:'walls',area:'install'}],stateChannel:{id:1},inventoryChannel:{id:2},productionChannel:null,weeklyPlannerChannel:null,wallsInstallationChannel:null,weeklyPlannerRefreshTimer:null,wallsInstallationReloadTimer:null,inventoryToastTimer:null,loadUiPrefs:()=>({}),showAuthGate(){},setAuthMode(){},setAuthMessage:m=>messages.push(m),document:{getElementById:node,querySelectorAll:()=>[]},alert:m=>messages.push(m),showInventoryToast:m=>messages.push(m),renderInventory(){},saveUiPrefs(){},sharedDataFromState:s=>JSON.parse(JSON.stringify(s)),validateOperationalTransition:()=>'',applyRemoteRow:async row=>{c.applied=row;return true}};
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
function plannerFixture(){
 const f=fixture();Object.assign(f.c,{weeklyPlannerSelected:'synthetic',weeklyPlannerProgress:null,weeklyPlannerManualRefreshRequest:null,weeklyPlannerBusy:false,weeklyPlannerDraftError:'',plannerSection:()=>f.section,plannerCaptureSection:()=>({p_crew_leader:'Synthetic',p_people:[{name:'Synthetic'}]}),plannerSectionFeedback:m=>f.messages.push(m),loadWeeklyPlanner:async()=>{f.refreshes++;return true}});f.refreshes=0;f.section={section_id:'synthetic',schedule_version:1};
 vm.runInContext(part('function plannerUpdatePendingUI(', 'function plannerAddAssignment('),f.c);
 vm.runInContext(part('async function weeklyPlannerRpc(', 'function plannerCaptureInputs('),f.c);return f;
}
test('planner delayed save cannot trigger approval under replacement session',async()=>{
 const f=plannerFixture(),save=f.c.plannerSaveSection(true);f.c.resetLocalSession();f.c.currentUser={id:'new'};f.c.weeklyPlannerBusy=true;f.pending[0].resolve({data:{schedule_version:2}});assert.equal(await save,false);assert.equal(f.pending.length,1);assert.equal(f.c.weeklyPlannerBusy,true);assert.equal(f.section.schedule_version,1);assert.equal(f.refreshes,0);
});
test('planner navigation during save suppresses chained approval but releases own busy latch',async()=>{
 const f=plannerFixture(),save=f.c.plannerSaveSection(true);f.c.state.week='another-week';f.pending[0].resolve({data:{schedule_version:2}});assert.equal(await save,false);assert.equal(f.pending.length,1);assert.equal(f.c.weeklyPlannerBusy,false);
});
test('planner old approval completion neither refreshes nor clears replacement busy state',async()=>{
 const f=plannerFixture(),save=f.c.plannerSaveSection(true);f.pending[0].resolve({data:{schedule_version:2}});await tick();assert.equal(f.pending[1].name,'approve_weekly_planner_section');f.c.resetLocalSession();f.c.currentUser={id:'new'};f.c.weeklyPlannerBusy=true;f.pending[1].resolve({data:{status:'approved'}});assert.equal(await save,false);assert.equal(f.c.weeklyPlannerBusy,true);assert.equal(f.refreshes,0);
});
test('planner generic save suppresses old-session errors and feedback',async()=>{
 const f=plannerFixture(),save=f.c.weeklyPlannerRpc('synthetic',{},'Saved');const before=f.messages.length;f.c.resetLocalSession();f.c.currentUser={id:'new'};f.c.weeklyPlannerBusy=true;f.pending[0].reject(Error('old'));assert.equal(await save,false);assert.equal(f.messages.length,before);assert.equal(f.c.weeklyPlannerBusy,true);
});
test('installation mutation cannot clear replacement busy or refresh after signout',async()=>{
 const f=fixture();f.c.installationBusy=false;f.c.ensureWallsInstallationLoaded=()=>{throw Error('stale refresh')};
 vm.runInContext(part('async function wallsInstallationRpc(', 'function subscribeWallsProduction('),f.c);
 const save=f.c.wallsInstallationRpc('synthetic',{},'Saved');f.c.resetLocalSession();f.c.currentUser={id:'new'};f.c.installationBusy=true;f.pending[0].resolve({data:{}});assert.equal(await save,false);assert.equal(f.c.installationBusy,true);assert.equal(f.messages.length,0);
});
function proposalFixture(){
 const f=fixture(),els=[];f.c.document.createElement=()=>{const el={style:{},children:[],appendChild(x){this.children.push(x)},append(...xs){this.children.push(...xs)}};els.push(el);return el};
 const log={appendChild(){},scrollHeight:0};f.c.document.getElementById=()=>log;f.c.agentActionDetail=()=>'';f.c.refreshAfterAgentAction=async()=>{f.refreshes++};f.refreshes=0;
 vm.runInContext(part('function appendAssistantProposal(', 'async function askOperationsAgent('),f.c);f.c.appendAssistantProposal({action_id:'synthetic'});
 f.button=els.find(x=>x.className==='assistant-confirm');f.reject=els.find(x=>x.className==='assistant-reject');f.status=els.find(x=>x.className==='assistant-proposal-status');return f;
}
test('detached assistant confirmation cannot run using another user session',async()=>{
 const f=proposalFixture();f.c.currentUser={id:'new'};await f.button.onclick();assert.equal(f.pending.length,0);
});
test('assistant old confirmation response cannot refresh newer session',async()=>{
 const f=proposalFixture(),apply=f.button.onclick();f.c.currentUser=null;f.pending[0].resolve({data:{ok:true}});await apply;assert.equal(f.refreshes,0);assert.notEqual(f.status.textContent,'Applied and recorded in the audit trail.');
});
test('assistant repeated confirmation blocked and rejected transport never silently retries',async()=>{
 const f=proposalFixture(),apply=f.button.onclick();await f.button.onclick();assert.equal(f.pending.length,1);f.pending[0].reject(Error('network'));await apply;assert.match(f.status.textContent,/outcome unknown/);await f.button.onclick();assert.equal(f.pending.length,1);
});
test('assistant rejection response cannot revive old proposal controls',async()=>{
 const f=proposalFixture(),reject=f.reject.onclick();f.c.currentUser={id:'new'};f.pending[0].resolve({error:{message:'old rejection'}});await reject;assert.equal(f.reject.disabled,true);assert.notEqual(f.status.textContent,'old rejection');
});
test('planner transport rejection explicitly reports uncertain outcome without resubmission',async()=>{
 const f=plannerFixture(),save=f.c.plannerSaveSection(true);f.pending[0].reject(Error('network'));assert.equal(await save,false);assert.match(f.messages.at(-1),/may have completed/);assert.match(f.messages.at(-1),/Refresh and verify/);assert.equal(f.pending.length,1);assert.equal(f.c.weeklyPlannerBusy,false);
});

test('late successful logout cannot replace a newer authenticated screen',async()=>{
 const f=fixture(),modes=[];f.c.setAuthMode=(...args)=>modes.push(args);const logout=f.c.signOut();f.c.currentUser={id:'new'};f.pending[0].resolve({});await logout;assert.equal(modes.length,1);assert.equal(modes[0][1],'Signing out...');
});
test('logout clears private toast and unlocks only the cleared assistant form',()=>{
 const f=fixture(),button={disabled:true,textContent:'Working...'},input={disabled:true},toast={textContent:'private',classList:{remove(name){this.removed=name}}};f.nodes.set('assistantForm',{querySelector:()=>button});f.nodes.set('assistantInput',input);f.nodes.set('inventoryToast',toast);
 f.c.resetLocalSession();assert.equal(toast.textContent,'');assert.equal(toast.classList.removed,'show');assert.equal(input.disabled,false);assert.equal(button.disabled,false);assert.equal(button.textContent,'Ask');
});
function assistantFormFixture(){
 const f=fixture(),button={disabled:false,textContent:'Ask'},input={value:'old question',disabled:false,focus(){this.focused=(this.focused||0)+1}},form={querySelector:()=>button};f.nodes.set('assistantInput',input);f.nodes.set('assistantForm',form);f.c.appendAssistantMessage=(...args)=>f.messages.push(args);f.c.askOperationsAgent=()=>new Promise((resolve,reject)=>f.pending.push({resolve,reject}));
 vm.runInContext(html.split(/\r?\n/).find(line=>line.startsWith("document.getElementById('assistantForm').onsubmit=")),f.c);
 return {...f,button,input,submit:()=>form.onsubmit({preventDefault(){},currentTarget:form})};
}
test('old assistant finally cannot unlock a newer session question',async()=>{
 const f=assistantFormFixture(),old=f.submit();assert.equal(f.button.disabled,true);f.c.resetLocalSession();f.c.currentUser={id:'new'};f.input.value='new question';const fresh=f.submit();f.pending[0].resolve();await old;assert.equal(f.button.disabled,true);assert.equal(f.input.disabled,true);assert.equal(f.button.textContent,'Working...');assert.equal(f.input.focused,undefined);f.pending[1].resolve();await fresh;assert.equal(f.button.disabled,false);assert.equal(f.input.focused,1);
});
test('assistant transport exception is handled once and stale failures remain silent',async()=>{
 for(const stale of [false,true]){const f=assistantFormFixture(),request=f.submit();if(stale){f.c.resetLocalSession();f.c.currentUser={id:'new'}}const count=f.messages.length;f.pending[0].reject(Error('offline'));await request;assert.equal(f.messages.length,count+(stale?0:1));if(!stale)assert.match(f.messages.at(-1)[1],/No automatic retry/);assert.equal(f.button.disabled,false)}
});
test('installation save finishing its refresh after logout cannot report success',async()=>{
 const f=fixture();f.c.installationBusy=false;f.c.ensureWallsInstallationLoaded=()=>new Promise(resolve=>f.pending.push({resolve}));vm.runInContext(part('async function wallsInstallationRpc(', 'function subscribeWallsProduction('),f.c);
 const save=f.c.wallsInstallationRpc('synthetic',{},'Saved');f.pending[0].resolve({data:{}});await tick();f.c.resetLocalSession();f.c.currentUser={id:'new'};f.pending[1].resolve(true);assert.equal(await save,false);assert.equal(f.messages.length,0);
});
function loadMapFixture(){
 const f=fixture();f.c.state.loads=[{id:'load',division:'walls',linkId:'wall',status:'Scheduled'}];f.c.state.deliveryHistory=[];f.c.state.view='delivery';f.c.installationCanManage=()=>true;f.c.installationJob=()=>({delivery:[],production:[]});f.c.htmlSafe=String;f.c.openProductionModal=(title,intro,body,label,action)=>{f.c.productionModalSaveAction=action};f.c.closeProductionModal=()=>{f.closed=true};f.c.render=()=>{f.rendered=true};f.c.wallsInstallationRpc=()=>new Promise((resolve,reject)=>f.pending.push({resolve,reject}));
 vm.runInContext(part('function openWallsInstallationLoadMap(', 'function renderDelivery('),f.c);f.c.openWallsInstallationLoadMap('load');return f;
}
test('old shipment mapping completion cannot close or unlock a replacement modal',async()=>{
 for(const result of [true,false,'reject'])for(const change of ['modal','session']){
  const f=loadMapFixture(),save=f.c.productionModalSaveAction(),button=f.nodes.get('productionModalSave');if(change==='modal')f.c.productionModalSaveAction=()=>{};else f.c.currentUser={id:'new'};button.disabled=true;button.textContent='New save in flight';
  if(result==='reject')f.pending[0].reject(Error('old failure'));else f.pending[0].resolve(result);await save;
  assert.equal(f.closed,undefined);assert.equal(f.rendered,undefined);assert.equal(button.disabled,true);assert.equal(button.textContent,'New save in flight');
 }
});

test('master successful save invalidates a preexisting snapshot without rolling back revision or edits',{timeout:2000},async()=>{
 const f=fixture();f.c.applyRemoteRow=async row=>{f.c.lastRevision=row.revision;f.c.state=row.payload.data;return true};const old=f.c.loadRemoteState(),save=f.c.persistState();f.pending[1].resolve({data:{revision:2}});assert.equal(await save,true);f.pending[0].resolve({data:{revision:1,payload:{data:{walls:[{id:'old'}]}}}});assert.equal(await old,false);assert.equal(f.c.lastRevision,2);assert.equal(f.c.state.walls[0].id,'draft');
});
test('master reads during save are blocked and cannot overwrite queued newer edits',{timeout:2000},async()=>{
 const f=fixture(),old=f.c.loadRemoteState(),save=f.c.persistState();f.c.state.walls.push({id:'newer'});await f.c.persistState('newer');assert.equal(await f.c.loadRemoteState(true),false);assert.equal(f.pending.length,2);f.pending[0].resolve({data:{revision:1}});assert.equal(await old,false);assert.equal(f.c.applied,undefined);f.pending[1].resolve({data:{revision:2}});assert.equal(await save,true);assert.equal(f.pending.length,3);assert.equal(f.pending[2].args.p_snapshot.walls[1].id,'newer');f.pending[2].resolve({data:{revision:3}});await tick();assert.equal(f.c.lastRevision,3);assert.equal(f.c.state.walls[1].id,'newer');const fresh=f.c.loadRemoteState(true);f.pending[3].resolve({data:{revision:3}});assert.equal(await fresh,true);
});
function importFixture(){
 const f=fixture(),readers=[];f.c.state.view='import';f.c.importData=null;f.c.importHeaders=[];const input={files:[{name:'synthetic.json'}]};f.nodes.set('importFile',input);f.c.FileReader=class{constructor(){readers.push(this)}readAsText(){}};f.c.renderImportPreview=()=>{f.previews=(f.previews||0)+1};vm.runInContext(part('function loadImportFile()', 'function renderImportPreview()'),f.c);return Object.assign(f,{input,readers});
}
test('pending import file cannot repopulate private rows after logout or session replacement',()=>{
 for(const change of [f=>f.c.resetLocalSession(),f=>{f.c.currentUser={id:'new'}},f=>{f.c.sb={}}]){const f=importFixture();f.c.loadImportFile();change(f);f.readers[0].result='[{"job":"old private import"}]';f.readers[0].onload();assert.equal(f.c.importData,null);assert.equal(f.c.importHeaders.length,0);assert.equal(f.previews,undefined)}
});
test('latest import preview wins and detached or navigated-away reads remain inert',()=>{
 const f=importFixture();f.c.loadImportFile();f.input.files=[{name:'new.json'}];f.c.loadImportFile();f.readers[1].result='[{"job":"new"}]';f.readers[1].onload();f.readers[0].result='[{"job":"old"}]';f.readers[0].onload();assert.equal(f.c.importData[0].job,'new');assert.equal(f.previews,1);
 for(const change of [f=>{f.nodes.set('importFile',{files:f.input.files})},f=>{f.c.state.view='walls'}]){const g=importFixture();g.c.loadImportFile();change(g);g.readers[0].result='[{"job":"detached"}]';g.readers[0].onload();assert.equal(g.c.importData,null);assert.equal(g.previews,undefined)}
});
test('failed import reads report only in owning preview and preserve prior valid rows',()=>{
 const f=importFixture();f.c.importData=[{job:'prior'}];f.c.loadImportFile();f.readers[0].result='[]';f.readers[0].onload();assert.equal(f.c.importData[0].job,'prior');assert.match(f.messages[0],/No rows found/);f.readers[0].onerror();assert.match(f.messages[1],/Choose the file again/);f.c.resetLocalSession();const count=f.messages.length;f.readers[0].onerror();assert.equal(f.messages.length,count);
});

test('search result opens synchronously after render without a timer surviving logout',()=>{
 for(const type of ['wall','project']){const f=fixture(),opened=[],button={dataset:{resultType:type,resultDivision:type==='wall'?'walls':'boxes',openResult:'synthetic|quoted"id'}};Object.assign(f.c,{state:{view:'search',searchQuery:'Synthetic',walls:[{id:button.dataset.openResult,job:'Synthetic wall'}],jobs:[{id:button.dataset.openResult,division:'boxes',name:'Synthetic box',products:[]}]},htmlSafe:String,divisionMeta:{boxes:{label:'Boxes'}},saveState(){},render(){},openWallModal:id=>opened.push(['wall',id]),openProjectModal:id=>opened.push(['project',id]),setTimeout(){throw Error('Modal must not be deferred beyond its owning click')}});f.c.document.querySelectorAll=selector=>selector==='[data-open-result]'?[button]:[];vm.runInContext(part('function renderSearchResults(', '/* MANAGEMENT EXCEPTIONS */'),f.c);f.c.renderSearchResults();button.onclick();assert.deepEqual(opened,[[type,button.dataset.openResult]]);f.c.resetLocalSession();assert.equal(opened.length,1)}
});
test('new special piece opens synchronously after render with no deferred modal callback',()=>{
 const f=fixture(),project={id:'synthetic-project',name:'Synthetic',division:'boxes',products:[],regularPieceCount:0},opened=[];Object.assign(f.c,{projectById:id=>id===project.id?project:null,saveState(){},render(){},logAction(){},openPieceModal:(...ids)=>opened.push(ids),setTimeout(){throw Error('Modal must not be deferred beyond its owning click')}});vm.runInContext(part('function addSpecialPiece(', 'function bindPrecastControls('),f.c);f.c.addSpecialPiece(project.id);assert.equal(project.products.length,1);assert.deepEqual(opened,[[project.id,project.products[0].id]]);
});
function authFixture(){
 const f=fixture();Object.assign(f.c,{authMode:'login',authAllowed:()=>true,authCallbackType:()=>'',showPasswordSetup(){},startSession:async user=>{f.started.push(user)}});f.started=[];f.nodes.set('authEmail',{value:'synthetic@example.invalid'});f.nodes.set('authPassword',{value:'synthetic-only-not-a-real-password'});f.c.sb.auth.signInWithPassword=()=>new Promise((resolve,reject)=>f.pending.push({resolve,reject}));f.c.sb.auth.onAuthStateChange=handler=>f.authHandler=handler;vm.runInContext(part('async function handleAuthSubmit(', '// Invalidate local work before awaiting network logout;'),f.c);vm.runInContext(part('  sb.auth.onAuthStateChange(', '  const initialEpoch=hubSessionEpoch;'),f.c);return f;
}
test('failed logout then failed login retains the lock against old retained auth events',async()=>{
 for(const outcome of ['error','reject','missing-session']){const f=authFixture(),logout=f.c.signOut();f.pending[0].reject(Error('Synthetic logout offline'));await logout;assert.equal(f.nodes.get('retrySignOutBtn').hidden,false);const login=f.c.handleAuthSubmit();await f.authHandler('TOKEN_REFRESHED',{user:{id:'old'}});assert.equal(f.started.length,0);if(outcome==='reject')f.pending[1].reject(Error('Synthetic login offline'));else f.pending[1].resolve(outcome==='error'?{error:{message:'Synthetic invalid login'}}:{data:{}});await login;await f.authHandler('SIGNED_IN',{user:{id:'old'}});assert.equal(f.started.length,0);assert.equal(f.c.currentUser,null);assert.equal(vm.runInContext('hubSessionLocked',f.c),true);assert.equal(f.nodes.get('retrySignOutBtn').hidden,false);assert.equal(f.nodes.get('authBtn').disabled,false)}
});
test('confirmed login unlocks only its returned user after auth events were held',async()=>{
 const f=authFixture();f.c.resetLocalSession();const login=f.c.handleAuthSubmit();await f.authHandler('SIGNED_IN',{user:{id:'new-confirmed'}});assert.equal(f.started.length,0);f.pending[0].resolve({data:{session:{user:{id:'new-confirmed'}}}});await login;assert.equal(f.started[0].id,'new-confirmed');assert.equal(vm.runInContext('hubSessionLocked',f.c),false);assert.equal(f.nodes.get('retrySignOutBtn').hidden,true);
});
test('late login response cannot unlock or start over a replacement session',async()=>{
 const f=authFixture();f.c.resetLocalSession();const login=f.c.handleAuthSubmit();f.c.resetLocalSession();f.c.currentUser={id:'replacement'};f.nodes.get('authBtn').disabled=true;f.pending[0].resolve({data:{session:{user:{id:'old-login'}}}});await login;assert.equal(f.started.length,0);assert.equal(vm.runInContext('hubSessionLocked',f.c),true);assert.equal(f.nodes.get('authBtn').disabled,true);
});
test('confirmed login with failed workspace initialization relocks and exposes signout recovery',async()=>{
 const f=authFixture();f.c.resetLocalSession();f.c.startSession=async()=>{throw Error('Synthetic access transport failure')};const login=f.c.handleAuthSubmit();f.pending[0].resolve({data:{session:{user:{id:'confirmed'}}}});await login;assert.equal(vm.runInContext('hubSessionLocked',f.c),true);assert.equal(f.c.currentUser,null);assert.equal(f.nodes.get('retrySignOutBtn').hidden,false);assert.equal(f.nodes.get('authBtn').disabled,false);
});
test('auth mode changes invalidate older callbacks without unlocking a new submission',async()=>{
 const f=authFixture();vm.runInContext(part('function setAuthMode(', 'async function handleAuthSubmit('),f.c);f.c.resetLocalSession();const old=f.c.handleAuthSubmit();f.c.setAuthMode('forgot');f.c.setAuthMode('login');f.nodes.get('authPassword').value='synthetic-new-password';const fresh=f.c.handleAuthSubmit();const before=f.messages.length;f.pending[0].resolve({data:{session:{user:{id:'obsolete'}}}});await old;assert.equal(f.started.length,0);assert.equal(f.nodes.get('authBtn').disabled,true);assert.equal(f.messages.length,before);f.pending[1].resolve({error:{message:'Synthetic newer error'}});await fresh;assert.equal(f.nodes.get('authBtn').disabled,false);
});
