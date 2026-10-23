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
const viewports=[{width:360,height:800},{width:390,height:800},{width:430,height:800},{width:844,height:390}];
const requiredManagementViews=['overview','walls','boxes','manholes','fence','block','qc','delivery','inventory','weekly-planner','billing','exceptions','import','audit','history'];
try{
 for(const viewport of viewports){
  const {width,height}=viewport,label=`${width}x${height}`;
  const page=await browser.newPage({viewport,hasTouch:true});page.setDefaultTimeout(7000);
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
   if(!await page.locator('#operationsSidebar').evaluate(el=>el.classList.contains('open')))await page.locator('#operationsNavMenu').click();
   await page.locator(`#operationsSidebar [data-view="${view}"]`).click();
   await page.waitForFunction(view=>state.view===view,view);
   await page.waitForFunction(()=>scrollY<=2,null,{timeout:2000});
  }
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
 const report={method:'Offline synthetic Chromium with touch-capable context; not real device, live employee auth or backend authorization proof.',viewports,results,failures,pageErrors,blockedRequests};
 if(output)await writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({checks:results.length,failures,pageErrors,blockedRequestCount:blockedRequests.length},null,2));
}
assert.equal(failures.length,0,'Mobile pilot acceptance checks failed');assert.equal(pageErrors.length,0,'Mobile pilot page errors');
