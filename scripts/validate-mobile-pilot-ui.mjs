// Offline mobile pilot acceptance checks. Synthetic identities/data only; no live API traffic.
// Run in the existing pinned Playwright CI job: node scripts/validate-mobile-pilot-ui.mjs [output]
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
const html=source.replace(/<script src="[^"]+"><\/script>/g,'').replace('const sb=','let sb=');
const output=process.argv[2];if(output)await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const results=[],failures=[],pageErrors=[],blockedRequests=[];
const viewports=[{width:360,height:800},{width:390,height:800},{width:430,height:800},{width:844,height:390},{width:1440,height:1000}];
const requiredManagementViews=['overview','walls','boxes','manholes','fence','block','qc','delivery','inventory','weekly-planner','billing','exceptions','import','audit','history'];
try{
 for(const viewport of viewports){
  const {width,height}=viewport,label=`${width}x${height}`;
  const page=await browser.newPage({viewport,hasTouch:width<=1000});page.setDefaultTimeout(7000);
  page.on('pageerror',error=>pageErrors.push({viewport:label,message:error.message}));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.route('**/*',route=>{if(route.request().url()==='http://offline.test/')return route.fulfill({contentType:'text/html',body:html});blockedRequests.push(route.request().url());return route.abort()});
  await page.goto('http://offline.test/');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{
   window.qaCalls=[];
   // No hosted client exists. All service adapters below are local synthetic responses.
   sb={rpc:(name,args)=>new Promise((resolve,reject)=>qaCalls.push({name,args,resolve,reject})),from:()=>{const chain={select:()=>chain,eq:()=>chain,not:()=>chain,order:()=>chain,limit:()=>chain,in:()=>chain,then:(yes,no)=>Promise.resolve({data:[]}).then(yes,no)};return chain},removeChannel:async()=>{},channel:()=>{const c={on:()=>c,subscribe:()=>c};return c}};
   window.qaInstallFixture=()=>{
    if(typeof resetEmployeeCrewSchedules==='function')resetEmployeeCrewSchedules();
    // Match real sign-out cleanup when replacing synthetic identities between checks.
    clearTimeout(inventoryToastTimer);document.getElementById('inventoryToast').textContent='';document.getElementById('inventoryToast').classList.remove('show');
    currentUser={id:'synthetic-wes-management-pilot'};currentUserAuthorized=true;currentUserIsAdmin=true;currentUserCanWrite=true;currentUserRole='admin';
    currentAllowedViews=[];currentAllowedWallSubviews=[];remoteReady=false;saveBusy=false;saveQueued=false;inventoryBusy=false;productionBusy=false;installationBusy=false;
    state.week='2026-10-26';state.productionDay='2026-10-26';state.installationDay='2026-10-26';state.installationWeek='2026-10-26';state.installationView='today';
    state.walls=[{id:'qa-mobile-wall',job:'SYNTHETIC — Mobile foundation with a long job label',customer:'Synthetic customer',model:'Synthetic foundation',address:'Synthetic site address',totalLf:120,productionDate:'2026-10-26',installDate:'2026-10-26',digDate:'2026-10-26',status:'Scheduled',links:[]}];
    state.jobs=['boxes','manholes','fence','block'].map(division=>({id:`qa-${division}`,division,name:`SYNTHETIC ${division}`,customer:'Synthetic customer',total:2,dailyRate:1,startDate:'2026-10-26',status:'On Track',baseProduced:0,links:[],products:[{id:`qa-${division}-hold`,label:'Synthetic piece awaiting QC',qty:1,plannedDate:'2026-10-26',status:'hold'},{id:`qa-${division}-released`,label:'Synthetic released piece',qty:1,plannedDate:'2026-10-26',pouredDate:'2026-10-26',releasedDate:'2026-10-26',status:'released'}]}));
    wallsProductionReady=true;wallsProductionError='';wallsProduction={permissions:{assign:true,manage:true},jobs:state.walls.map(w=>({...w,assignedLf:120,releaseStatus:'Released for Production',documentLinks:[]})),tables:[{table_id:'qa-mobile-table',label:'Synthetic table',capacity_lf:150,version:1}],assignments:[{assignment_id:'qa-mobile-run',wall_record_id:'qa-mobile-wall',table_id:'qa-mobile-table',stage:'setup_in_progress',planned_lf:120,actual_poured_lf:0,setup_progress:50,setup_start_at:'2026-10-26T06:00',pour_at:'2026-10-26T12:00',strip_at:'2026-10-27T06:00',version:1}],issues:[]};
    wallsInstallationReady=true;wallsInstallationError='';wallsInstallation={permissions:{manage:true,resources:true,field_progress:true},jobs:[{record_id:'qa-mobile-wall',job:state.walls[0],production:[],qc:[],delivery:[],issues:[],installation:{readiness:{},closeout:{},version:1},activities:[{activity_id:'qa-mobile-activity',activity_type:'site_preparation',activity_date:'2026-10-26',start_time:'08:00',end_time:'10:00',status:'planned',resources:[{resource_assignment_id:'qa-mobile-resource',resource_type:'employee',resource_name:'Synthetic worker',availability_status:'unconfirmed',readiness_status:'unconfirmed',version:1}],notes:'Synthetic activity',version:1}]}],day_cards:[],resource_conflicts:[]};
    inventoryReady=true;inventoryCanView=true;inventoryCanAdjust=true;inventoryCanManage=true;inventoryLoadError='';inventorySearch='';inventoryFilter='all';inventoryCategory='all';
    inventoryAvailableScopes=inventoryScopeDefinitions.map(x=>({division_key:x.division,inventory_area:x.area,can_view:true,can_adjust:true,can_manage:true}));
    inventoryItems=[{id:1,code:'SYNTHETIC-REBAR',description:'Rebar synthetic material',group:'Synthetic material',unit:'units',qty:20,threshold:5,ordered:false,version:1},{id:2,code:'SYNTHETIC-PIN',description:'Pin synthetic material',group:'Synthetic material',unit:'units',qty:0,threshold:5,ordered:false,version:1}];inventoryEvents=[];
    weeklyPlannerReady=true;weeklyPlannerLoadedWeek=state.week;weeklyPlannerError='';weeklyPlannerErrorWeek='';weeklyPlannerProgress=null;weeklyPlannerManualRefreshRequest=null;weeklyPlanner={permissions:{edit:true,approve:true,publish:true},week:null,sections:[],assignments:[],people:[],availability:[],conflicts:[],resources:[],packets:[]};
    loadWeeklyPlanner.loadedContext={user:currentUser,client:sb,epoch:hubSessionEpoch};
    ensureState();showAuthGate(false);applyAccessNavigation();updateAccessStatus();
   };
   // Reads are isolated from the actual save wrappers; draft/lock/error logic remains production code.
   loadInventory=loadWallsProduction=ensureWallsInstallationLoaded=async()=>true;
   window.qaInstallFixture();
  });
  async function shot(name,{fullPage=true}={}){if(output)await page.screenshot({path:resolve(output,`${label}-${name}.png`),fullPage})}
  async function check(name,run){try{const detail=await run();results.push({viewport:label,name,passed:true,...(detail||{})})}catch(error){failures.push({viewport:label,name,message:error.stack||String(error)});await shot(`FAILED-${name.replace(/[^a-z0-9-]/gi,'-')}`,{fullPage:false}).catch(()=>{})}}
  async function nav(view){
   await page.evaluate(()=>{closeProductionModal();closeInventoryModal();document.body.classList.remove('mobile-tools-open')});
   if(width<=1000&&!await page.locator('#operationsSidebar').evaluate(el=>el.classList.contains('open')))await page.locator('#operationsNavMenu').click();
   await page.locator(`#operationsSidebar [data-view="${view}"]`).click();
   await page.waitForFunction(view=>state.view===view,view);
   await page.waitForFunction(()=>scrollY<=2,null,{timeout:2000});
  }
  const divisions=['walls','boxes','manholes','fence','block'];
  async function todayAs(access=null){
   await page.evaluate(access=>{
    closeProductionModal();closeInventoryModal();document.body.classList.remove('mobile-tools-open');qaInstallFixture();qaCalls=[];
    if(access){currentUserIsAdmin=false;currentUserCanWrite=false;currentUserRole=access.profile||'synthetic-restricted';currentAllowedViews=access.views;currentAllowedWallSubviews=access.wallSubviews||[];wallsProduction.permissions={issue:Boolean(access.issue)};wallsInstallation.permissions={manage:false,resources:Boolean(access.resources),field_progress:Boolean(access.fieldIssue)};inventoryCanManage=false;inventoryCanAdjust=Boolean(access.inventoryAdjust);inventoryCanView=access.views.includes('inventory');inventoryAvailableScopes=inventoryCanView?[{division_key:'walls',inventory_area:'production',can_view:true,can_adjust:inventoryCanAdjust,can_manage:false}]:[];applyAccessNavigation();updateAccessStatus()}
    state.view='today';render();closeOperationsNav();scrollTo(0,0);
   },access);
  }
  await check('today-single-entry-five-manager-divisions',async()=>{
   await todayAs();
   assert.equal(await page.locator('#operationsSidebar [data-view="today"]').count(),1,'Today must remain one navigation entry');
   assert.equal(await page.locator('#view h2').filter({hasText:/^Today$/}).count(),1,'Today landing heading duplicated');
   const cards=await page.locator('[data-mobile-division]').evaluateAll(nodes=>nodes.map(n=>({division:n.dataset.mobileDivision,text:n.textContent,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));
   assert.deepEqual(cards.map(x=>x.division).sort(),[...divisions].sort(),'Manager must see all five division cards');
   const titles={walls:/Superior Walls/,boxes:/Box Culverts/,manholes:/Manholes/,fence:/Fence/,block:/Block/};
   for(const card of cards){assert.match(card.text,titles[card.division]);assert.ok(card.left>=-1&&card.right<=width+1,`${card.division} card overflows screen`);assert.ok(card.width>=44&&card.height>=44)}
   const buttons=page.locator('#view [data-mobile-route]'),targets=await buttons.evaluateAll(nodes=>nodes.map(n=>({route:n.dataset.mobileRoute,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})));
   for(const target of targets){assert.ok(target.width>=43.5&&target.height>=43.5,`${target.route} has a small action target`);assert.ok(target.left>=-1&&target.right<=width+1,`${target.route} action is horizontally clipped`)}
   await buttons.first().focus();for(let i=0;i<targets.length;i++){assert.equal(await buttons.nth(i).evaluate(n=>document.activeElement===n),true,`${targets[i].route} not reachable in normal Tab order`);if(i<targets.length-1)await page.keyboard.press('Tab')}
   const focusProofs=[];
   for(const division of divisions){const button=page.locator(`[data-mobile-division="${division}"] > [data-mobile-route="${division}"]`);await button.focus();const proof=await button.evaluate(n=>{
    const s=getComputedStyle(n),r=n.getBoundingClientRect(),pad=Math.max(0,parseFloat(s.outlineOffset)||0)+(parseFloat(s.outlineWidth)||0),clipped=[];
    for(let a=n.parentElement;a&&a!==document.body;a=a.parentElement){const c=getComputedStyle(a),b=a.getBoundingClientRect();if((/hidden|clip|auto|scroll/.test(c.overflowX)&&(r.left-pad<b.left-1||r.right+pad>b.right+1))||(/hidden|clip|auto|scroll/.test(c.overflowY)&&(r.top-pad<b.top-1||r.bottom+pad>b.bottom+1)))clipped.push(a.className||a.tagName)}
    return {route:n.dataset.mobileRoute,focusVisible:n.matches(':focus-visible'),outlineWidth:parseFloat(s.outlineWidth)||0,outlineStyle:s.outlineStyle,clipped};
   });assert.equal(proof.focusVisible,true,`${division} lacks a keyboard focus indication`);assert.ok(proof.outlineWidth>=2&&proof.outlineStyle!=='none',`${division} focus ring not rendered`);assert.deepEqual(proof.clipped,[],`${division} focus ring clipped by an ancestor`);focusProofs.push(proof)}
   await buttons.first().focus();await page.evaluate(()=>scrollTo(0,0));await shot('today-focused-division');
   await page.evaluate(()=>{document.activeElement?.blur?.();scrollTo(0,0)});
   assert.equal(await page.locator('#view .stat,#view .production-kpi,#view .inventory-stat').count(),0,'Landing cards must not invent operational totals');
   assert.doesNotMatch(await page.locator('[data-mobile-division]').allTextContents().then(x=>x.join(' ')),/assigned to you|your assigned|\d+\s+(jobs|tasks|assignments)/i,'Division navigation must not claim personal assignments or counts');
   assert.equal(await page.evaluate(()=>qaCalls.length),0,'Today issued a business RPC');await shot('today-five-divisions-management');return {cards,targets,focusProofs};
  });
  await check('today-division-main-routes-preserve-management',async()=>{
   for(const division of divisions){await todayAs();await nav('today');await page.locator(`[data-mobile-division="${division}"] [data-mobile-route="${division}"]`).click();
    const actual=await page.evaluate(division=>({view:state.view,subview:state.subview[division],admin:currentUserIsAdmin,write:currentUserCanWrite,calls:qaCalls.length}),division);
    assert.equal(actual.view,division);assert.equal(actual.subview,'current');assert.equal(actual.admin,true);assert.equal(actual.write,true);assert.equal(actual.calls,0);assert.ok(await page.locator('#view').innerText());
   }
  });
  await check('today-walls-explicit-and-shared-routes',async()=>{
   for(const route of ['production','installation','inventory','schedule','report']){await todayAs();const button=page.locator(`[data-mobile-route="${route}"]`);assert.equal(await button.count(),1);
    if(['production','installation','report'].includes(route))assert.match(await button.innerText(),/Walls/i,'Walls-only activity must not imply all divisions');
    await button.click();const actual=await page.evaluate(()=>({view:state.view,wall:state.subview.walls,planner:state.weeklyPlannerView,admin:currentUserIsAdmin,calls:qaCalls.length}));
    assert.equal(actual.view,route==='inventory'?'inventory':route==='schedule'?'weekly-planner':'walls');if(['production','installation'].includes(route))assert.equal(actual.wall,route);if(route==='schedule')assert.equal(actual.planner,'approved');assert.equal(actual.admin,true);assert.equal(actual.calls,0);
   }
  });
  await check('today-authorized-card-filtering-and-routes',async()=>{
   const profiles=[...['boxes','manholes','fence','block'].map(division=>({name:division+' only',views:[division],cards:[division],routes:[division]})),
    {name:'all non-Walls',views:['boxes','manholes','fence','block'],cards:['boxes','manholes','fence','block'],routes:['boxes','manholes','fence','block']},
    {name:'non-Walls with stale Walls capabilities',views:['boxes'],wallSubviews:['production','installation'],issue:true,fieldIssue:true,cards:['boxes'],routes:['boxes']},
    {name:'Walls missing subviews',views:['walls'],wallSubviews:[],cards:[],routes:[]},
    {name:'Walls unknown subview',views:['walls'],wallSubviews:['not-a-real-subview'],cards:[],routes:[]},
    {name:'Walls current only',views:['walls'],wallSubviews:['current'],cards:['walls'],routes:['walls']},
    {name:'Walls production read',views:['walls'],wallSubviews:['production'],cards:['walls'],routes:['walls','production']},
    {name:'Walls production and inventory pilot',views:['overview','walls','inventory'],wallSubviews:['production'],cards:['walls'],routes:['walls','production','inventory']},
    {name:'Walls production issue',views:['walls'],wallSubviews:['production'],issue:true,cards:['walls'],routes:['walls','production']},
    {name:'Walls installation read',views:['walls'],wallSubviews:['installation'],cards:['walls'],routes:['walls','installation']},
    {name:'Walls field issue',views:['walls'],wallSubviews:['installation'],fieldIssue:true,cards:['walls'],routes:['walls','installation']},
    {name:'shared tasks only',views:['inventory','weekly-planner'],cards:[],routes:['inventory','schedule']},
    {name:'no daily work areas',views:[],cards:[],routes:[]}];
   for(const profile of profiles){await todayAs(profile);
    const cards=await page.locator('[data-mobile-division]').evaluateAll(nodes=>nodes.map(n=>n.dataset.mobileDivision));const routes=await page.locator('[data-mobile-route]').evaluateAll(nodes=>nodes.map(n=>n.dataset.mobileRoute));
    assert.deepEqual(cards.sort(),[...profile.cards].sort(),profile.name+' division filtering');assert.deepEqual(routes.sort(),[...profile.routes].sort(),profile.name+' task capability filtering');
    assert.equal(await page.locator('#operationsSidebar [data-view="today"]:not([hidden])').count(),1);assert.doesNotMatch(await page.locator('.mobile-home-note').innerText(),/full management access/i);
    if(profile.name==='Walls field issue')await shot('today-restricted-walls-field');if(profile.name==='boxes only')await shot('today-restricted-boxes');
    const target=profile.cards[0]||profile.routes[0];if(target){await page.locator(`[data-mobile-route="${target}"]`).click();assert.equal(await page.evaluate(()=>state.view),target==='schedule'?'weekly-planner':target);if(target==='walls')assert.ok(profile.wallSubviews.includes(await page.evaluate(()=>state.subview.walls)),'Main Walls card opened an unauthorized subview')}
    const after=await page.evaluate(()=>({admin:currentUserIsAdmin,write:currentUserCanWrite,allowed:currentAllowedViews,wall:currentAllowedWallSubviews,calls:qaCalls.length}));assert.equal(after.admin,false);assert.equal(after.write,false);assert.deepEqual(after.allowed,profile.views);assert.deepEqual(after.wall,profile.wallSubviews||[]);assert.equal(after.calls,0,'Read-only navigation called a mutation');
   }
   return {profiles:profiles.map(x=>x.name)};
  });
  await check('today-stale-cards-denied-after-access-change',async()=>{
   for(const scenario of [{route:'boxes',access:{views:['boxes']},revoke:()=>{currentAllowedViews=[]}},{route:'production',access:{views:['walls'],wallSubviews:['production']},revoke:()=>{currentAllowedWallSubviews=[]}},{route:'report',access:null,revoke:()=>{currentUserIsAdmin=false;currentUserCanWrite=false;currentAllowedViews=['walls'];currentAllowedWallSubviews=['production'];wallsProduction.permissions.issue=true}},{route:'schedule',access:{views:['weekly-planner']},revoke:()=>{currentAllowedViews=[]}}]){
    await todayAs(scenario.access);await page.evaluate(scenario.revoke);await page.locator(`[data-mobile-route="${scenario.route}"]`).click();
    assert.equal(await page.evaluate(()=>state.view),'today',`Stale ${scenario.route} card bypassed current capability check`);assert.equal(await page.evaluate(()=>qaCalls.length),0);assert.equal(await page.evaluate(()=>currentUserIsAdmin||currentUserCanWrite),false);
   }
  });
  await check('employee-production-only-its-four-module-tabs',async()=>{
   await todayAs({views:['overview','walls','inventory'],wallSubviews:['production','current','overall','active'],inventoryAdjust:true});
   await page.locator('[data-mobile-route="production"]').click();
   await page.evaluate(()=>{state.productionDay='2026-10-26';wallsProduction.weeklyForecast={currentPlannedLf:120,actualPouredLf:0,assignments:[],daily:[],baseline:null};render()});
   for(const view of ['today','week','tables','forecast']){await page.locator(`[data-production-view="${view}"]`).click();assert.equal(await page.locator('.walls-subtabs').count(),0);assert.equal(await page.locator('[data-prod-refresh]').isVisible(),true);assert.deepEqual(await page.locator('[data-production-view]').evaluateAll(nodes=>nodes.map(n=>n.dataset.productionView)),['today','week','tables','forecast']);assert.equal(await page.locator('[data-prod-edit],[data-prod-table],[data-prod-cancel],[data-prod-pour],[data-prod-stage],[data-prod-progress]').count(),0);assert.equal(await page.evaluate(()=>qaCalls.length),0)}
   await shot('employee-production-forecast-only');
  });
  await check('employee-work-first-native-totals-and-desktop-admin-preserved',async()=>{
   await todayAs({profile:'walls_inventory_counter',views:['walls','inventory'],wallSubviews:['production'],inventoryAdjust:true});await page.locator('[data-mobile-route="production"]').click();
   await page.evaluate(()=>{state.productionDay='2026-10-26';state.productionView='today';render()});
   assert.equal(await page.locator('#employeeDemoBanner,#employeeReviewFrame').count(),0,'Demo isolation UI leaked into actual feature');
   assert.doesNotMatch(await page.locator('#view').innerText(),/sample clock|no count changes are saved|sample stock|demo.*saving disabled/i);
   assert.equal(await page.locator('.production-kpi').count(),7);
   if(width<=1000){
    const totals=page.locator('#employeeProductionTotals'),summary=totals.locator('summary');assert.equal(await totals.evaluate(el=>el.open),false);assert.equal(await page.locator('.production-kpis').isVisible(),false);
    assert.equal(await page.locator('#employeeProductionWork').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('employeeProductionTotals'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
    assert.ok((await summary.boundingBox()).height>=44);await summary.focus();await page.keyboard.press('Enter');assert.equal(await totals.evaluate(el=>el.open),true);assert.equal(await page.locator('.production-kpis').isVisible(),true);
    await shot('employee-production-totals-expanded',{fullPage:false});await summary.focus();await page.keyboard.press('Space');assert.equal(await totals.evaluate(el=>el.open),false);
   }else{assert.equal(await page.locator('#employeeProductionTotals').count(),0);assert.equal(await page.locator('.production-kpis').isVisible(),true)}
   await page.evaluate(()=>scrollTo(0,0));await shot('employee-production-work-first',{fullPage:false});
   for(const next of [width<=1000?1440:390,width]){
    await page.setViewportSize({width:next,height:next===1440?1000:height});await page.waitForFunction(w=>w<=1000?Boolean(document.getElementById('employeeProductionTotals')):!document.getElementById('employeeProductionTotals'),next);
    assert.equal(await page.locator('.production-kpi').count(),7);assert.equal(await page.locator('[data-production-view="today"]').count(),1);assert.equal(await page.evaluate(()=>qaCalls.length),0,'Presentation resize issued a service call');
   }
   await page.setViewportSize(viewport);await todayAs();await page.locator('[data-mobile-route="production"]').click();await page.evaluate(()=>{state.productionView='today';render()});
   assert.equal(await page.locator('#employeeProductionTotals').count(),0,'Admin layout received employee disclosure');assert.equal(await page.locator('.production-kpis').isVisible(),true);
   assert.equal(await page.locator('.production-kpis').evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('.production-columns'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
   assert.equal(await page.evaluate(()=>currentUserIsAdmin&&currentUserCanWrite),true);
  });
  await check('employee-inventory-work-first-search-resize-and-real-save-guards',async()=>{
   await todayAs({profile:'walls_inventory_counter',views:['walls','inventory'],wallSubviews:['production'],inventoryAdjust:true});await page.locator('[data-mobile-route="inventory"]').click();
   assert.doesNotMatch(await page.locator('#view').innerText(),/demo|sample stock|no count changes are saved/i);
   if(width<=1000){
    const totals=page.locator('#employeeInventoryTotals'),summary=totals.locator('summary');assert.equal(await totals.evaluate(el=>el.open),false);
    assert.equal(await page.locator('#inventoryCatalog').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('employeeInventoryTotals'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
    assert.ok((await summary.boundingBox()).height>=44);await summary.focus();await page.keyboard.press('Enter');assert.equal(await totals.evaluate(el=>el.open),true);assert.equal(await page.locator('.inventory-stats').isVisible(),true);
    await shot('employee-inventory-totals-expanded',{fullPage:false});await summary.focus();await page.keyboard.press('Space');assert.equal(await totals.evaluate(el=>el.open),false);
   }else assert.equal(await page.locator('#employeeInventoryTotals').count(),0);
   const search=page.locator('#inventorySearch');await search.fill('Rebar');await search.evaluate(el=>{el.focus();el.setSelectionRange(2,2)});
   for(const next of [width<=1000?1440:390,width]){
    await page.setViewportSize({width:next,height:next===1440?1000:height});await page.waitForTimeout(80);
    assert.equal(await search.inputValue(),'Rebar');assert.equal(await search.evaluate(el=>document.activeElement===el),true);assert.equal(await search.evaluate(el=>el.selectionStart),2);
   }
   await page.setViewportSize(viewport);await search.fill('');await page.locator('[data-inv-action="edit"]').first().click();await page.locator('#inventoryQtyInput').fill('17');assert.equal(await page.locator('#inventoryModalSave').isDisabled(),false,'Real permitted count save was replaced by demo read-only behavior');
   await page.setViewportSize({width:width<=1000?1440:390,height:800});await page.waitForTimeout(80);assert.equal(await page.locator('#inventoryModal').isVisible(),true);assert.equal(await page.locator('#inventoryQtyInput').inputValue(),'17');
   await page.setViewportSize(viewport);await page.locator('#inventoryModalSave').click();await page.waitForFunction(()=>qaCalls.length===1);assert.equal(await page.evaluate(()=>qaCalls[0].name),'set_inventory_count');
   await page.setViewportSize({width:width<=1000?1440:390,height:800});await page.waitForTimeout(80);
   assert.equal(await page.locator('#inventoryModal').isVisible(),true);assert.equal(await page.locator('#inventoryQtyInput').inputValue(),'17');assert.equal(await page.locator('#inventoryModalSave').isDisabled(),true);assert.equal(await page.evaluate(()=>qaCalls.length),1,'Pending resize repeated a count write');
   await page.setViewportSize(viewport);await page.waitForTimeout(80);
   await page.evaluate(()=>qaCalls[0].resolve({error:{message:'Synthetic count rejected',code:'P0001'},status:400}));await page.waitForFunction(()=>!document.getElementById('inventoryModalSave').disabled);
   assert.equal(await page.locator('#inventoryQtyInput').inputValue(),'17');assert.equal(await page.locator('#inventoryModal').isVisible(),true);await shot('employee-count-failed-retains-after-resize',{fullPage:false});
   await page.locator('#inventoryModalSave').click();await page.waitForFunction(()=>qaCalls.length===2);await page.evaluate(()=>qaCalls[1].resolve({data:{}}));await page.waitForFunction(()=>!document.getElementById('inventoryModal').classList.contains('open'));
   assert.deepEqual(await page.evaluate(()=>qaCalls.map(x=>x.name)),['set_inventory_count','set_inventory_count']);
   await page.evaluate(()=>{document.activeElement?.blur?.();scrollTo(0,0)});await shot('employee-inventory-work-first',{fullPage:false});
   await page.evaluate(()=>{resetLocalSession();showAuthGate(true)});const before=await page.evaluate(()=>qaCalls.length);
   await page.setViewportSize({width:width<=1000?1440:390,height:800});await page.waitForTimeout(80);
   assert.equal(await page.evaluate(()=>currentUser),null);assert.equal(await page.locator('#authGate').isVisible(),true);assert.equal(await page.locator('#inventoryModal').isVisible(),false);assert.equal(await page.evaluate(()=>qaCalls.length),before,'Signed-out resize initiated a service call');
   await page.setViewportSize(viewport);await todayAs();
  });
  await check('employee-field-work-only-its-own-module-tabs',async()=>{
   await todayAs({views:['walls'],wallSubviews:['installation','production','current'],fieldIssue:false});await page.locator('[data-mobile-route="installation"]').click();
   await page.evaluate(()=>{state.installationDay='2026-10-26';render()});
   for(const view of ['today','week','resources']){await page.locator(`[data-install-view="${view}"]`).click();assert.equal(await page.locator('.walls-subtabs').count(),0);assert.deepEqual(await page.locator('[data-install-view]').evaluateAll(nodes=>nodes.map(n=>n.dataset.installView)),['today','week','resources']);assert.equal(await page.locator('[data-install-action="add"]:visible,[data-install-update-job]:visible,[data-install-status]:visible,[data-install-edit-activity]:visible,[data-install-resource]:visible').count(),0);assert.equal(await page.evaluate(()=>qaCalls.length),0)}
   await shot('employee-field-resources-read-only');
  });
  await check('employee-inventory-only-authorized-scope-and-actions',async()=>{
   for(const adjust of [false,true]){await todayAs({views:['walls','inventory'],wallSubviews:['production'],inventoryAdjust:adjust});await page.locator('[data-mobile-route="inventory"]').click();
    assert.equal(await page.locator('#inventoryRefresh').isVisible(),true);assert.match(await page.locator('#view').innerText(),/Use Refresh/);assert.deepEqual(await page.locator('[data-inventory-scope]').evaluateAll(nodes=>nodes.map(n=>n.dataset.inventoryScope)),['walls-production']);assert.equal(await page.locator('[data-inv-action="order"],[data-inv-action="receive"],[data-inv-action="preview"]').count(),0);assert.doesNotMatch(await page.locator('#view').innerText(),/Recent inventory activity|recipient delivery/);
    assert.equal((await page.locator('[data-inv-action="edit"]').count())>0,adjust);if(adjust){await page.locator('[data-inv-action="edit"]').first().click();assert.equal(await page.locator('#inventoryQtyInput').count(),1);assert.equal(await page.locator('#inventoryThresholdInput,#inventoryUnitInput').count(),0);await page.locator('#inventoryModalClose').click()}
    assert.equal(await page.evaluate(()=>qaCalls.length),0);
   }
   await page.evaluate(()=>scrollTo(0,0));await shot('employee-inventory-count-only');
  });
  await check('restricted-overview-uses-authorized-work-areas',async()=>{
   for(const profile of [{views:['overview','boxes'],cards:['boxes']},{views:['overview','walls','inventory'],wallSubviews:['production'],cards:['walls']}]){
    await todayAs(profile);await page.evaluate(()=>{state.view='overview';render()});
    assert.equal(await page.locator('#view h2').innerText(),'Overview');
    assert.deepEqual(await page.locator('[data-mobile-division]').evaluateAll(nodes=>nodes.map(n=>n.dataset.mobileDivision)),profile.cards);
    assert.equal(await page.locator('#view .stats,#view .stat,#view .product-scorecards').count(),0,'Restricted Overview showed all-company totals');
    assert.doesNotMatch(await page.locator('#view').innerText(),/Your assigned operations|Active Wall Jobs|SYNTHETIC — Mobile foundation/);
    assert.equal(await page.evaluate(()=>qaCalls.length),0);
   }
   await shot('restricted-overview-walls-inventory');
  });
  await check('employee-crew-denied-empty-error-and-retry',async()=>{
   await todayAs({views:['weekly-planner']});assert.equal(await page.locator('[data-mobile-route="schedule"]').count(),1);
   await page.locator('[data-mobile-route="schedule"]').click();await page.waitForFunction(()=>qaCalls.length===1);
   assert.equal(await page.evaluate(()=>qaCalls[0].name),'get_employee_approved_crew_packs');await page.evaluate(()=>qaCalls[0].resolve({data:{permissions:{view:false},packs:[]}}));
   await page.waitForFunction(()=>document.getElementById('view').textContent.includes('not enabled for this account'));assert.equal(await page.locator('[data-planner-action]').count(),0);assert.equal(await page.locator('#employeeCrewRefresh').count(),0);await shot('employee-crew-denied');await page.locator('#employeeCrewReturn').click();assert.equal(await page.evaluate(()=>state.view),'today');
   await todayAs({views:['weekly-planner']});await page.locator('[data-mobile-route="schedule"]').click();await page.waitForFunction(()=>qaCalls.length===1);await page.evaluate(()=>qaCalls[0].resolve({data:{permissions:{view:true},packs:[]}}));
   await page.waitForFunction(()=>document.getElementById('view').textContent.includes('No active approved division schedule'));assert.equal(await page.locator('[data-employee-crew-read]').count(),0);
   await page.locator('#employeeCrewRefresh').click();await page.waitForFunction(()=>qaCalls.length===2);await page.evaluate(()=>qaCalls[1].reject(Error('PRIVATE synthetic transport detail')));
   await page.waitForFunction(()=>document.getElementById('employeeCrewRefresh')?.textContent==='Try again');assert.doesNotMatch(await page.locator('#view').innerText(),/PRIVATE/);await shot('employee-crew-retry');await page.locator('#employeeCrewRefresh').click();await page.waitForFunction(()=>qaCalls.length===3);await page.evaluate(()=>qaCalls[2].resolve({data:{permissions:{view:true},packs:[]}}));await page.waitForFunction(()=>document.getElementById('view').textContent.includes('No active approved division schedule'));
   assert.deepEqual(await page.evaluate(()=>[...new Set(qaCalls.map(x=>x.name))]),['get_employee_approved_crew_packs']);
  });
  await check('employee-crew-only-approved-projection-and-fresh-open',async()=>{
   await todayAs({profile:'walls_inventory_counter',views:['weekly-planner']});await page.locator('[data-mobile-route="schedule"]').click();await page.waitForFunction(()=>qaCalls.length===1);
   await page.evaluate(()=>{window.qaEmployeePack={permissions:{view:true},packs:[{pack_id:'qa-approved-pack',week_start:state.week,pack_version:3,is_active:true,published_at:'2026-10-26T12:00:00Z',published_by_email:'PRIVATE-PUBLISHER',snapshot:{week_start:state.week,week_end:'2026-10-30',source_snapshot:'PRIVATE-DRAFT',sections:[{section:{section_key:'walls_production',status:'approved',section_name:'Synthetic Walls <img src=x onerror=alert(1)>',crew_leader:'Synthetic leader',sort_order:1},people:[{employee_name:'Synthetic employee',user_id:'PRIVATE-UID'}],assignments:[{work_date:state.week,project_location:'Synthetic site',assignment_text:'Approved work <script>bad()</script>',start_time:'08:00',status_hold:'Confirm conditions',backup_instructions:'Ask supervisor',readiness_status:'PRIVATE-READINESS'}]}]}}]};qaCalls[0].resolve({data:qaEmployeePack})});
   await page.locator('[data-employee-crew-read]').waitFor();assert.equal(await page.locator('[data-planner-action]').count(),0);assert.doesNotMatch(await page.locator('#view').innerText(),/PRIVATE|Crew Review|Publish Approved Packet/);const metadata=await page.locator('.employee-crew-pack>div').evaluate(el=>[...el.children].map(n=>({top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom})));
   assert.equal(metadata.length,3);for(let i=1;i<metadata.length;i++)assert.ok(metadata[i].top>=metadata[i-1].bottom+3,'Approved packet metadata must be separated, not run together');
   if(width<=1000){const details=page.locator('#employeeCrewDetails'),summary=details.locator('summary');assert.equal(await details.evaluate(el=>el.open),false);assert.ok((await summary.boundingBox()).height>=44);await summary.focus();await page.keyboard.press('Enter');assert.equal(await details.evaluate(el=>el.open),true);assert.match(await details.innerText(),/active.*published.*approved/i);await summary.focus();await page.keyboard.press('Space');assert.equal(await details.evaluate(el=>el.open),false);assert.match(await page.locator('#view').innerText(),/not personal assignments/i)}else assert.equal(await page.locator('#employeeCrewDetails').count(),0);
   await page.evaluate(()=>scrollTo(0,0));await shot('employee-approved-pack-list');
   await page.locator('[data-employee-crew-read]').click();await page.waitForFunction(()=>qaCalls.length===2);assert.equal(await page.locator('#productionModal').isVisible(),false,'Cached approval opened without fresh verification');await page.evaluate(()=>qaCalls[1].resolve({data:qaEmployeePack}));await page.locator('#productionModal').waitFor({state:'visible'});
   assert.equal(await page.locator('#productionModalSave').isVisible(),false);assert.match(await page.locator('#productionModalBody').innerText(),/Approved work <script>bad\(\)<\/script>/);assert.doesNotMatch(await page.locator('#productionModalBody').innerText(),/PRIVATE|Readiness/);assert.equal(await page.locator('#productionModalBody img,#productionModalBody script').count(),0);const reader=await page.locator('.employee-crew-reader').evaluate(el=>({width:el.getBoundingClientRect().width,parent:el.parentElement.clientWidth,padding:parseFloat(getComputedStyle(el.parentElement).paddingLeft)+parseFloat(getComputedStyle(el.parentElement).paddingRight)}));assert.ok(reader.width>=reader.parent-reader.padding-2,'Employee packet reader must use the modal width');await shot('employee-approved-pack-reader',{fullPage:false});await page.locator('#productionModalClose').click();
   await page.locator('[data-employee-crew-read]').click();await page.waitForFunction(()=>qaCalls.length===3);await page.evaluate(()=>qaCalls[2].resolve({data:{permissions:{view:true},packs:[]}}));await page.waitForFunction(()=>document.getElementById('view').textContent.includes('no longer the current approved schedule'));assert.equal(await page.locator('#productionModal').isVisible(),false);assert.equal(await page.locator('[data-employee-crew-read]').count(),0);assert.deepEqual(await page.evaluate(()=>[...new Set(qaCalls.map(x=>x.name))]),['get_employee_approved_crew_packs']);
  });
  await check('restricted-search-hidden-and-stale-click-denied',async()=>{
   await todayAs({views:['overview','walls','inventory'],wallSubviews:['production']});
   await page.evaluate(()=>{document.body.classList.add('mobile-tools-open')});
   assert.equal(await page.locator('#globalSearch').isVisible(),false);assert.equal(await page.locator('#searchBtn').isVisible(),false);
   const result=await page.evaluate(()=>{const before={view:state.view,query:state.searchQuery};document.getElementById('globalSearch').value='Synthetic denied search';document.getElementById('searchBtn').click();document.getElementById('globalSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return {before,after:{view:state.view,query:state.searchQuery},calls:qaCalls.length}});
   assert.deepEqual(result.after,result.before);assert.equal(result.calls,0);
   await todayAs();await page.evaluate(()=>{document.body.classList.add('mobile-tools-open')});
   assert.equal(await page.locator('#globalSearch').isVisible(),true);assert.equal(await page.locator('#searchBtn').isVisible(),true);await page.locator('#globalSearch').fill('Synthetic');await page.locator('#searchBtn').click();assert.equal(await page.evaluate(()=>state.view),'search');
  });
  await todayAs();
  // Desktop receives targeted Today coverage; the existing phone-specific suite stays unchanged.
  if(width>1000){await page.close();continue}
  await check('mobile-navigation-keyboard-and-resize',async()=>{
   await nav('today');assert.equal(await page.locator('#operationsSidebar').evaluate(n=>n.inert),true);
   await page.locator('#operationsNavMenu').focus();for(let i=0;i<25;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.getElementById('operationsSidebar').contains(document.activeElement)),false,'Closed offscreen navigation received keyboard focus')}
   await page.locator('#operationsNavMenu').click();assert.equal(await page.locator('#operationsSidebar').evaluate(n=>n.inert),false);assert.equal(await page.locator('#operationsSidebar .tab:not([hidden])').first().evaluate(n=>document.activeElement===n),true);
   await page.keyboard.press('Escape');assert.equal(await page.locator('#operationsSidebar').evaluate(n=>n.inert),true);assert.equal(await page.locator('#operationsNavMenu').evaluate(n=>document.activeElement===n),true);
   await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>!document.getElementById('operationsSidebar').inert);assert.equal(await page.locator('#operationsSidebar').getAttribute('aria-hidden'),'false');
   await page.setViewportSize(viewport);await page.waitForFunction(()=>document.getElementById('operationsSidebar').inert);await shot('mobile-navigation-closed');
  });
  await check('full-management-routes-preserved',async()=>{
   await page.evaluate(()=>{state.view='overview';render();closeOperationsNav()});
   await page.locator('#operationsNavMenu').click();
   const available=await page.locator('#operationsSidebar [data-view]').evaluateAll(nodes=>nodes.filter(n=>!n.hidden).map(n=>n.dataset.view));
   for(const view of requiredManagementViews)assert.ok(available.includes(view),`Full management route missing: ${view}`);
   assert.ok(available.includes('today'),'Task-first Today entry is missing');
   await page.locator('#operationsNavMenu').evaluate(el=>el.click());
   return {available};
  });
  for(const view of ['today',...requiredManagementViews])await check(`management-navigation-${view}`,async()=>{
   await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
   await nav(view);
   const measured=await page.evaluate(()=>({view:state.view,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,scrollY,drawerOpen:document.getElementById('operationsSidebar').classList.contains('open'),admin:currentUserIsAdmin,canWrite:currentUserCanWrite,content:document.getElementById('view').textContent.trim().length,workTop:document.getElementById('view').getBoundingClientRect().top}));
   await shot(`management-${view}`);
   assert.equal(measured.drawerOpen,false,'Navigation must close its drawer');assert.ok(measured.scrollY<=2,`Navigation retained old scroll position: ${measured.scrollY}`);
   assert.ok(measured.scrollWidth<=width+2,`Full-page horizontal overflow: ${measured.scrollWidth}`);assert.ok(measured.content>0,'Empty rendered view');
   assert.equal(measured.admin,true,'Phone navigation changed management identity');assert.equal(measured.canWrite,true,'Phone navigation removed write access');
   assert.ok(measured.workTop<Math.min(400,height-60),`Collapsed shell pushes work outside first viewport (${measured.workTop}px)`);
   return measured;
  });
  await check('management-tools-expand-and-return',async()=>{
   await nav('overview');await page.locator('#mobileToolsToggle').click();
   assert.equal(await page.locator('#roleSelect').isVisible(),true,'Management selector inaccessible');assert.equal(await page.locator('#addBtn').isVisible(),true,'Add Work inaccessible');
   await page.locator('.header-more > summary').click();
   for(const id of ['importHeaderBtn','refreshLiveBtn','exportBtn','resetBtn'])assert.equal(await page.locator('#'+id).isVisible(),true,`Management action inaccessible: ${id}`);
   await shot('management-tools-expanded');await page.locator('.header-more > summary').click();await page.locator('#mobileToolsToggle').click();
   assert.equal(await page.locator('#roleSelect').isVisible(),false,'Secondary tools did not collapse');
  });
  await check('walls-subtabs-all-visible-and-keyboard-reachable',async()=>{
   await nav('walls');
   const tabs=page.locator('#view .walls-subtabs button[data-sub]');
   assert.equal(await tabs.count(),8,'Full-management Walls subviews must remain available');
   const layout=await tabs.evaluateAll(nodes=>nodes.map(n=>({sub:n.dataset.sub,text:n.textContent.trim(),tabIndex:n.tabIndex,disabled:n.disabled,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,display:getComputedStyle(n).display})));
   for(const tab of layout){assert.ok(tab.display!=='none'&&tab.height>=43.5&&tab.width>=43.5,`${tab.text} lost its visible touch target`);assert.ok(tab.left>=-1&&tab.right<=width+1,`${tab.text} requires horizontal swipe to discover`);assert.equal(tab.disabled,false,`${tab.text} disabled`);assert.ok(tab.tabIndex>=0,`${tab.text} removed from keyboard order`)}
   await tabs.first().focus();
   for(let i=0;i<layout.length;i++){assert.equal(await tabs.nth(i).evaluate(n=>document.activeElement===n),true,`${layout[i].text} cannot be reached in normal Tab order`);if(i<layout.length-1)await page.keyboard.press('Tab')}
   await page.evaluate(()=>scrollTo(0,0));await shot('walls-subtabs-visible');
   return {tabs:layout};
  });
  await check('today-task-routes-preserve-management',async()=>{
   for(const route of ['production','installation','inventory','schedule','report']){
    await nav('today');await page.locator(`[data-mobile-route="${route}"]`).click();
    const actual=await page.evaluate(()=>({view:state.view,subview:state.subview.walls,planner:state.weeklyPlannerView,admin:currentUserIsAdmin,write:currentUserCanWrite}));
    assert.equal(actual.view,route==='inventory'?'inventory':route==='schedule'?'weekly-planner':'walls');
    if(route==='production'||route==='installation')assert.equal(actual.subview,route);
    if(route==='schedule')assert.equal(actual.planner,'approved');assert.equal(actual.admin,true);assert.equal(actual.write,true);
   }
  });
  await check('inventory-quantity-labels-visible',async()=>{
   await nav('inventory');const labels=page.locator('#inventoryCatalog .inventory-mobile-label');
   const visible=await labels.evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&getComputedStyle(n).display!=='none').map(n=>n.textContent.trim()));
   assert.ok(visible.includes('Current count'),'Current quantity lost its label');assert.ok(visible.includes('Reorder minimum'),'Reorder quantity lost its label');
   await shot('inventory-labeled-quantities');
  });
  await check('inventory-search-keyboard-and-caret',async()=>{
   await nav('inventory');const search=page.locator('#inventorySearch');await search.click();await search.pressSequentially('Rebar',{delay:25});
   assert.equal(await search.inputValue(),'Rebar');assert.equal(await search.evaluate(el=>document.activeElement===el),true,'Search lost keyboard focus while typing');
   await search.evaluate(el=>el.setSelectionRange(2,2));await page.keyboard.type('-');
   assert.equal(await search.inputValue(),'Re-bar');assert.equal(await search.evaluate(el=>el.selectionStart),3,'Search caret moved after filtering');
   await search.fill('Rebar');assert.match(await page.locator('#inventoryCatalog').innerText(),/SYNTHETIC-REBAR/);assert.doesNotMatch(await page.locator('#inventoryCatalog').innerText(),/SYNTHETIC-PIN/);
   await shot('inventory-search-focused',{fullPage:false});await search.fill('');
  });
  for(const [view,sub,selector]of [['walls','current','.wall-actions button'],['qc',null,'.qc-actions button']])await check(`touch-targets-${view}`,async()=>{
   await nav(view);if(sub)await page.evaluate(sub=>setSubview('walls',sub),sub);
   const sizes=await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>({text:n.textContent.trim(),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})).filter(n=>n.width&&n.height));
   assert.ok(sizes.length,`No populated ${view} action targets were exercised`);for(const s of sizes){assert.ok(s.height>=43.5,`${s.text} is only ${s.height}px high`);assert.ok(s.width>=43.5,`${s.text} is only ${s.width}px wide`)}
   await shot(`touch-targets-${view}`);return {targets:sizes};
  });
  await check('count-blank-rejected-explicit-zero-accepted',async()=>{
   await nav('inventory');await page.evaluate(()=>{qaCalls=[];inventoryCanManage=false;inventoryEditItem(inventoryItems[0])});
   await page.locator('#inventoryQtyInput').fill('');await page.locator('#inventoryModalSave').click();
   assert.equal(await page.evaluate(()=>qaCalls.length),0,'Blank count submitted a mutation');assert.equal(await page.locator('#inventoryModal').isVisible(),true);
   assert.match(await page.locator('#inventoryCountError').innerText(),/count|enter|number/i);
   await shot('count-blank-error',{fullPage:false});
   await page.locator('#inventoryQtyInput').fill('0');await page.locator('#inventoryModalSave').click();
   await page.waitForFunction(()=>qaCalls.length===1);assert.deepEqual(await page.evaluate(()=>({name:qaCalls[0].name,quantity:qaCalls[0].args.p_quantity})),{name:'set_inventory_count',quantity:0});
   await page.evaluate(()=>qaCalls[0].resolve({data:{}}));await page.waitForFunction(()=>!document.getElementById('inventoryModal').classList.contains('open'));
   await page.evaluate(()=>{inventoryCanManage=true});
  });
  await check('approved-packet-reader-safety-and-uncertainty',async()=>{
   await page.evaluate(()=>{
    qaCalls=[];qaInstallFixture();state.view='weekly-planner';state.weeklyPlannerView='approved';
    weeklyPlanner.recent_packs=[{pack_id:'qa-mobile-pack',week_start:state.week,pack_version:1,is_active:true,published_at:'2026-10-26T12:00:00Z',published_by_email:'synthetic@example.invalid',snapshot:{week_start:state.week,week_end:'2026-10-30',sections:[{section:{section_name:'Synthetic crew <img src=x onerror=alert(1)>',crew_leader:'Synthetic leader',sort_order:1},people:[{employee_name:'Synthetic employee'}],assignments:[{work_date:'2026-10-26',project_location:'Synthetic site',assignment_text:'Synthetic task <script>bad()</script>',start_time:'08:00',readiness_status:'unconfirmed',status_hold:'Confirm site before work',backup_instructions:'Ask synthetic supervisor'}]}]}}];render();
   });
   await page.locator('[data-planner-action="read-pack"]').click();assert.equal(await page.locator('#productionModalSave').isVisible(),false,'Read-only packet exposes a save control');
   const text=await page.locator('#productionModalBody').innerText();assert.match(text,/Synthetic task <script>bad\(\)<\/script>/);assert.equal(await page.locator('#productionModalBody img,#productionModalBody script').count(),0,'Packet text became executable DOM');
   assert.equal(await page.evaluate(()=>qaCalls.length),0,'Reading a packet issued a mutation');await shot('approved-packet-reader',{fullPage:false});
   await page.locator('#productionModalClose').click();
   await page.evaluate(()=>{weeklyPlanner.sections=[{section_id:'qa-mobile-section',section_key:'production',section_name:'Synthetic production',status:'approval_unverified'}];renderWeeklyPlanner()});
   await page.locator('[data-planner-action="read-pack"]').click();const uncertain=await page.locator('#productionModalBody').innerText();
   assert.match(uncertain,/unverified|verify/i,'Phone reader hides the current activation uncertainty');assert.doesNotMatch(uncertain,/Active approved packet/i,'Cached packet incorrectly promoted as active after uncertainty');
   await shot('approved-packet-reader-unverified',{fullPage:false});await page.locator('#productionModalClose').click();
   await page.evaluate(()=>{weeklyPlanner.sections=[];plannerPublishVerificationRequired.pending=[{user:currentUser,userId:currentUser.id,week:state.week}];renderWeeklyPlanner()});
   await page.locator('[data-planner-action="read-pack"]').click();const pending=await page.locator('#productionModalBody').innerText();
   assert.match(pending,/unverified|verify/i,'Phone reader ignores lost-publication verification latch');assert.doesNotMatch(pending,/Active approved packet/i,'Pending publication incorrectly shown as active');
   assert.equal(await page.evaluate(()=>qaCalls.length),0,'Read-only verification state issued a mutation');await shot('approved-packet-publication-unverified',{fullPage:false});
   await page.locator('#productionModalClose').click();await page.evaluate(()=>{plannerPublishVerificationRequired.pending=[]});
  });
  const fields=[
   {name:'issue',open:()=>openWallsInstallationIssueForm('qa-mobile-wall'),values:{installIssueDescription:'Retained synthetic field issue'},rpc:'report_walls_installation_issue'},
   {name:'readiness',open:()=>openWallsInstallationReadiness('qa-mobile-wall'),values:{installRestrictions:'Retained synthetic access note'},rpc:'save_walls_installation_job'},
   {name:'edit-activity',open:()=>openWallsInstallationEditActivity('qa-mobile-activity'),values:{installEditNotes:'Retained synthetic activity note'},rpc:'save_walls_installation_activity'},
   {name:'resource-status',open:()=>openWallsInstallationResourceStatusForm('qa-mobile-resource|unconfirmed|unconfirmed'),values:{installResourceProblem:'Retained synthetic resource note'},rpc:'update_walls_installation_resource'}
  ];
  async function fieldOpen(s){await page.evaluate(()=>{closeProductionModal();closeInventoryModal();qaCalls=[];qaInstallFixture()});await page.evaluate(s.open);for(const [id,value]of Object.entries(s.values))await page.locator('#'+id).fill(value)}
  for(const s of fields)await check(`installation-${s.name}-failed-save-retains`,async()=>{
   await fieldOpen(s);await page.locator('#productionModalSave').click();await page.waitForFunction(()=>qaCalls.length===1);
   assert.equal(await page.evaluate(()=>qaCalls[0].name),s.rpc);assert.equal(await page.locator('#productionModalSave').isDisabled(),true);
   await page.evaluate(()=>{document.getElementById('productionModalSave').click();productionModalSaveAction()});assert.equal(await page.evaluate(()=>qaCalls.length),1,'Duplicate write while pending');
   await page.evaluate(()=>qaCalls[0].resolve({error:{message:'Synthetic validation failure',code:'P0001'},status:400}));
   await page.waitForFunction(()=>!document.getElementById('productionModalSave').disabled);
   assert.equal(await page.locator('#productionModal').isVisible(),true,'Failed field save dismissed its draft');for(const [id,value]of Object.entries(s.values))assert.equal(await page.locator('#'+id).inputValue(),value);
   assert.match(await page.locator('#productionModalSaveStatus').innerText(),/Not saved|retained/i);await shot(`installation-${s.name}-retained`,{fullPage:false});
   await page.locator('#productionModalSave').click();await page.waitForFunction(()=>qaCalls.length===2);await page.evaluate(()=>qaCalls[1].resolve({data:{}}));await page.waitForFunction(()=>!document.getElementById('productionModal').classList.contains('open'));
  });
  for(const outcome of ['throw','status-zero'])await check(`installation-unknown-${outcome}-locked`,async()=>{
   const s=fields[0];await fieldOpen(s);await page.locator('#productionModalSave').click();await page.waitForFunction(()=>qaCalls.length===1);
   await page.evaluate(outcome=>outcome==='throw'?qaCalls[0].reject(Error('Synthetic response lost')):qaCalls[0].resolve({data:null,error:{message:'Failed to fetch',code:''},status:0}),outcome);
   await page.waitForFunction(()=>/unknown|not confirmed/i.test(document.getElementById('productionModalSaveStatus')?.textContent||''));
   assert.equal(await page.locator('#productionModalSave').isDisabled(),true);assert.equal(await page.locator('#installIssueDescription').inputValue(),s.values.installIssueDescription);
   await page.evaluate(()=>productionModalSaveAction());assert.equal(await page.evaluate(()=>qaCalls.length),1,'Uncertain write automatically retried');await shot(`installation-${outcome}-unknown`,{fullPage:false});
  });
  await check('installation-old-session-cannot-dismiss-new-draft',async()=>{
   const s=fields[0];await fieldOpen(s);await page.locator('#productionModalSave').click();await page.waitForFunction(()=>qaCalls.length===1);
   await page.evaluate(()=>{window.qaOldCall=qaCalls[0];resetLocalSession();qaInstallFixture();openWallsInstallationIssueForm('qa-mobile-wall')});
   await page.locator('#installIssueDescription').fill('Replacement-session synthetic draft');await page.locator('#productionModalSave').click();await page.waitForFunction(()=>qaCalls.length===2);
   await page.evaluate(()=>qaOldCall.resolve({data:{}}));await page.waitForTimeout(25);
   assert.equal(await page.locator('#productionModal').isVisible(),true);assert.equal(await page.locator('#productionModalSave').isDisabled(),true);assert.equal(await page.locator('#installIssueDescription').inputValue(),'Replacement-session synthetic draft');
   await page.evaluate(()=>qaCalls[1].resolve({data:{}}));await page.waitForFunction(()=>!document.getElementById('productionModal').classList.contains('open'));
  });
  await check('locked-app-keyboard-and-login-layout',async()=>{
   await page.evaluate(()=>{closeProductionModal();closeInventoryModal();openProductionModal('Synthetic interrupted draft','','<input id="qaInterruptedInput" value="Synthetic draft">','Save',()=>{});showAuthGate(true)});
   await page.locator('#authEmail').fill('synthetic@example.invalid');
   await page.keyboard.press('Tab');assert.equal(await page.locator('#authEmail').evaluate(el=>document.activeElement===el),false,'Hidden modal focus trap froze keyboard on the sign-in email field');
   for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('.app').contains(document.activeElement)),false,'Keyboard entered the locked application behind sign-in')}
   const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,gateHeight:document.getElementById('authGate').getBoundingClientRect().height}));
   assert.ok(layout.scrollWidth<=width+2,'Sign-in layout causes horizontal page overflow');await shot('sign-in-locked',{fullPage:false});return layout;
  });
  await page.close();
 }
}finally{
 await browser.close();
 const report={method:'Offline synthetic Chromium: touch-capable phone viewports plus desktop Today coverage; not real device, live employee auth or backend authorization proof.',viewports,results,failures,pageErrors,blockedRequests};
 if(output)await writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({checks:results.length,failures,pageErrors,blockedRequestCount:blockedRequests.length},null,2));
}
assert.equal(failures.length,0,'Mobile pilot acceptance checks failed');assert.equal(pageErrors.length,0,'Mobile pilot page errors');
