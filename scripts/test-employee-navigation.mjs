import {installHubReaderHelpers} from './hub-reader-test-helpers.mjs';
// Actual employee navigation helpers; synthetic capabilities, no services or browser.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function sourceOf(name){
 const start=html.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert.ok(start>=0,`Missing ${name}`);
 const line=html.slice(start,html.indexOf('\n',start)).trimEnd();return line.endsWith('}')?line:html.slice(start,html.indexOf('\n}',start)+2);
}
function fixture({admin=false,views=['overview'],subviews=[]}={}){
 const calls=[],nodes={view:{innerHTML:''},globalSearch:{value:' Synthetic search '},searchBtn:{},crewScheduleReturn:{}};
 const c={Date,console,currentUserIsAdmin:admin,currentUserAuthorized:true,currentUserCanWrite:admin,currentUser:{id:'synthetic-navigation'},currentUserRole:admin?'admin':'walls_inventory_counter',window:{matchMedia:()=>({matches:false})},currentAllowedViews:views,currentAllowedWallSubviews:subviews,state:{view:'overview',subview:{},week:'2026-10-19',searchQuery:''},wallsProduction:{permissions:{}},wallsInstallation:{permissions:{}},document:{body:{classList:{remove(){},add(){}}},getElementById:id=>nodes[id]||null,querySelectorAll:()=>[]},htmlSafe:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),setView:view=>{calls.push(['view',view]);c.state.view=view},syncBilling:()=>{throw Error('Restricted overview accessed management billing')},weekDates:()=>{throw Error('Restricted overview accessed schedule totals')},subscribeWeeklyPlanner:()=>{throw Error('Restricted planner subscribed')},loadWeeklyPlanner:()=>{throw Error('Restricted planner loaded')},renderEmployeeCrewSchedules:()=>calls.push(['employee-approved-view']),weeklyPlannerReady:true,weeklyPlannerLoadedWeek:'2026-10-19',weeklyPlanner:{recent_packs:[{snapshot:{secret:'Synthetic cached manager data'}}]}};
 vm.createContext(c);installHubReaderHelpers(c,html);vm.runInContext(['employeeMobilePresentationAllowed','viewAllowed','wallSubviewAllowed','installationCanManage','todayWorkAreas','renderToday','renderOverview','renderWeeklyPlanner','applyAccessNavigation','openGlobalSearch','divisionSubtabs','productionInnerNav','installationNav','inventoryEmailPreview','renderInventoryWatch','renderInventory','inventoryFilteredItems','inventoryStatus','inventoryStatusLabel','inventoryPill','currentInventoryScope'].map(sourceOf).join('\n'),c);
 return {c,calls,nodes};
}
for(const division of ['boxes','manholes','fence','block'])test(`restricted Overview uses only the granted ${division} launcher, never Walls records/totals`,()=>{
 const {c,nodes}=fixture({views:['overview',division]});Object.defineProperty(c.state,'walls',{get(){throw Error('Read broad Walls records')}});c.renderOverview();
 assert.match(nodes.view.innerHTML,/<h2>Overview<\/h2>/);assert.match(nodes.view.innerHTML,new RegExp(`data-mobile-division="${division}"`));assert.doesNotMatch(nodes.view.innerHTML,/data-mobile-division="walls"|Active Wall Jobs|Digs This Week|Your assigned operations|product-score-value/);
});
test('restricted Walls Overview respects the allowed subview and has no personal-assignment claim',()=>{
 const {c,nodes}=fixture({views:['overview','walls'],subviews:['installation']});c.renderOverview();assert.match(nodes.view.innerHTML,/data-mobile-route="installation"/);assert.doesNotMatch(nodes.view.innerHTML,/data-mobile-route="production"|Your assigned operations/);
});
test('restricted planner delegates only to the dedicated approved schedule view',()=>{
 const {c,calls}=fixture({views:['weekly-planner']});c.renderWeeklyPlanner();assert.deepEqual(calls,[['employee-approved-view']]);
});
test('disallowed search is hidden and stale/programmatic activation changes no state',()=>{
 const {c,nodes,calls}=fixture();c.applyAccessNavigation();assert.equal(nodes.globalSearch.hidden,true);assert.equal(nodes.searchBtn.hidden,true);assert.equal(c.openGlobalSearch(),false);assert.equal(c.state.view,'overview');assert.equal(c.state.searchQuery,'');assert.deepEqual(calls,[]);
});
for(const admin of [false,true])test(`${admin?'manager':'explicitly allowed'} search stays available and uses the normal route`,()=>{
 const {c,nodes,calls}=fixture({admin,views:['overview','search']});c.applyAccessNavigation();assert.equal(nodes.globalSearch.hidden,false);assert.equal(nodes.searchBtn.hidden,false);assert.equal(c.openGlobalSearch(),true);assert.equal(c.state.searchQuery,'Synthetic search');assert.deepEqual(calls,[['view','search']]);assert.equal(c.currentUserIsAdmin,admin);
});
test('search access revoked after rendering is rechecked before route or query changes',()=>{
 const {c,nodes,calls}=fixture({views:['overview','search']});c.applyAccessNavigation();assert.equal(nodes.searchBtn.hidden,false);c.currentAllowedViews=['overview'];assert.equal(c.openGlobalSearch(),false);assert.equal(c.state.searchQuery,'');assert.deepEqual(calls,[]);
});
function navFixture(){
 const classes=new Set(),attrs={},focused=[],c={mobile:true,document:{activeElement:null},window:{matchMedia:()=>({matches:c.mobile})}};
 c.operationsNavMenu={setAttribute:(k,v)=>attrs[k]=v,focus:()=>{focused.push('menu');c.document.activeElement=c.operationsNavMenu}};
 const tab={focus:()=>{focused.push('tab');c.document.activeElement=tab}};
 c.operationsSidebar={classList:{contains:k=>classes.has(k),remove:k=>classes.delete(k),toggle:(k,v)=>v?classes.add(k):classes.delete(k)},setAttribute:(k,v)=>attrs[k]=v,contains:n=>n===tab,querySelector:()=>tab};c.operationsNavBackdrop={classList:{remove(){},toggle(){}}};
 vm.createContext(c);installHubReaderHelpers(c,html);vm.runInContext(['syncOperationsNavAccessibility','closeOperationsNav','toggleOperationsNav'].map(sourceOf).join('\n'),c);return {c,attrs,focused};
}
test('mobile drawer is inert while closed and opening/closing preserves keyboard focus',()=>{
 const {c,attrs,focused}=navFixture();c.syncOperationsNavAccessibility();assert.equal(c.operationsSidebar.inert,true);assert.equal(attrs['aria-hidden'],'true');c.toggleOperationsNav();assert.equal(c.operationsSidebar.inert,false);assert.equal(attrs['aria-expanded'],'true');assert.deepEqual(focused,['tab']);c.closeOperationsNav();assert.equal(c.operationsSidebar.inert,true);assert.deepEqual(focused,['tab','menu']);
});
test('desktop navigation stays available and closing after route focus does not steal focus',()=>{
 const {c,focused}=navFixture();c.toggleOperationsNav();c.document.activeElement={id:'view'};c.closeOperationsNav();assert.deepEqual(focused,['tab']);c.mobile=false;c.syncOperationsNavAccessibility();assert.equal(c.operationsSidebar.inert,false);
});

for(const [subview,expected,nav] of [['production',['today','week','tables','forecast'],'productionInnerNav'],['installation',['today','week','resources'],'installationNav']])test(`employee ${subview} stays inside its own module tabs`,()=>{
 const {c}=fixture({views:['walls'],subviews:['current','production','installation','overall','active','plans','monthly','year']});c.state.subview.walls=subview;assert.equal(c.divisionSubtabs('walls'),'');assert.deepEqual([...c[nav]().matchAll(/data-(?:production|install)-view="([^"]+)"/g)].map(x=>x[1]),expected);
});
test('management retains every Walls navigation destination',()=>{const {c}=fixture({admin:true});c.state.subview.walls='production';assert.equal([...c.divisionSubtabs('walls').matchAll(/data-sub=/g)].length,8)});
function inventoryFixture({admin=false,adjust=false,manage=false}={}){
 const f=fixture({admin,views:['inventory']});Object.assign(f.c,{inventoryCanManage:manage,inventoryCanAdjust:adjust,inventoryReady:true,inventoryScopeKey:'walls-production',inventoryAvailableScopes:[{division_key:'walls',inventory_area:'production'}],inventoryScopeDefinitions:[{key:'walls-production',label:'Walls production',entity:'Synthetic',heading:'Production inventory',catalog:'Materials'}],inventoryItems:[{id:1,code:'SYNTHETIC',description:'Synthetic material',group:'General',qty:1,threshold:5,unit:'units',ordered:false,version:1}],inventoryEvents:[{id:1,itemId:1,type:'count_set',at:'2026-10-26T12:00:00Z',before:0,after:1,actor:'SYNTHETIC-PRIVATE-ACTOR'}],inventorySearch:'',inventoryFilter:'all',inventoryCategory:'all',bindInventoryActions(){}});return f;
}
test('employee inventory shows count work without purchasing controls or activity actor records',()=>{
 const {c,nodes}=inventoryFixture({adjust:true});c.renderInventory();assert.match(nodes.view.innerHTML,/Record count|Physical count access/);assert.doesNotMatch(nodes.view.innerHTML,/data-inv-action="(?:order|receive|preview)"|Set minimum|Recent inventory activity|SYNTHETIC-PRIVATE-ACTOR|recipient delivery/);assert.doesNotThrow(()=>c.inventoryEmailPreview(c.inventoryItems[0]));
});
test('read-only inventory has neither count nor management controls',()=>{const {c,nodes}=inventoryFixture();c.renderInventory();assert.match(nodes.view.innerHTML,/Read-only access/);assert.doesNotMatch(nodes.view.innerHTML,/data-inv-action="(?:edit|minus|plus|order|receive|preview)"/)});
test('manager inventory retains purchasing preview, controls and activity',()=>{const {c,nodes}=inventoryFixture({admin:true,adjust:true,manage:true});c.renderInventory();assert.match(nodes.view.innerHTML,/data-inv-action="preview"/);assert.match(nodes.view.innerHTML,/data-inv-action="order"/);assert.match(nodes.view.innerHTML,/Recent inventory activity/)});
for(const kind of ['inventory','production'])test(`${kind} Refresh is one in-flight read, guarded during writes, and unlocks on settled failure`,async()=>{
 const refresh={disabled:false,isConnected:true,textContent:'Refresh'},nodes={view:{querySelectorAll:()=>[]},inventoryRefresh:refresh},pending=[];
 const c={inventoryBusy:false,productionBusy:false,document:{getElementById:id=>nodes[id]||null,querySelectorAll:q=>q==='[data-prod-refresh]'?[refresh]:[]},loadInventory:()=>new Promise(resolve=>pending.push(resolve)),loadWallsProduction:()=>new Promise(resolve=>pending.push(resolve))};
 vm.createContext(c);installHubReaderHelpers(c,html);vm.runInContext(sourceOf(kind==='inventory'?'bindInventoryActions':'bindWallsProductionControls'),c);c[kind==='inventory'?'bindInventoryActions':'bindWallsProductionControls']();
 const busy=kind==='inventory'?'inventoryBusy':'productionBusy';c[busy]=true;await refresh.onclick();assert.equal(pending.length,0);c[busy]=false;const read=refresh.onclick();await refresh.onclick();assert.equal(pending.length,1);assert.equal(refresh.disabled,true);pending[0](false);await read;assert.equal(refresh.disabled,false);assert.equal(refresh.textContent,'Refresh');
});
