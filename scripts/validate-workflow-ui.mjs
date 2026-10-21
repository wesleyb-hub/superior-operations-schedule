// Offline rendered smoke check. Requires Playwright and Chromium; no service access.
// Run: node scripts/validate-workflow-ui.mjs [screenshot-directory]
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=resolve(import.meta.dirname,'..');
const source=await readFile(resolve(root,'index.html'),'utf8');
// Test-only client injection seam; production still declares its client const.
const html=source.replace(/<script src="[^"]+"><\/script>/g,'').replace('const sb=','let sb=');
const output=process.argv[2];if(output)await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const failures=[],results=[];
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url()==='http://offline.test/'?route.fulfill({contentType:'text/html',body:html}):route.abort());
  await page.goto('http://offline.test/');
  // Synthetic fixtures only: quantities/names are test data, never business defaults.
  // External scripts are stripped above: no credentials, remote records, or live client.
  await page.evaluate(()=>{
   currentUserIsAdmin=true;currentUserAuthorized=true;currentUserCanWrite=false;
   wallsProductionReady=true;wallsInstallationReady=true;
   inventoryReady=true;inventoryCanView=true;
   weeklyPlannerReady=true;weeklyPlannerLoadedWeek=state.week;
   const day=todayISO();
   state.walls=[{id:'qa-wall',job:'QA ONLY — Foundation with a long job label',customer:'Synthetic customer',model:'Test foundation',address:'Synthetic site address for wrapping checks',totalLf:120,productionDate:day,installDate:day,digDate:day,status:'Scheduled',links:[]}];
   state.jobs=['boxes','manholes','fence','block'].map(division=>({id:'qa-'+division,division,name:'QA ONLY — '+division+' project',customer:'Synthetic customer',total:2,dailyRate:1,startDate:day,status:'On Track',baseProduced:0,links:[],products:[
    {id:'qa-'+division+'-hold',label:'Synthetic piece — awaiting QC',qty:1,plannedDate:day,status:'hold'},
    {id:'qa-'+division+'-released',label:'Synthetic released piece',qty:1,plannedDate:day,pouredDate:day,releasedDate:day,status:'released'}
   ]}));
   wallsProduction.jobs=state.walls.map(w=>({...w,assignedLf:120,releaseStatus:'Released for Production',documentLinks:[]}));
   wallsProduction.tables=[{table_id:'qa-table',label:'QA ONLY table',capacity_lf:150}];
   wallsProduction.assignments=[{assignment_id:'qa-run',wall_record_id:'qa-wall',table_id:'qa-table',stage:'setup_in_progress',planned_lf:120,actual_poured_lf:0,setup_progress:50,setup_start_at:day+'T06:00',pour_at:day+'T12:00',strip_at:addDays(day,1)+'T06:00',version:1}];
   wallsInstallation.jobs=[{record_id:'qa-wall',job:state.walls[0],production:[],qc:[],delivery:[],issues:[],installation:{readiness:{},closeout:{}},activities:[{activity_id:'qa-site',activity_type:'site_preparation',activity_date:day,start_time:'08:00',end_time:'10:00',status:'planned',resources:[],notes:'Synthetic activity',version:1}]}];
   inventoryItems=INVENTORY_SEED.slice(0,12).map((item,index)=>({id:index+1,...item,unit:'units',qty:index===0?0:20,threshold:5,ordered:index===1,version:1}));
   ensureState();
   showAuthGate(false);
  });
  const views=['overview','walls','boxes','manholes','fence','block','qc','delivery','inventory','weekly-planner','billing','exceptions','import','audit','history','search'];
  for(const view of views){
   await page.evaluate(view=>{state.view=view;render()},view);
   await page.waitForTimeout(30);
   const measure=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,content:document.querySelector('#view').textContent.trim().length,overflow:document.documentElement.scrollWidth>innerWidth+2?[...document.querySelectorAll('#view *')].filter(e=>e.getBoundingClientRect().right>innerWidth+2).slice(0,15).map(e=>({tag:e.tagName,id:e.id,className:e.className,right:Math.round(e.getBoundingClientRect().right)})):[]}));
   results.push({width,view,...measure});
   if(!measure.content)failures.push(`${width} ${view}: empty render`);
   if(measure.scroll>width+2)failures.push(`${width} ${view}: horizontal page overflow ${measure.scroll}`);
   if(output)await page.screenshot({path:resolve(output,`${width}-${view}.png`),fullPage:true});
  }
  for(const subview of ['current','overall','active','plans','monthly','year','installation']){
   await page.evaluate(subview=>{state.view='walls';state.subview.walls=subview;render()},subview);
   const scroll=await page.evaluate(()=>document.documentElement.scrollWidth);
   results.push({width,view:`walls-${subview}`,scroll});
   if(scroll>width+2)failures.push(`${width} walls-${subview}: horizontal page overflow ${scroll}`);
   if(output)await page.screenshot({path:resolve(output,`${width}-walls-${subview}.png`),fullPage:true});
  }
  await page.evaluate(()=>{state.view='walls';state.subview.walls='production';render()});
  const help=page.locator('#wallsWorkflowReference');assert.equal(await help.isVisible(),true);
  await help.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await help.getAttribute('open'),'');
  assert.match(await help.textContent(),/does not call for a second physical inspection/);
  await page.keyboard.press('Enter');assert.equal(await help.getAttribute('open'),null);
  await page.evaluate(()=>{state.view='boxes';render()});assert.equal(await help.isVisible(),false);
  await page.evaluate(()=>{state.view='walls';render()});assert.equal(await help.isVisible(),true);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.operations-sidebar').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  // Employee picker: local synthetic snapshot, no database or authorization requests.
  await page.evaluate(()=>{
   state.view='weekly-planner';state.weeklyPlannerView='review';weeklyPlannerSelected='production';
   weeklyPlanner={permissions:{edit:true},week:null,sections:[{section_id:'qa-a',section_key:'production',section_name:'Synthetic production',status:'draft',schedule_version:1},{section_id:'qa-b',section_key:'field',section_name:'Synthetic field',status:'draft',schedule_version:1}],people:[{section_id:'qa-a',employee_name:'Test Alpha',role_name:'Synthetic role'},{section_id:'qa-b',employee_name:'Test Beta'}],availability:[{employee_name:'Test Alpha'},{employee_name:'TEST ALPHA'},{employee_name:'Test Gamma'}],assignments:[],conflicts:[],resources:[]};renderWeeklyPlanner();
  });
  const search=page.locator('#plannerCrewPeopleSearch'),names=page.locator('#plannerCrewPeopleSelect [data-planner-person]');
  assert.equal(await names.count(),3);
  await search.fill('beta');assert.equal(await page.locator('.planner-person-choice:visible').count(),1);
  const beta=page.getByRole('checkbox',{name:'Test Beta',exact:true});await beta.focus();await page.keyboard.press('Space');assert.equal(await beta.isChecked(),true);
  assert.match(await page.locator('#plannerCrewPeopleWarnings').textContent(),/Synthetic field/);
  await search.fill('not-present');assert.equal(await page.locator('#plannerCrewPeopleEmpty').isVisible(),true);
  assert.equal(await page.locator('#plannerCrewPeopleCount').textContent(),'2 selected · 0 matching saved names');
  await search.press('Escape');assert.equal(await search.inputValue(),'');assert.equal(await page.locator('.planner-person-choice:visible').count(),3);
  await page.locator('#plannerCrewPeopleNew').fill('Custom Synthetic, TEST ALPHA');
  await search.fill('gamma'); // Selected Alpha/Beta stay captured while hidden by search.
  const payload=await page.evaluate(()=>plannerCaptureSection(plannerSection('production')));
  assert.deepEqual(payload.p_people.map(x=>x.name),['Test Alpha','Test Beta','Custom Synthetic']);
  assert.equal(payload.p_people[0].role,'Synthetic role');
  // A synthetic server round trip validates render/capture without invoking the real RPC.
  await page.evaluate(payload=>{weeklyPlanner.people=weeklyPlanner.people.filter(x=>x.section_id!==payload.p_section_id).concat(payload.p_people.map(x=>({section_id:payload.p_section_id,employee_name:x.name,role_name:x.role,is_leader:x.is_leader})));renderWeeklyPlanner()},payload);
  assert.equal(await page.getByRole('checkbox',{name:'Custom Synthetic',exact:true}).isChecked(),true);
  await page.getByRole('checkbox',{name:'Test Beta',exact:true}).uncheck();assert.equal(await page.locator('#plannerCrewPeopleWarnings').isVisible(),false);
  await search.fill('alpha');await search.fill('');assert.equal(await page.getByRole('checkbox',{name:'Test Beta',exact:true}).isChecked(),false);
  await page.locator('#plannerCrewLeader').fill('Unsaved Synthetic Leader');
  await page.locator('#plannerCrewPeopleNew').fill('Unsaved Synthetic Employee');
  await search.fill('previous');
  await page.evaluate(()=>{const cache=plannerEmployeeHistoryCache();cache.names=['Previously Used Synthetic'];cache.ready=true;refreshPlannerEmployeeHistoryChoices()});
  assert.equal(await page.locator('#plannerCrewLeader').inputValue(),'Unsaved Synthetic Leader');
  assert.equal(await page.locator('#plannerCrewPeopleNew').inputValue(),'Unsaved Synthetic Employee');
  assert.equal(await page.getByRole('checkbox',{name:'Previously Used Synthetic',exact:true}).isChecked(),false);
  assert.equal((await page.evaluate(()=>plannerSelectedEmployeeNames())).includes('Test Alpha'),true);
  assert.match(await page.locator('#plannerEmployeeHistoryHint').textContent(),/not a verified current staff roster/);
  await search.fill('');
  const pickerOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert.equal(pickerOverflow,false);
  if(output)await page.screenshot({path:resolve(output,`${width}-planner-employee-picker.png`),fullPage:true});
  results.push({width,view:'planner-employee-picker',passed:true});
  // Actual browser clicks exercise failed save -> retained controls -> successful approval.
  // All service calls below terminate in this synthetic in-memory adapter.
  await page.evaluate(()=>{
   currentUser={id:'synthetic-browser-admin'};currentUserIsAdmin=true;
   subscribeWeeklyPlanner=()=>{};weeklyPlanner.permissions={edit:true,approve:true,publish:true};
   weeklyPlanner.sections[0].crew_leader='Test Alpha';
   window.qaPlannerDb=structuredClone(weeklyPlanner);window.qaPlannerCalls=[];window.qaPlannerFail=true;
   const cache=plannerEmployeeHistoryCache();cache.ready=true;
   sb={rpc:async(name,args)=>{
    window.qaPlannerCalls.push({name,args:structuredClone(args)});
    if(name==='get_weekly_planner_snapshot')return {data:structuredClone(window.qaPlannerDb)};
    const section=window.qaPlannerDb.sections.find(s=>s.section_id===args.p_section_id);
    if(name==='save_weekly_planner_section'){
     if(window.qaPlannerFail)return {error:{message:'Synthetic save timed out',code:'57014'}};
     if(section.schedule_version!==args.p_expected_version)throw new Error('Synthetic stale save version');
     section.schedule_version++;section.crew_leader=args.p_crew_leader;section.status='needs_review';
     window.qaPlannerDb.people=window.qaPlannerDb.people.filter(p=>p.section_id!==section.section_id).concat(args.p_people.map(p=>({section_id:section.section_id,employee_name:p.name,role_name:p.role,is_leader:p.is_leader})));
     return {data:structuredClone(section)};
    }
    if(name==='approve_weekly_planner_section'){
     if(section.schedule_version!==args.p_expected_version)throw new Error('Synthetic stale approval version');
     section.status='approved';return {data:structuredClone(section)};
    }
    throw new Error('Unexpected synthetic RPC '+name);
   }};plannerEmployeeHistoryCache().ready=true;renderWeeklyPlanner();
  });
  page.on('dialog',dialog=>dialog.accept());
  await page.locator('#plannerCrewLeader').fill('Test Alpha');
  await page.locator('#plannerCrewPeopleNew').fill('Retained Synthetic Employee');
  await page.locator('[data-planner-action="approve-section"]').click();
  await page.waitForFunction(()=>weeklyPlannerDraftError.includes('on-screen edits are retained'));
  assert.equal(await page.locator('#plannerCrewPeopleNew').inputValue(),'Retained Synthetic Employee');
  assert.equal(await page.evaluate(()=>window.qaPlannerCalls.length),1);
  assert.match(await page.locator('#plannerSectionFeedback').textContent(),/Synthetic save timed out/);
  if(output)await page.screenshot({path:resolve(output,`${width}-planner-save-retry.png`),fullPage:true});
  await page.evaluate(()=>{window.qaPlannerFail=false});
  await page.locator('[data-planner-action="approve-section"]').click();
  await page.waitForFunction(()=>weeklyPlanner.sections[0].status==='approved'&&!weeklyPlannerLoadPromise);
  assert.equal(await page.getByRole('checkbox',{name:'Retained Synthetic Employee',exact:true}).isChecked(),true);
  assert.deepEqual(await page.evaluate(()=>window.qaPlannerCalls.map(c=>c.name)),['save_weekly_planner_section','save_weekly_planner_section','approve_weekly_planner_section','get_weekly_planner_snapshot']);
  results.push({width,view:'planner-approval-retry',passed:true});
  failures.push(...errors.map(e=>`${width}: ${e}`));await page.close();
 }
 if(output)await writeFile(resolve(output,'results.json'),JSON.stringify({results,failures},null,2));
 console.log(JSON.stringify({screens:results.length,failures},null,2));assert.equal(failures.length,0);
}finally{await browser.close()}
