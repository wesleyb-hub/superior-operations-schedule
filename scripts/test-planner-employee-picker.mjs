// Synthetic, offline tests of the actual inline picker and existing RPC payload contract.
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(){
 const planner={sections:[{section_id:'a',section_key:'production',section_name:'Synthetic production',schedule_version:4},{section_id:'b',section_key:'field',section_name:'Synthetic field'}],people:[{section_id:'a',employee_name:' Test Alpha ',role_name:'Synthetic role'},{section_id:'a',employee_name:'Legacy Name'},{section_id:'b',employee_name:'test alpha'}],availability:[{employee_name:'TEST ALPHA'},{employee_name:'Test Beta'}]};
 const elements={plannerCrewPeopleNew:{value:''},plannerCrewLeader:{value:'Test Alpha'}};const checked=[{value:'Test Alpha'},{value:'Legacy Name'}];
 const context={weeklyPlannerEmployeeHistory:null,currentUser:null,sb:null,weeklyPlanner:planner,weeklyPlannerInstallEmployees:['Install Test'],weeklyPlannerSelected:'production',htmlSafe:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),document:{getElementById:id=>elements[id],querySelectorAll:selector=>selector.includes(':checked')?checked:[]}};
 vm.createContext(context);
 vm.runInContext(html.slice(html.indexOf('function plannerSection('),html.indexOf('function plannerDateLabel('))+html.slice(html.indexOf('function plannerInstallationEmployeeHint('),html.indexOf('function plannerReview('))+html.slice(html.indexOf('function plannerCaptureSection('),html.indexOf('async function plannerSaveSection(')),context);
 return {c:context,planner,elements,checked};
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('trims and deduplicates case-insensitively while preserving original selected spelling',()=>{const {c}=setup();assert.deepEqual(plain(c.plannerEmployeeNames([' Alpha ','ALPHA','',' Beta',null])),['Alpha','Beta']);const options=c.plannerEmployeeOptions('a','production');assert.equal((options.match(/data-planner-person/g)||[]).length,3);assert.match(options,/value="Legacy Name" checked/);assert.doesNotMatch(options,/Install Test/);assert.match(c.plannerEmployeeOptions('a','installation_stone'),/Install Test/)});
test('empty roster is useful and data is HTML escaped',()=>{const {c,planner}=setup();planner.people=[];planner.availability=[];assert.match(c.plannerEmployeeOptions('a','production'),/No saved employee names/);planner.availability=[{employee_name:'<"Synthetic>'}];assert.match(c.plannerEmployeeOptions('a','production'),/&lt;&quot;Synthetic>/)});
test('capture keeps custom unknown names and roles; canonical RPC fields and version unchanged',()=>{const {c,planner,elements}=setup();elements.plannerCrewPeopleNew.value='test alpha, New Synthetic, NEW SYNTHETIC';const payload=plain(c.plannerCaptureSection(planner.sections[0]));assert.deepEqual(payload,{p_section_id:'a',p_expected_version:4,p_crew_leader:'Test Alpha',p_people:[{name:'Test Alpha',role:'Synthetic role',is_leader:true},{name:'Legacy Name',role:'',is_leader:false},{name:'New Synthetic',role:'',is_leader:false}],p_assignments:[]});});
test('saved snapshot round-trip retains names, role and leader; unchecked name removed only from target area',()=>{const {c,planner,checked}=setup();checked.splice(1,1);let payload=plain(c.plannerCaptureSection(planner.sections[0]));planner.people=planner.people.filter(x=>x.section_id!=='a').concat(payload.p_people.map(x=>({section_id:'a',employee_name:x.name,role_name:x.role,is_leader:x.is_leader})));assert.equal(planner.people.filter(x=>x.section_id==='b').length,1);assert.doesNotMatch(c.plannerEmployeeOptions('a','production'),/Legacy Name/);assert.deepEqual(plain(c.plannerCaptureSection(planner.sections[0])),payload)});
test('cross-area reminders are case insensitive, never count own area or empty names',()=>{const {c}=setup();assert.deepEqual(plain(c.plannerEmployeeOtherAreas(['TEST ALPHA',''],'a')),[{section:'Synthetic field',names:['test alpha']}]);assert.deepEqual(plain(c.plannerEmployeeOtherAreas(['Legacy Name'],'a')),[])});
function historySetup(){const {c,...rest}=setup();const calls=[];c.currentUser={id:'synthetic-a'};c.currentUserIsAdmin=true;c.state={view:'elsewhere'};c.sb={from:table=>{const call={table};calls.push(call);const chain={select:columns=>(call.columns=columns,chain),order:(key,options)=>(call.order={key,options},chain),limit:n=>(call.limit=n,new Promise((resolve,reject)=>Object.assign(call,{resolve,reject})))};return chain}};return {c,calls,...rest}}
const tick=()=>Promise.resolve();
test('history reads only bounded names through current client and coalesces across repeated renders/weeks',async()=>{const {c,calls}=historySetup();const a=c.loadPlannerEmployeeHistory();assert.equal(c.loadPlannerEmployeeHistory(),a);await tick();assert.equal(calls.length,2);for(const call of calls){assert.equal(call.columns,'employee_name');assert.equal(call.limit,1000);call.resolve({data:[{employee_name:'Saved Synthetic'},{employee_name:'SAVED SYNTHETIC'}]})}assert.equal(await a,true);assert.deepEqual(plain(c.plannerEmployeeHistoryCache().names),['Saved Synthetic']);assert.equal(await c.loadPlannerEmployeeHistory(),true);assert.equal(calls.length,2);assert.match(c.plannerEmployeeOptions('a','production'),/Saved Synthetic/)});
test('history error pauses automatic retries; explicit retry works',async()=>{const {c,calls}=historySetup();let a=c.loadPlannerEmployeeHistory();await tick();calls[0].resolve({error:{message:'private failure'}});calls[1].resolve({data:[]});assert.equal(await a,false);assert.equal(await c.loadPlannerEmployeeHistory(),false);assert.equal(calls.length,2);assert.doesNotMatch(c.plannerEmployeeHistoryHint(),/private failure/);a=c.loadPlannerEmployeeHistory(true);await tick();calls[2].resolve({data:[]});calls[3].resolve({data:[]});assert.equal(await a,true)});
test('history never loads without signed-in administrator and stale session results cannot leak',async()=>{for(const key of ['currentUser','currentUserIsAdmin','sb']){const {c,calls}=historySetup();c[key]=null;assert.equal(await c.loadPlannerEmployeeHistory(),false);assert.equal(calls.length,0)}const {c,calls}=historySetup();const a=c.loadPlannerEmployeeHistory();await tick();c.currentUser={id:'synthetic-b'};calls.forEach(call=>call.resolve({data:[{employee_name:'Old Session Name'}]}));assert.equal(await a,false);assert.deepEqual(plain(c.plannerEmployeeHistoryCache().names),[])});
test('RLS-empty history remains empty and never grants staff or copies availability',async()=>{const {c,calls,planner}=historySetup();const before=JSON.stringify(planner);const a=c.loadPlannerEmployeeHistory();await tick();calls.forEach(call=>call.resolve({data:[]}));assert.equal(await a,true);assert.deepEqual(plain(c.plannerEmployeeHistoryCache().names),[]);assert.equal(JSON.stringify(planner),before)});
// Installation suggestions use the same choice-only refresh, not a full draft render.
function installationSetup(){
 const {c,elements,...rest}=setup();let resolveRead,calls=0,refreshes=0;
 c.hubSessionEpoch=0;c.state={view:'weekly-planner',weeklyPlannerView:'review'};c.currentUser={id:'synthetic-install'};
 c.weeklyPlannerSelected='installation_stone';c.weeklyPlanner.sections[0].section_key='installation_stone';
 c.weeklyPlannerInstallEmployeesReady=false;c.weeklyPlannerInstallEmployeesPromise=null;c.weeklyPlannerInstallEmployeesError='';
 c.console={error:()=>{}};
 c.sb={from:()=>{calls++;const chain={select:()=>chain,eq:()=>chain,not:()=>chain,limit:()=>new Promise(resolve=>resolveRead=resolve)};return chain}};
 vm.runInContext(html.slice(html.indexOf('async function loadWeeklyPlannerInstallEmployees('),html.indexOf('// Names stay in the authorized planner snapshot')),c);
 c.refreshPlannerEmployeeHistoryChoices=()=>{refreshes++};c.renderWeeklyPlanner=()=>{throw new Error('Must not rerender live draft')};
 elements.plannerInstallationEmployeeHint={textContent:''};
 return {c,elements,...rest,resolve:data=>resolveRead(data),counts:()=>({calls,refreshes})};
}
test('Installation deferred success refreshes choices only and returns success without replacing drafts',async()=>{
 const {c,elements,resolve,counts}=installationSetup();elements.plannerCrewLeader.value='Unsaved leader';elements.plannerCrewPeopleNew.value='Unsaved employee';
 const pending=c.loadWeeklyPlannerInstallEmployees();await tick();resolve({data:[{resource_name:'New Synthetic'}]});assert.equal(await pending,true);
 assert.equal(elements.plannerCrewLeader.value,'Unsaved leader');assert.equal(elements.plannerCrewPeopleNew.value,'Unsaved employee');assert.deepEqual(counts(),{calls:1,refreshes:1});
 assert.equal(await c.loadWeeklyPlannerInstallEmployees(),true);assert.match(elements.plannerInstallationEmployeeHint.textContent,/names are loaded/);
});
test('Installation failure stays false on cached read and explicit retry recovers',async()=>{
 const {c,resolve,counts}=installationSetup();let pending=c.loadWeeklyPlannerInstallEmployees();await tick();resolve({error:{message:'Synthetic unavailable'}});assert.equal(await pending,false);assert.equal(await c.loadWeeklyPlannerInstallEmployees(),false);assert.equal(counts().calls,1);
 pending=c.loadWeeklyPlannerInstallEmployees(true);await tick();resolve({data:[]});assert.equal(await pending,true);assert.equal(counts().calls,2);
});
test('changed suggestions retain checked draft-only names and escape them',()=>{const {c}=setup();assert.match(c.plannerEmployeeOptions('a','installation_stone',['<Draft Synthetic>']),/&lt;Draft Synthetic>/)});
