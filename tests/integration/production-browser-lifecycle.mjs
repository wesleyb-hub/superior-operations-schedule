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
 const stages=Object.fromEntries(['permitPackage','preliminarySubmittal','finalSubmittal','structuralReview','productionDrawings','installDrawings','approvedProduction'].map(k=>[k,{status:'Complete',date:'2026-10-21'}]));
 data.walls.push({id:jobId,job:'TEST-BROWSER-001',customer:'SYNTHETIC TEST ONLY',project:'TEST browser lifecycle',lf:80,lfByHeight:{h8:80},productionDate:'2026-11-09',installDate:'2026-11-11',planReview:{stages}});
 data.loads.push({id:loadId,division:'walls',linkType:'wall',linkId:jobId,status:'Scheduled',date:'2026-11-11',project:'TEST-BROWSER-001',load:'TEST browser load',qty:80});
 await rpc('save_schedule_snapshot',{p_expected_revision:snap.revision,p_snapshot:data,p_reason:'SYNTHETIC browser fixture only'});
 await rpc('upsert_walls_production_table',{p_table_id:'9002',p_label:'TEST Browser Board',p_capacity_lf:100,p_enabled:true,p_notes:'Disposable test board'});
 results.push('SETUP via actual SQL: isolated 80LF approved master job, scheduled load, configured board; no frontend state/data injection');
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',async d=>{dialogs.push({type:d.type(),message:d.message()});await d.accept(d.type()==='prompt'?(d.message().includes('percent complete')?'50':'TEST browser verified'):undefined)});
 await page.route('**/*',r=>r.request().url().startsWith(harness.url+'/')?r.continue():r.abort());
 await page.goto(harness.url+'/');await page.locator('#authEmail').fill(identities.admin.email);await page.locator('#authPassword').fill('disposable-only');await page.locator('#authForm button[type="submit"]').click();
 await page.waitForFunction(()=>currentUserIsAdmin&&remoteReady);
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
 await page.screenshot({path:output+'/board-setup-50.png',fullPage:true});
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
 await page.screenshot({path:output+'/final-qc-released.png',fullPage:true});
 results.push('UI: final-QC hold and release buttons persisted separate post-strip inspection');
 assert.deepEqual(errors,[]);assert.deepEqual(dialogs.filter(d=>d.type()==='alert'),[]);
 console.log(JSON.stringify({results,dialogs,calls:harness.calls},null,2));
}catch(e){failure=e;console.error(e);if(page)await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});}finally{
 await writeFile(output+'/results.json',JSON.stringify({results,dialogs,errors,failure:failure?.stack||null,calls:harness.calls,limitations:['Approved master job/load/table seeded via real SQL, not master-entry UI','Auth/Realtime are provider stubs; no hosted Supabase Auth coverage','Delivery/install full lifecycle remains covered by separate actual SQL tests until UI extensions pass']},null,2));
 await browser.close();await harness.close();
}
if(failure)throw failure;
