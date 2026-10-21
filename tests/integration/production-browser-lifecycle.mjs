// Real production UI controls -> test transport -> actual PostgreSQL RPCs/RLS.
// Only provider Auth/Realtime/transport are replaced. No business logic mocks.
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startHarness,identities} from './database-browser-adapter.mjs';
const output='artifacts/disposable-production';await mkdir(output,{recursive:true});
const harness=await startHarness(),results=[],errors=[],dialogs=[];
const browser=await chromium.launch({headless:true});let page,failure,assignment;
const jobId='TEST-BROWSER-WALL',loadId='TEST-BROWSER-LOAD';
const rpc=async(name,args)=>{const r=await harness.rpc(identities.admin,name,args);assert.equal(r.error,null,JSON.stringify(r.error));return r.data};
try{
 const snap=await rpc('get_schedule_snapshot',{}),data=snap.payload.data;
 assert.ok(!data.walls.some(w=>w.id===jobId),'fixture must not already exist');
 const stages=Object.fromEntries(['permitPackage','preliminarySubmittal','finalSubmittal','structuralReview','productionDrawings','installDrawings','approvedProduction'].map(k=>[k,{status:'Not Started',date:''}]));
 data.walls.push({id:jobId,job:'TEST-BROWSER-001',customer:'SYNTHETIC TEST ONLY',project:'TEST browser lifecycle',lf:80,lfByHeight:{h8:80},productionDate:'',installDate:'2026-11-11',planReview:{stages}});
 data.loads.push({id:loadId,division:'walls',linkType:'wall',linkId:jobId,status:'Scheduled',date:'2026-11-11',project:'TEST-BROWSER-001',load:'TEST browser load',qty:80});
 await rpc('save_schedule_snapshot',{p_expected_revision:snap.revision,p_snapshot:data,p_reason:'SYNTHETIC browser fixture only'});
 await rpc('upsert_walls_production_table',{p_table_id:'9002',p_label:'TEST Browser Board',p_capacity_lf:100,p_enabled:true,p_notes:'Disposable test board'});
 results.push('SETUP via actual SQL: isolated 80LF unapproved master job, scheduled load, configured board; no frontend state/data injection');
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',async d=>{dialogs.push({type:d.type(),message:d.message()});await d.accept(d.type()==='prompt'?(d.message().includes('percent complete')?'50':'TEST browser verified'):undefined)});
 await page.route('**/*',r=>r.request().url().startsWith(harness.url+'/')?r.continue():r.abort());
 await page.goto(harness.url+'/');await page.locator('#authEmail').fill(identities.admin.email);await page.locator('#authPassword').fill('disposable-only');await page.locator('#authForm button[type="submit"]').click();
 await page.waitForFunction(()=>currentUserIsAdmin&&remoteReady);
 const saveClick=async selector=>{const response=page.waitForResponse(r=>r.url()===harness.url+'/rpc'&&r.request().postDataJSON()?.name==='save_schedule_snapshot');await page.locator(selector).click();const saved=await(await response).json();assert.equal(saved.error,null,JSON.stringify(saved.error));await page.waitForFunction(()=>!saveBusy&&!saveQueued);return saved.data};
 await page.evaluate(()=>{state.view='walls';state.subview.walls='plans';state.planReviewView='my';render()});
 for(const key of Object.keys(stages)){
  await page.locator(`[data-plan-review="${jobId}"]`).first().click();
  await page.locator(`[data-plan-status="${key}"]`).selectOption('Complete');
  await page.locator(`[data-plan-date="${key}"]`).fill('2026-10-21');
  await page.locator('#planReviewNotes').fill('TEST actual plan review milestone '+key);
  const saved=await saveClick('#savePlanReview');
  assert.equal(saved.payload.data.walls.find(w=>w.id===jobId)?.planReview.stages[key].status,'Complete');
 }
 await page.evaluate(()=>{state.subview.walls='active';render()});
 await page.locator(`[data-wall="${jobId}"]`).first().click();await page.locator('#wProduction').fill('2026-11-09');await page.locator('#wDelivery').fill('2026-11-11');
 const dated=await saveClick('#saveWall');assert.equal(dated.payload.data.walls.find(w=>w.id===jobId)?.productionDate,'2026-11-09');
 results.push('UI: seven plan-review status/date saves through ApprovedProduction, then actual master-job edit scheduled production');
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:output+'/plan-review-released.png',fullPage:true});
 // Navigation preferences only; all mutations below use actual bound UI controls.
 await page.evaluate(async()=>{state.view='walls';state.subview.walls='production';state.productionDay='2026-11-09';state.productionView='today';await loadWallsProduction();render()});
 await page.locator(`[data-prod-new="${jobId}"]`).click();
 await page.locator('#prodJob').selectOption(jobId);await page.locator('#prodTable').selectOption('9002');await page.locator('#prodHeight').selectOption('8');await page.locator('#prodLf').fill('80');
 await page.locator('#prodSetup').fill('2026-11-09T07:00');await page.locator('#prodPour').fill('2026-11-09T15:00');await page.locator('#prodStrip').fill('2026-11-10T07:00');await page.locator('#prodNotes').fill('TEST actual assignment modal');
 await page.locator('#productionModalSave').click();
 await page.waitForFunction(id=>!productionBusy&&wallsProduction.assignments.some(a=>a.wall_record_id===id),jobId);
 assignment=await page.evaluate(id=>wallsProduction.assignments.find(a=>a.wall_record_id===id).assignment_id,jobId);
 await page.locator('[data-production-view="tables"]').click();
 results.push('UI: assignment modal persisted correct job/table/height/80LF and planned dates');
 const stage=async value=>{await page.locator(`[data-prod-stage="${assignment}|${value}"]`).click();await page.waitForFunction(({id,value})=>!productionBusy&&wallsProduction.assignments.find(a=>a.assignment_id===id)?.stage===value,{id:assignment,value})};
 await stage('setup_in_progress');await page.locator(`[data-prod-progress="${assignment}"]`).click();
 await page.waitForFunction(id=>!productionBusy&&wallsProduction.assignments.find(a=>a.assignment_id===id)?.setup_progress===50,assignment);
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:output+'/board-setup-50.png',fullPage:true});
 await stage('setup_complete');await stage('ready_for_pour');
 await page.locator(`[data-prod-pour="${assignment}"]`).click();await page.locator('#prodActualLf').fill('80');await page.locator('#prodStageNote').fill('TEST actual pour modal');await page.locator('#productionModalSave').click();
 await page.waitForFunction(id=>!productionBusy&&wallsProduction.assignments.find(a=>a.assignment_id===id)?.stage==='poured',assignment);
 await stage('curing');await stage('stripped');
 results.push('UI: Start setup, 50% progress, Setup complete, pre-pour ready, actual pour modal, curing, stripped all persisted');
 await page.reload();await page.waitForFunction(()=>currentUserIsAdmin&&remoteReady);
 await page.evaluate(async()=>{state.view='walls';state.subview.walls='production';state.productionDay='2026-11-09';state.productionView='today';await loadWallsProduction();render()});
 assert.equal(await page.evaluate(id=>wallsProduction.assignments.find(a=>a.assignment_id===id)?.actual_poured_lf,assignment),80);
 assert.equal(await page.evaluate(id=>wallsProduction.assignments.find(a=>a.assignment_id===id)?.stage,assignment),'stripped');
 results.push('UI reload restored actual 80LF and stripped stage from PostgreSQL');
 await page.evaluate(async()=>{state.view='qc';state.installationDay='2026-11-11';state.installationWeek='2026-11-09';await ensureWallsInstallationLoaded(true);render()});
 await page.locator(`[data-wall-qc="${assignment}|hold"]`).click();
 await page.waitForFunction(id=>wallsInstallation.jobs.some(j=>(j.qc||[]).some(q=>q.assignment_id===id&&q.status==='hold')),assignment);
 await page.locator(`[data-wall-qc="${assignment}|released"]`).click();
 await page.waitForFunction(id=>wallsInstallation.jobs.some(j=>(j.qc||[]).some(q=>q.assignment_id===id&&q.status==='released')),assignment);
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:output+'/final-qc-released.png',fullPage:true});
 results.push('UI: final-QC hold and release buttons persisted separate post-strip inspection');
 await page.evaluate(async()=>{state.view='delivery';state.week='2026-11-09';await ensureWallsInstallationLoaded(true);render()});
 await page.locator(`[data-wall-load-map="${loadId}"]`).first().click();
 await page.locator(`[data-load-assignment="${assignment}"]`).check();await page.locator('#productionModalSave').click();
 await page.waitForFunction(({jobId,loadId,assignment})=>wallsInstallation.jobs.find(j=>j.record_id===jobId)?.delivery.some(l=>l.record_id===loadId&&(l.assignment_ids||[]).includes(assignment)),{jobId,loadId,assignment});
 const changeLoad=async status=>{
  const response=page.waitForResponse(r=>r.url()===harness.url+'/rpc'&&r.request().postDataJSON()?.name==='save_schedule_snapshot');
  await page.locator(`[data-load="${loadId}"]`).first().click();
  const saved=await(await response).json();assert.equal(saved.error,null,JSON.stringify(saved.error));
  await page.waitForFunction(()=>!saveBusy&&!saveQueued);
  const persisted=await rpc('get_schedule_snapshot',{});assert.equal(persisted.payload.data.loads.find(l=>l.id===loadId)?.status,status);
 };
 await changeLoad('Loaded');await changeLoad('Delivered');
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:output+'/delivered-load.png',fullPage:true});
 results.push('UI: exact shipment run mapping and Scheduled→Loaded→Delivered buttons persisted through master snapshot RPC');
 await page.evaluate(async()=>{state.view='walls';state.subview.walls='installation';state.installationView='today';state.installationDay='2026-11-11';state.installationWeek='2026-11-09';await ensureWallsInstallationLoaded(true);render()});
 const activity=async(type,start,end)=>{
  await page.locator('[data-install-action="add"]').first().click();
  if(await page.locator('#productionModalSave').isDisabled()){
   assert.notEqual(process.env.EXPECT_MODAL_SAVE_RESET,'1','New activity modal must not inherit disabled Save after shipment mapping');
   results.push('KNOWN FAILURE — NOT FIXED: shipment mapping leaves the shared Save button disabled; normal page reload required before continuing Installation');
   await page.screenshot({path:output+'/known-disabled-save.png',fullPage:true});
   await page.reload();await page.waitForFunction(()=>currentUserIsAdmin&&remoteReady);
   await page.evaluate(async()=>{state.view='walls';state.subview.walls='installation';state.installationView='today';state.installationDay='2026-11-11';state.installationWeek='2026-11-09';await ensureWallsInstallationLoaded(true);render()});
   await page.locator('[data-install-action="add"]').first().click();
   assert.equal(await page.locator('#productionModalSave').isDisabled(),false,'Fresh page must permit the normal activity form');
  }
  await page.locator('#installJob').selectOption(jobId);await page.locator('#installType').selectOption(type);await page.locator('#installDate').fill('2026-11-11');await page.locator('#installStart').fill(start);await page.locator('#installEnd').fill(end);await page.locator('#installNotes').fill('TEST browser '+type);
  const crew=page.locator('.install-resource-entry').first();await crew.locator('[data-resource-choice]').selectOption('__custom');await crew.locator('[data-resource-custom]').fill('TEST Browser Crew');await crew.locator('[data-resource-role]').fill('TEST crew lead');await crew.locator('[data-resource-availability]').selectOption('confirmed');
  await page.locator('#productionModalSave').click();
  await page.waitForFunction(({jobId,type})=>wallsInstallation.jobs.find(j=>j.record_id===jobId)?.activities.some(a=>a.activity_type===type),{jobId,type});
  return page.evaluate(({jobId,type})=>wallsInstallation.jobs.find(j=>j.record_id===jobId).activities.find(a=>a.activity_type===type).activity_id,{jobId,type});
 };
 const reveal=async locator=>{const details=locator.locator('xpath=ancestor::details[1]');if(await details.count()&&await details.getAttribute('open')===null)await details.locator(':scope > summary').click()};
 const activityStatus=async(id,status)=>{const button=page.locator(`[data-install-status="${id}|${status}"]`).first();await reveal(button);await button.click();await page.waitForFunction(({jobId,id,status})=>wallsInstallation.jobs.find(j=>j.record_id===jobId)?.activities.some(a=>a.activity_id===id&&a.status===status),{jobId,id,status})};
 for(const [type,start,end] of [['site_preparation','06:00','07:00'],['stone_footing','07:00','08:00']]){const id=await activity(type,start,end);await activityStatus(id,'in_progress');await activityStatus(id,'completed')}
 const install=await activity('wall_installation','09:00','15:00');
 assert.equal(await page.locator(`[data-install-status="${install}|in_progress"]`).first().isDisabled(),true,'installation Start is disabled until explicit run scope');
 await reveal(page.locator(`[data-install-scope="${install}"]`).first());await page.locator(`[data-install-scope="${install}"]`).first().click();await page.locator(`[data-scope-assignment="${assignment}"]`).check();await page.locator(`[data-scope-load="${assignment}"]`).selectOption(loadId);await page.locator('#productionModalSave').click();
 await page.waitForFunction(({jobId,install,assignment})=>wallsInstallation.jobs.find(j=>j.record_id===jobId)?.activities.find(a=>a.activity_id===install)?.production_scope?.some(s=>s.assignment_id===assignment),{jobId,install,assignment});
 await activityStatus(install,'in_progress');await activityStatus(install,'completed');
 await reveal(page.locator(`[data-install-readiness="${jobId}"]`).first());await page.locator(`[data-install-readiness="${jobId}"]`).first().click();
 for(const k of ['site_access','excavation','layout_elevation','stone_footing','equipment_access','site_preparation_complete'])await page.locator(`[data-readiness="${k}"]`).selectOption('ready');
 for(const k of ['bolting','caulking'])await page.locator(`[data-closeout="${k}"]`).selectOption('complete');
 await page.locator('#installFieldComplete').selectOption('true');await page.locator('#productionModalSave').click();
 await page.waitForFunction(jobId=>wallsInstallation.jobs.find(j=>j.record_id===jobId)?.installation?.closeout?.field_complete===true,jobId);
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:output+'/installation-field-closeout.png',fullPage:true});
 results.push('UI: separate site/stone activity forms and Start/Complete; crew assignment; installation disabled before scope; delivered run selection; Start/Complete; verified field closeout');
 await page.evaluate(()=>{state.view='walls';state.subview.walls='active';render()});
 await page.locator(`[data-wall="${jobId}"]`).first().click();await page.locator('#wCompleted').fill('2026-11-11');
 const completed=await saveClick('#saveWall');assert.equal(completed.payload.data.walls.find(w=>w.id===jobId)?.completedDate,'2026-11-11');
 await page.reload();await page.waitForFunction(()=>currentUserIsAdmin&&remoteReady);
 assert.equal(await page.evaluate(jobId=>state.walls.find(w=>w.id===jobId)?.completedDate,jobId),'2026-11-11');
 results.push('UI: explicit exact-date master completion persisted and survived reload after verified installation closeout');

 assert.deepEqual(errors,[]);assert.deepEqual(dialogs.filter(d=>d.type==='alert'),[]);
 console.log(JSON.stringify({results,dialogs,calls:harness.calls},null,2));
}catch(e){failure=e;console.error(e);if(page)await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});}finally{
 await writeFile(output+'/results.json',JSON.stringify({results,dialogs,errors,failure:failure?.stack||null,calls:harness.calls,limitations:['Unapproved master job/load/table seeded via real SQL; plan-review and scheduling edits use actual UI','Navigation preferences are set programmatically; workflow edits use bound UI controls and real database RPCs','Auth/Realtime are provider stubs; no hosted Supabase Auth coverage','Site/stone UI examples run sequentially here; parallel field preparation was verified by actual SQL lifecycle tests']},null,2));
 await browser.close();await harness.close();
}
if(failure)throw failure;
