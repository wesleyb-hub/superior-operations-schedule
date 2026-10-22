// Execute actual modal constructors, save callbacks, owner guard, and RPC wrappers.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const nodes=new Map(),calls=[],messages=[];
 function node(id){if(nodes.has(id))return nodes.get(id);const classes=new Set();const el={id,style:{display:''},value:'',disabled:false,textContent:'',children:[],controls:[],setAttribute(){},replaceChildren(){this.children=[];this.controls=[]},querySelector(){return null},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x)}},appendChild(child){this.children.push(child);nodes.set(child.id,child)},querySelectorAll(){return this.controls}};Object.defineProperty(el,'innerHTML',{set(value){for(const child of this.children)nodes.delete(child.id);this.children=[];this.controls=[];for(const m of value.matchAll(/<(input|textarea|select)\b[^>]*\bid="([^"]+)"[^>]*>/g)){nodes.delete(m[2]);const child=node(m[2]);this.controls.push(child);child.value=m[0].match(/value="([^"]*)"/)?.[1]||''}},get(){return ''}});nodes.set(id,el);return el}
 const c={console:{error(){}},Promise,currentUser:{id:'synthetic'},hubSessionEpoch:0,state:{productionDay:'2026-10-26'},inventoryModalSaveAction:null,productionModalSaveAction:null,inventoryCanAdjust:true,inventoryCanManage:true,inventoryBusy:false,productionBusy:false,inventoryLoadToken:0,inventoryReady:true,inventoryLoadError:'',htmlSafe:String,normalizeDate:x=>x,todayISO:()=>'2026-10-26',addDays:x=>x,productionDateTimeLocal:x=>x,alert:m=>messages.push(m),showInventoryToast:m=>messages.push(m),renderInventory(){},document:{getElementById:id=>nodes.get(id)||(id.endsWith('SaveStatus')?null:node(id)),createElement:()=>node('new-'+nodes.size)}};
 c.wallsProduction={permissions:{assign:true},jobs:[{id:'wall',job:'Synthetic foundation',totalLf:120}],tables:[{table_id:'table',label:'Synthetic table',capacity_lf:120,version:2}],assignments:[{assignment_id:'assignment',wall_record_id:'wall',table_id:'table',planned_lf:120,version:3}]};
 c.productionJob=id=>c.wallsProduction.jobs.find(j=>j.id===id)||c.wallsProduction.jobs[0];c.productionTable=id=>c.wallsProduction.tables.find(t=>t.table_id===id)||c.wallsProduction.tables[0];
 c.sb={rpc:(name,args)=>new Promise((resolve,reject)=>calls.push({name,args,resolve,reject}))};c.loadInventory=c.loadWallsProduction=async()=>true;
 vm.createContext(c);vm.runInContext(part('async function wallsProductionRpc(', 'async function loadInventory('),c);vm.runInContext(part('async function inventoryRpc(', 'function defaultWallPlanReview('),c);vm.runInContext(part('function closeInventoryModal(', 'function inventoryEmailPreview('),c);vm.runInContext(part('function openProductionAssignmentModal(', 'function bindWallsProductionControls('),c);vm.runInContext(html.split(/\r?\n/).find(line=>line.startsWith('function closeModal(')),c);
 return {c,calls,messages,node};
}
const item={id:1,code:'SYNTHETIC',description:'Synthetic stock',unit:'units',qty:20,threshold:5,version:4};
const scenarios=[
 {name:'count-only inventory',kind:'inventory',open(c){c.inventoryCanManage=false;c.inventoryEditItem(item)},values:{inventoryQtyInput:'37'},rpc:'set_inventory_count',args:{p_quantity:37}},
 {name:'manager inventory settings',kind:'inventory',open(c){c.inventoryEditItem(item)},values:{inventoryQtyInput:'38',inventoryThresholdInput:'7',inventoryUnitInput:'boxes'},rpc:'set_inventory_item',args:{p_quantity:38,p_reorder_threshold:7,p_unit:'boxes'}},
 {name:'inventory receiving',kind:'inventory',open(c){c.inventoryReceive(item)},values:{inventoryReceivedInput:'9'},rpc:'receive_inventory_stock',args:{p_quantity:9}},
 {name:'production assignment',kind:'production',open(c){c.openProductionAssignmentModal()},values:{prodJob:'wall',prodTable:'table',prodHeight:'5',prodLf:'80',prodSetup:'2026-10-25T06:00',prodPour:'2026-10-26T06:00',prodStrip:'2026-10-27T06:00',prodNotes:'Retained assignment notes'},rpc:'upsert_walls_production_assignment',args:{p_planned_lf:80,p_notes:'Retained assignment notes'}},
 {name:'production issue',kind:'production',open(c){c.openProductionIssueModal('assignment')},values:{prodIssueCategory:'Equipment problems',prodIssueText:'Retained issue description'},rpc:'report_walls_production_issue',args:{p_description:'Retained issue description'}},
 {name:'production pour',kind:'production',open(c){c.openProductionPourModal('assignment')},values:{prodActualLf:'75',prodStageNote:'Retained pour note'},rpc:'advance_walls_production_stage',args:{p_actual_lf:75,p_note:'Retained pour note'}},
 {name:'production table',kind:'production',open(c){c.openProductionTableModal('table')},values:{prodTableLabel:'Retained table label',prodTableCapacity:'100',prodTableNotes:'Retained table note'},rpc:'upsert_walls_production_table',args:{p_label:'Retained table label',p_capacity_lf:100,p_notes:'Retained table note'}}
];
function open(f,s){s.open(f.c);for(const [id,value]of Object.entries(s.values))f.node(id).value=value;return f.c[s.kind+'ModalSaveAction']}
for(const s of scenarios){
 test(`${s.name}: failed write keeps entered draft and only confirmed retry closes it`,async()=>{
  const f=fixture(),action=open(f,s),prefix=s.kind+'Modal';const save=action();assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,s.rpc);for(const [key,value]of Object.entries(s.args))assert.equal(f.calls[0].args[key],value);
  assert.equal(f.node(prefix).classList.contains('open'),true);assert.equal(f.node(prefix+'Save').disabled,true);assert.equal(await action(),false);assert.equal(f.calls.length,1);
  f.calls[0].resolve({error:{message:'Synthetic validation failure'}});assert.equal(await save,false);assert.equal(f.node(prefix).classList.contains('open'),true);assert.equal(f.node(prefix+'Save').disabled,false);
  for(const [id,value]of Object.entries(s.values)){assert.equal(f.node(id).value,value);assert.equal(f.node(id).disabled,false)}assert.match(f.node(prefix+'SaveStatus').textContent,/entries are retained/);
  const retry=action();f.calls[1].resolve({data:{}});assert.equal(await retry,true);assert.equal(f.node(prefix).classList.contains('open'),false);
 });
 test(`${s.name}: lost response retains and locks draft without resubmission`,async()=>{
  const f=fixture(),action=open(f,s),prefix=s.kind+'Modal',save=action();f.calls[0].reject(Error('Synthetic lost response'));assert.equal(await save,false);
  assert.equal(f.node(prefix).classList.contains('open'),true);assert.equal(f.node(prefix+'Save').disabled,true);assert.match(f.node(prefix+'SaveStatus').textContent,/outcome unknown/);assert.match(f.node(prefix+'SaveStatus').textContent,/No automatic retry/);
  for(const [id,value]of Object.entries(s.values))assert.equal(f.node(id).value,value);assert.equal(await action(),false);assert.equal(f.calls.length,1);
  f.c['close'+(s.kind==='production'?'Production':'Inventory')+'Modal']();open(f,s);assert.equal(f.node(prefix+'Save').disabled,false,'reopening after deliberate verification must not inherit disabled Save');
 });
}
for(const kind of ['inventory','production']){
 const s=scenarios.find(s=>s.kind===kind);
 test(`${kind}: dismissed save cannot close or unlock replacement modal`,async()=>{
  const f=fixture(),action=open(f,s),save=action(),prefix=kind+'Modal';f.c['close'+(kind==='production'?'Production':'Inventory')+'Modal']();open(f,s);f.node(prefix+'Save').disabled=true;
  f.calls[0].resolve({data:{}});assert.equal(await save,false);assert.equal(f.node(prefix).classList.contains('open'),true);assert.equal(f.node(prefix+'Save').disabled,true);
 });
 test(`${kind}: old session completion cannot unlock replacement session save`,async()=>{
  const f=fixture(),old=open(f,s)();f.c.currentUser={id:'new-session'};f.c.hubSessionEpoch++;f.c[kind==='production'?'productionBusy':'inventoryBusy']=false;
  const freshAction=open(f,s),fresh=freshAction();assert.equal(f.calls.length,2);f.calls[0].resolve({data:{}});assert.equal(await old,false);assert.equal(f.node(kind+'ModalSave').disabled,true);assert.equal(f.c[kind==='production'?'productionBusy':'inventoryBusy'],true);
  f.calls[1].resolve({data:{}});assert.equal(await fresh,true);assert.equal(f.node(kind+'Modal').classList.contains('open'),false);
 });
 test(`${kind}: confirmed write with failed refresh still closes instead of inviting duplicate`,async()=>{
  const f=fixture();f.c[kind==='production'?'loadWallsProduction':'loadInventory']=async()=>false;const save=open(f,s)();f.calls[0].resolve({data:{}});assert.equal(await save,true);assert.equal(f.node(kind+'Modal').classList.contains('open'),false);assert.match(f.messages.at(-1),/^Saved\./);
 });
}

for(const kind of ['inventory','production'])test(`${kind}: generic dismissal clears action and inline hidden style cannot poison reopening`,()=>{
 const f=fixture(),s=scenarios.find(s=>s.kind===kind);open(f,s);f.c.closeModal(kind+'Modal');assert.equal(f.node(kind+'Modal').classList.contains('open'),false);assert.equal(f.c[kind+'ModalSaveAction'],null);
 f.node(kind+'Modal').style.display='none';open(f,s);assert.equal(f.node(kind+'Modal').style.display,'');assert.equal(f.node(kind+'Modal').classList.contains('open'),true);
});

test('session teardown hides every inline modal before a new login',()=>{
 const f=fixture(),ids=['wallModal','projectModal','pieceModal','planReviewModal','productionModal','inventoryModal'];
 for(const id of ids){f.node(id).style.display='flex';f.node(id).classList.add('open')}
 Object.assign(f.c,{remoteLoadToken:0,importReadToken:0,clearTimeout(){},weeklyPlannerRefreshTimer:null,wallsInstallationReloadTimer:null,inventoryToastTimer:null,seed:{walls:[]},clone:x=>JSON.parse(JSON.stringify(x)),loadUiPrefs:()=>({}),stateChannel:null,inventoryChannel:null,productionChannel:null,weeklyPlannerChannel:null,wallsInstallationChannel:null,showAuthGate(){}});
 f.c.document.querySelectorAll=selector=>selector==='.modal-backdrop,.inventory-modal-backdrop'?ids.map(f.node):[];
 vm.runInContext(part('function resetLocalSession(', 'async function signOut('),f.c);f.c.resetLocalSession();f.c.currentUser={id:'new-login'};
 for(const id of ids){assert.equal(f.node(id).style.display,'none');assert.equal(f.node(id).classList.contains('open'),false)}
 f.c.inventoryCanAdjust=true;open(f,scenarios[0]);assert.equal(f.node('inventoryModal').style.display,'');assert.equal(f.node('wallModal').style.display,'none');
});
