// Offline mobile pilot acceptance checks. Synthetic identities/data only; no live API traffic.
// Run in the existing pinned Playwright CI job: node scripts/validate-mobile-pilot-ui.mjs [output]
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
const html=source.replace(/<script src="[^"]+"><\/script>/g,'').replace('const sb=','let sb=');
const output=process.argv[2]||'/tmp/kyler-ui';if(output)await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const results=[],failures=[],pageErrors=[],blockedRequests=[];
const viewports=[390,760,1000,1001,1440,1920];
try { for(const width of viewports){
 const page=await browser.newPage({viewport:{width,height:1000},hasTouch:width<=1000});page.setDefaultTimeout(5000);
 page.on('pageerror',error=>pageErrors.push({width,message:error.message}));
 page.on('dialog',dialog=>dialog.dismiss());
 await page.route('**/*',route=>route.request().url()==='http://offline.test/'?route.fulfill({contentType:'text/html',body:html}):route.abort());
 await page.goto('http://offline.test/');
  await page.evaluate(()=>{
   window.qaCalls=[];
   // No hosted client exists. All service adapters below are local synthetic responses.
   sb={rpc:(name,args)=>new Promise((resolve,reject)=>qaCalls.push({name,args,resolve,reject})),from:()=>{const chain={select:()=>chain,eq:()=>chain,not:()=>chain,order:()=>chain,limit:()=>chain,in:()=>chain,then:(yes,no)=>Promise.resolve({data:[]}).then(yes,no)};return chain},removeChannel:async()=>{},channel:()=>{const c={on:()=>c,subscribe:()=>c};return c}};
   window.qaInstallFixture=()=>{
    if(typeof resetEmployeeCrewSchedules==='function')resetEmployeeCrewSchedules();
    // Match real sign-out cleanup when replacing synthetic identities between checks.
    clearTimeout(inventoryToastTimer);document.getElementById('inventoryToast').textContent='';document.getElementById('inventoryToast').classList.remove('show');
    currentUser={id:'synthetic-wes-management-pilot'};currentUserAuthorized=true;currentUserIsAdmin=false;currentUserCanWrite=false;currentUserRole='walls_production_inventory_qc_v1';
    currentAllowedViews=['overview','walls','inventory','boxes','manholes','fence','block','qc','weekly-planner'];currentAllowedWallSubviews=['production','installation'];remoteReady=false;saveBusy=false;saveQueued=false;inventoryBusy=false;productionBusy=false;installationBusy=false;
    state.week='2026-10-26';state.productionDay='2026-10-26';state.installationDay='2026-10-26';state.installationWeek='2026-10-26';state.installationView='today';
    state.walls=[{id:'qa-mobile-wall',job:'SYNTHETIC — Mobile foundation with a long job label',customer:'Synthetic customer',model:'Synthetic foundation',address:'Synthetic site address',totalLf:120,productionDate:'2026-10-26',installDate:'2026-10-26',digDate:'2026-10-26',status:'Scheduled',links:[]}];
    state.jobs=['boxes','manholes','fence','block'].map(division=>({id:`qa-${division}`,division,name:`SYNTHETIC ${division}`,customer:'Synthetic customer',total:2,dailyRate:1,startDate:'2026-10-26',status:'On Track',baseProduced:0,links:[],products:[{id:`qa-${division}-hold`,label:'Synthetic piece awaiting QC',qty:1,plannedDate:'2026-10-26',status:'hold'},{id:`qa-${division}-released`,label:'Synthetic released piece',qty:1,plannedDate:'2026-10-26',pouredDate:'2026-10-26',releasedDate:'2026-10-26',status:'released'}]}));
    wallsProductionReady=true;wallsProductionError='';wallsProduction={permissions:{view:true,assign:true,plan:true,setup:true,pour:true,strip:true,issue:true},full_read_access:false,jobs:state.walls.map(w=>({...w,assignedLf:120,releaseStatus:'Released for Production',documentLinks:[]})),tables:[{table_id:'qa-mobile-table',label:'Synthetic table',capacity_lf:150,version:1}],assignments:[{assignment_id:'qa-mobile-run',wall_record_id:'qa-mobile-wall',table_id:'qa-mobile-table',stage:'setup_in_progress',wall_height:8,planned_lf:120,actual_poured_lf:0,setup_progress:50,setup_start_at:'2026-10-26T06:00',pour_at:'2026-10-26T12:00',strip_at:'2026-10-27T06:00',version:1}],issues:[]};
    wallsInstallationReady=true;wallsInstallationError='';wallsInstallation={permissions:{view:true,qc:true,manage:false,resources:false,field_progress:false},jobs:[{record_id:'qa-mobile-wall',job:state.walls[0],production:[{assignment_id:'qa-qc-run',stage:'stripped',table_id:'qa-mobile-table',planned_lf:120,wall_height:8}],qc:[],delivery:[],issues:[],installation:{readiness:{},closeout:{},version:1},activities:[{activity_id:'qa-mobile-activity',activity_type:'site_preparation',activity_date:'2026-10-26',start_time:'08:00',end_time:'10:00',status:'planned',resources:[{resource_assignment_id:'qa-mobile-resource',resource_type:'employee',resource_name:'Synthetic worker',availability_status:'unconfirmed',readiness_status:'unconfirmed',version:1}],notes:'Synthetic activity',version:1}]}],day_cards:[],resource_conflicts:[]};
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
   const syntheticInventory=structuredClone(inventoryItems);loadInventory=async()=>{inventoryItems=structuredClone(syntheticInventory).map(item=>({...item,description:item.description+' '+inventoryScopeKey}));inventoryReady=true;inventoryCanView=true;inventoryCanAdjust=true;inventoryCanManage=true;renderInventory();return true};
   wallsProduction.weeklyForecast={currentPlannedLf:120,actualPouredLf:60,baseline:{baseline_planned_lf:120,baseline_assignment_count:1,frozen_at:'2026-10-26T06:00:00Z',baseline_detail:[]},daily:[{date:'2026-10-26',plannedLf:120,actualLf:60}],assignments:[{assignmentId:'qa-mobile-run',job:'SYNTHETIC forecast foundation',tableLabel:'Synthetic table',wallHeight:8,plannedLf:120,actualLf:60,plannedPourDate:'2026-10-26',actualPourDate:'2026-10-26'}]};

  });

 const check=async(name,fn)=>{await fn();results.push({width,name,passed:true})};
 await check('restricted routes and readonly divisions',async()=>{
  for(const division of ['boxes','manholes','fence','block'])for(const sub of ['current','overall','monthly','year']){
   await page.evaluate(({division,sub})=>{state.view=division;state.subview[division]=sub;render()},{division,sub});
   assert.equal(await page.locator('[data-project],[data-pre],[data-pour],[data-edit-piece],[data-add-special],[data-undo-production],#addPrecastBtn').count(),0);
  }
  const before=await page.evaluate(()=>JSON.stringify(state.jobs));
  await page.evaluate(()=>{markPreReady('qa-boxes','qa-boxes-hold');markPoured('qa-boxes','qa-boxes-hold');passQC('qa-boxes','qa-boxes-hold');holdQC('qa-boxes','qa-boxes-released');releaseHold('qa-boxes','qa-boxes-hold');undoProductionCompletion('qa-boxes','qa-boxes-released');addSpecialPiece('qa-boxes');openProjectModal('qa-boxes');openPieceModal('qa-boxes','qa-boxes-hold')});
  assert.equal(await page.evaluate(()=>JSON.stringify(state.jobs)),before);assert.equal(await page.evaluate(()=>qaCalls.length),0);
 });
 await check('Walls-only QC and dismissed action',async()=>{
  await page.evaluate(()=>{state.view='qc';render()});
  assert.equal(await page.locator('[data-qc-pass],[data-qc-hold],[data-release-hold]').count(),0);
  assert.equal(await page.locator('[data-wall-qc]').count(),2);
  await page.locator('[data-wall-qc$="|released"]').click();assert.equal(await page.evaluate(()=>qaCalls.length),0);
  await page.screenshot({path:resolve(output,`${width}-walls-qc.png`),fullPage:true});
 });
 await check('field readonly despite QC',async()=>{
  await page.evaluate(()=>{state.view='walls';state.subview.walls='installation';render()});
  for(const selector of ['[data-install-readiness]','[data-install-issue]','[data-install-status]','[data-install-action="add"]','[data-install-edit-activity]','[data-install-edit-resources]'])assert.equal(await page.locator(selector+':visible').count(),0);
  await page.screenshot({path:resolve(output,`${width}-field-readonly.png`),fullPage:true});
 });
 await check('three inventory scopes and edits',async()=>{
  await page.evaluate(()=>{state.view='inventory';render()});
  assert.equal(await page.locator('[data-inventory-scope]').count(),3);
  for(const scope of ['walls-production','walls-install','boxes-production']){
   await page.locator(`[data-inventory-scope="${scope}"]`).click();
   assert.equal(await page.evaluate(()=>inventoryScopeKey),scope);
   assert.ok(await page.locator('[data-inv-action="edit"]').count()>0);assert.ok(await page.locator('[data-inv-action="order"]').count()>0);
   await page.locator('[data-inv-action="edit"]').first().click();assert.ok(await page.locator('#inventoryThresholdInput').isVisible());assert.ok(await page.locator('#inventoryUnitInput').isVisible());await page.evaluate(()=>closeInventoryModal());
   await page.screenshot({path:resolve(output,`${width}-inventory-${scope}.png`),fullPage:true});
  }
  assert.equal(await page.evaluate(()=>qaCalls.length),0);
  await page.screenshot({path:resolve(output,`${width}-inventory.png`),fullPage:true});
 });
 await check('four production views',async()=>{
  for(const view of ['today','week','tables','forecast']){
   await page.evaluate(view=>{state.view='walls';state.subview.walls='production';state.productionView=view;wallsProduction.assignments[0].stage=view==='week'?'planned':'setup_in_progress';render()},view);
   assert.equal(await page.locator('[data-plan-review],#addWallBtn,[data-wall],[data-complete-wall]').count(),0);
   if(view==='today'){assert.ok(await page.locator('[data-prod-progress]').count()>0);assert.ok(await page.locator('[data-prod-stage]').count()>0);assert.ok(await page.locator('[data-prod-issue]').count()>0);assert.ok(await page.locator('[data-prod-new]').count()>0)}
   if(view==='week'){assert.ok(await page.locator('[data-prod-open]').count()>0);await page.locator('[data-prod-open]').first().click();assert.ok(await page.locator('#productionModalSave').isVisible());assert.match(await page.locator('#productionModalBody').innerText(),/Planned|Setup|Pour/);await page.evaluate(()=>closeProductionModal())}
   if(view==='tables'){assert.ok(await page.locator('[data-prod-table]').count()>0);assert.ok(await page.locator('[data-prod-progress]').count()>0)}
   if(view==='forecast'){assert.equal(await page.locator('.weekly-forecast-card').count(),6);assert.match(await page.locator('#view').innerText(),/SYNTHETIC forecast foundation/);assert.match(await page.locator('#view').innerText(),/Actual poured LF/);assert.doesNotMatch(await page.locator('#view').innerText(),/forecast data is unavailable/);assert.equal(await page.locator('[data-prod-edit],[data-prod-new],[data-prod-stage]').count(),0)}
   await page.screenshot({path:resolve(output,`${width}-production-${view}.png`),fullPage:true});
  }
  assert.equal(await page.evaluate(()=>qaCalls.length),0);
 });
 await check('weekly schedule uses approved-only reader with no editing',async()=>{
  await page.evaluate(()=>{employeeCrewPacksCache={user:currentUser,client:sb,epoch:hubSessionEpoch,week:state.week,packs:[{pack_id:'qa-approved',week_start:state.week,pack_version:1,is_active:true,published_at:'2026-10-25T12:00:00Z',snapshot:{week_start:state.week,week_end:'2026-10-30',sections:[{section:{section_key:'walls_production',section_name:'Synthetic Walls production',status:'approved',sort_order:1},people:[],assignments:[]}]}}],ready:true,denied:false,error:'',notice:'',promise:null,opening:null};state.view='weekly-planner';render()});
  assert.equal(await page.locator('#operationsSidebar [data-view="weekly-planner"]').count(),1);
  assert.equal(await page.locator('[data-employee-crew-read]').count(),1);
  assert.equal(await page.locator('[data-planner-action],#view input,#view select,#view textarea').count(),0);
  assert.equal(await page.evaluate(()=>qaCalls.length),0);
  await page.screenshot({path:resolve(output,`${width}-weekly-approved.png`),fullPage:true});
 });
 await check('no global management destinations',async()=>{
  for(const view of ['billing','delivery','import','audit','history'])assert.equal(await page.locator(`#operationsSidebar [data-view="${view}"]:visible`).count(),0);
 });
 await page.close();
 }
 assert.deepEqual(pageErrors,[]);await writeFile(resolve(output,'results.json'),JSON.stringify({results,pageErrors},null,2));console.log(`PASS ${results.length} synthetic mixed-profile browser checks across six widths`);
} finally {await browser.close()}
