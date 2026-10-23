// Actual Today helper execution; synthetic capabilities only, no services or browser.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const helpers=html.slice(html.indexOf('function todayWorkAreas('),html.indexOf('function renderToday('));
const sourceLine=name=>html.split(/\r?\n/).find(line=>line.startsWith(`function ${name}(`));
const divisions=['walls','boxes','manholes','fence','block'];
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture({admin=false,views=[],subviews=[],issue=false,fieldIssue=false,manage=false}={}){
 const calls=[],c={currentUserIsAdmin:admin,currentUserAuthorized:true,currentUserCanWrite:admin,currentAllowedViews:views,currentAllowedWallSubviews:subviews,wallsProduction:{permissions:{issue}},wallsInstallation:{permissions:{field_progress:fieldIssue,manage}},state:{view:'today',week:'2026-10-19',subview:{},weeklyPlannerView:'review'},todayISO:()=>'2026-10-23',setView:v=>{calls.push(['view',v]);c.state.view=v},loadWallsProduction:()=>calls.push(['production-read']),ensureWallsInstallationLoaded:force=>calls.push(['installation-read',force]),showInventoryToast:text=>calls.push(['toast',text])};
 vm.createContext(c);vm.runInContext(['viewAllowed','wallSubviewAllowed','installationCanManage'].map(sourceLine).join('\n')+'\n'+helpers,c);
 return {c,calls,areas:()=>plain(c.todayWorkAreas())};
}
test('one Today navigation entry, no duplicated division tabs',()=>{
 assert.equal([...html.matchAll(/class="tab[^"\n]*"[^>]*data-view="today"/g)].length,1);
 for(const division of divisions)assert.equal([...html.matchAll(new RegExp(`class="tab[^"\\n]*"[^>]*data-view="${division}"`,'g'))].length,1);
});
test('management sees five honest division cards and all shared tools',()=>{
 const {c,areas}=fixture({admin:true}),a=areas();
 assert.deepEqual(a.divisions.map(x=>x[0]),divisions);
 assert.deepEqual(a.divisions.map(x=>x[1]),['Superior Walls','Box Culverts','Manholes','Fence','Block']);
 assert.deepEqual(a.shortcuts,[['production','Walls production'],['installation','Walls field work']]);
 assert.deepEqual(a.shared.map(x=>x[0]),['inventory','schedule','report']);assert.equal(a.shared.at(-1)[1],'Report a Walls issue');
 assert.doesNotMatch(JSON.stringify(a.divisions),/assigned to you|your assigned|\d+ (jobs|tasks)/i);
 assert.equal(c.currentUserIsAdmin,true);assert.equal(c.currentUserCanWrite,true);
});
for(const division of divisions)test(`management ${division} card opens existing current schedule without changing week or rights`,()=>{
 const {c,calls}=fixture({admin:true});assert.equal(c.openTodayRoute(division),true);
 assert.equal(c.state.view,division);assert.equal(c.state.subview[division],'current');assert.equal(c.state.week,'2026-10-19');assert.deepEqual(calls,[['view',division]]);assert.equal(c.currentUserIsAdmin,true);assert.equal(c.currentUserCanWrite,true);
});
for(const division of divisions.slice(1))test(`${division}-only account receives only its division`,()=>{
 const {c,areas}=fixture({views:[division],subviews:['production','installation'],issue:true,fieldIssue:true});
 assert.deepEqual(areas().divisions.map(x=>x[0]),[division]);assert.deepEqual(areas().shortcuts,[]);assert.deepEqual(areas().shared,[]);
 assert.equal(c.openTodayRoute(division),true);assert.equal(c.state.view,division);assert.equal(c.currentUserIsAdmin,false);assert.equal(c.currentUserCanWrite,false);
});
for(const subview of ['current','production','installation','overall','active','plans','monthly','year'])test(`Walls-only ${subview} permission is the main card's safe destination`,()=>{
 const {c,areas}=fixture({views:['walls'],subviews:[subview]});assert.deepEqual(areas().divisions.map(x=>x[0]),['walls']);assert.equal(c.openTodayRoute('walls'),true);assert.equal(c.state.subview.walls,subview);
 assert.deepEqual(areas().shared,[]);assert.equal(c.currentUserIsAdmin,false);
});
for(const subviews of [[],['not-a-real-subview']])test(`Walls with unusable subviews ${JSON.stringify(subviews)} is not offered`,()=>{
 const {c,calls,areas}=fixture({views:['walls'],subviews});assert.deepEqual(areas().divisions,[]);assert.deepEqual(areas().shortcuts,[]);assert.equal(c.openTodayRoute('walls'),false);assert.deepEqual(calls,[]);assert.deepEqual(plain(c.state.subview),{});
});
test('shared-only account sees Inventory and Crew schedules without any division',()=>{
 const {c,areas,calls}=fixture({views:['inventory','weekly-planner']});assert.deepEqual(areas().divisions,[]);assert.deepEqual(areas().shared.map(x=>x[0]),['inventory','schedule']);
 assert.equal(c.openTodayRoute('inventory'),true);assert.equal(c.openTodayRoute('schedule'),true);assert.equal(c.state.weeklyPlannerView,'approved');assert.deepEqual(calls,[['view','inventory'],['view','weekly-planner']]);
});
test('no areas and unknown route fail closed without changing state',()=>{
 const {c,areas,calls}=fixture();assert.deepEqual(areas().divisions,[]);assert.deepEqual(areas().shared,[]);
 for(const route of [...divisions,'production','installation','inventory','schedule','report','__proto__'])assert.equal(c.openTodayRoute(route),false);
 assert.equal(c.state.view,'today');assert.deepEqual(calls,[]);
});
for(const profile of [{subviews:['production'],issue:true,target:'production'},{subviews:['installation'],fieldIssue:true,target:'installation'},{subviews:['installation'],manage:true,target:'installation'}])test(`Report a Walls issue uses existing ${profile.target} capability`,()=>{
 const {c,areas,calls}=fixture({views:['walls'],...profile});assert.equal(areas().shared.at(-1)[0],'report');assert.equal(c.openTodayRoute('report'),true);assert.equal(c.state.view,'walls');assert.equal(c.state.subview.walls,profile.target);assert.equal(c.state[profile.target==='production'?'productionDay':'installationDay'],'2026-10-23');assert.match(calls.at(-1)[1],/No issue is saved until you confirm/);
});
test('capabilities for a hidden Walls view do not expose Walls actions',()=>{
 const {c,areas}=fixture({views:['boxes'],subviews:['production','installation'],issue:true,fieldIssue:true,manage:true});assert.deepEqual(areas().shortcuts,[]);assert.deepEqual(areas().shared,[]);assert.equal(c.openTodayRoute('report'),false);
});
for(const scenario of [
 {route:'boxes',profile:{views:['boxes']},revoke:c=>{c.currentAllowedViews=[]}},
 {route:'walls',profile:{views:['walls'],subviews:['current']},revoke:c=>{c.currentAllowedWallSubviews=[]}},
 {route:'production',profile:{views:['walls'],subviews:['production']},revoke:c=>{c.currentAllowedWallSubviews=[]}},
 {route:'installation',profile:{views:['walls'],subviews:['installation']},revoke:c=>{c.currentAllowedViews=[]}},
 {route:'report',profile:{views:['walls'],subviews:['production'],issue:true},revoke:c=>{c.wallsProduction.permissions.issue=false}},
 {route:'schedule',profile:{views:['weekly-planner']},revoke:c=>{c.currentAllowedViews=[]}},
 {route:'inventory',profile:{views:['inventory']},revoke:c=>{c.currentAllowedViews=[]}}
])test(`stale ${scenario.route} button is denied after capability revocation, before state/read calls`,()=>{
 const {c,areas,calls}=fixture(scenario.profile),a=areas();assert.ok([...a.divisions,...a.shortcuts,...a.shared].some(x=>x[0]===scenario.route));scenario.revoke(c);const before=plain(c.state);
 assert.equal(c.openTodayRoute(scenario.route),false);assert.deepEqual(plain(c.state),before);assert.deepEqual(calls,[]);assert.equal(c.currentUserIsAdmin,false);assert.equal(c.currentUserCanWrite,false);
});
