// Disposable loopback SQL only: real UI reads, actual functions and RLS, synthetic Auth.
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startHarness,identities} from './database-browser-adapter.mjs';
const output='artifacts/disposable-hub-readonly';await mkdir(output,{recursive:true});
const views=['today','overview','walls','boxes','manholes','fence','block','qc','delivery','inventory','weekly-planner','billing','exceptions','import','audit','history','search'];
const subviews=['production','installation','current','overall','active','plans','monthly','year'];
const harness=await startHarness(),results=[],errors=[];let browser,failure;
try{
 await harness.pool.query('insert into auth.users(id,email) values($1,$2)',[identities.reader.id,identities.reader.email]);
 await harness.pool.query(`insert into public.app_employee_access(user_id,profile_key,legal_entity,division_key,inventory_area,allowed_views,allowed_wall_subviews,enabled,inventory_can_view,inventory_can_adjust,inventory_can_manage) values($1,'hub_readonly_v1','Superior Walls of North Dakota, LLC','walls','production',$2,$3,true,true,false,false)`,[identities.reader.id,views,subviews]);
 const access=await harness.rpc(identities.reader,'get_app_access',{});assert.equal(access.error,null);assert.equal(access.data.full_read_access,true);assert.equal(access.data.can_write,false);assert.equal(access.data.is_admin,false);
 const snap=await harness.rpc(identities.admin,'get_schedule_snapshot',{});assert.equal(snap.error,null);const data=snap.data.payload.data;data.jobs.push({id:'TEST-READER-QC',division:'boxes',name:'SYNTHETIC readonly QC project',customer:'TEST ONLY',type:'Box',status:'On Track',total:2,regularPieceCount:2,products:[{id:'TEST-READER-PRE',label:'Synthetic pre-QC',qty:1,status:'pre-ready',plannedDate:'2026-10-27',productionDays:1},{id:'TEST-READER-FINAL',label:'Synthetic final-QC',qty:1,status:'final-needed',plannedDate:'2026-10-27',productionDays:1}]});data.billing.push({key:'TEST-READER-INVOICE',division:'boxes',project:'SYNTHETIC readonly invoice',customer:'TEST ONLY',billableDate:'2026-10-27',billableMonth:'2026-10',qty:2,unit:'pieces',status:'Billed',invoice:'TEST-INVOICE',invoiceDate:'2026-10-27'});const seeded=await harness.rpc(identities.admin,'save_schedule_snapshot',{p_expected_revision:snap.data.revision,p_snapshot:data,p_reason:'SYNTHETIC readonly UI fixtures'});assert.equal(seeded.error,null,JSON.stringify(seeded.error));
 const week='2026-10-26';const generated=await harness.rpc(identities.admin,'generate_weekly_planner',{p_week_start:week});assert.equal(generated.error,null,JSON.stringify(generated.error));
 const tableNames=(await harness.pool.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r=>r.tablename);
 const digest=async()=>{const rows=[];for(const name of tableNames){assert.match(name,/^[a-z_][a-z0-9_]*$/);rows.push([name,(await harness.pool.query(`select md5(coalesce(string_agg(row_to_json(t)::text,'|' order by row_to_json(t)::text),'')) digest from public."${name}" t`)).rows[0].digest])}return JSON.stringify(rows)};const before=await digest();
 browser=await chromium.launch({headless:true});
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:950}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{errors.push('Unexpected dialog: '+d.message());await d.dismiss()});
  await page.route('**/*',route=>route.request().url().startsWith(harness.url+'/')?route.continue():route.abort());
  await page.goto(harness.url+'/');await page.locator('#authEmail').fill(identities.reader.email);await page.locator('#authPassword').fill('disposable-only');await page.locator('#authForm button[type="submit"]').click();
  await page.waitForFunction(()=>hubReadOnly()&&remoteReady&&!currentUserCanWrite&&!currentUserIsAdmin);
  await page.evaluate(w=>{state.week=w;state.reportMonth=w.slice(0,7)},week);
  if(width===390){await page.locator('#operationsNavMenu').click();assert.equal(await page.locator('#operationsSidebar').evaluate(el=>el.classList.contains('open')),true);await page.locator('.tab[data-view="billing"]').click();assert.equal(await page.locator('#operationsSidebar').evaluate(el=>el.classList.contains('open')),false)}
  const mutations='[data-bill],[data-bhold],[data-wall-qc],[data-qc-pass],[data-qc-hold],[data-release-hold],[data-load],[data-install-status],[data-prod-stage],[data-prod-new],[data-prod-progress],[data-prod-pour],#addLoadBtn,#addPrecastBtn,#addWallBtn';
  for(const view of views){
   await page.evaluate(v=>setView(v),view);
   if(view==='inventory')await page.waitForFunction(()=>inventoryReady||inventoryLoadError);
   if(view==='billing')assert.match(await page.locator('#view').innerText(),/SYNTHETIC readonly invoice/);
   if(view==='qc'||view==='delivery')await page.waitForFunction(()=>wallsInstallationReady||wallsInstallationError);
   if(view==='weekly-planner')await page.waitForFunction(()=>weeklyPlannerReady||weeklyPlannerError);
   assert.equal(await page.evaluate(()=>state.view),view);assert.ok(await page.locator('#view').innerText(),view+' content');
   const visible=await page.locator(mutations).evaluateAll(els=>els.filter(el=>!el.hidden&&el.getClientRects().length&&!el.disabled).map(el=>el.outerHTML.slice(0,150)));assert.deepEqual(visible,[],view+' exposes mutation');
   if(['qc','billing','weekly-planner','overview'].includes(view)){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),view+' page overflow');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${output}/${width}-${view}.png`,fullPage:true})}
  }
  for(const subview of subviews){await page.evaluate(v=>{setView('walls');setSubview('walls',v)},subview);assert.equal(await page.evaluate(()=>state.subview.walls),subview);assert.ok(await page.locator('#view').innerText())}
  await page.evaluate(()=>setView('inventory'));for(const scope of ['walls-production','walls-install','boxes-production']){await page.evaluate(scope=>setInventoryScope(scope),scope);await page.waitForFunction(()=>inventoryReady||inventoryLoadError);assert.equal(await page.evaluate(()=>inventoryLoadError),'');assert.equal(await page.evaluate(()=>inventoryCanAdjust||inventoryCanManage),false)}
  await page.evaluate(()=>{setView('weekly-planner');state.weeklyPlannerView='review';renderWeeklyPlanner()});await page.waitForFunction(()=>weeklyPlannerReady);assert.ok(await page.locator('.planner-review').count());
  assert.equal(await page.locator('.planner-review-main input:not([disabled]),.planner-review-main textarea:not([disabled]),.planner-review-main select:not([disabled])').count(),0);
  await page.screenshot({path:`${output}/${width}-planner-draft.png`,fullPage:true});
  const changes=await page.evaluate(async()=>{const before=JSON.stringify(sharedDataFromState(state));for(const name of ['saveWall','saveProject','applyImport','moveDelivery','deleteDelivery','markPreReady','markPoured','passQC','holdQC','releaseHold','plannerAddAssignment'])await window[name]('synthetic','synthetic');return {before,after:JSON.stringify(sharedDataFromState(state))}});assert.equal(changes.after,changes.before);
  await page.evaluate(()=>setView('billing'));await page.reload();await page.waitForFunction(()=>hubReadOnly()&&remoteReady);await page.evaluate(()=>signOut());await page.waitForFunction(()=>!currentUser&&!currentUserFullReadAccess);assert.equal(await page.evaluate(()=>hubReadOnly()),false);
  results.push(`${width}px: 17 sections, 8 Walls subviews, 3 inventory scopes, readonly draft review, QC/billing screenshots, direct-handler no mutation, reload/sign-out`);await page.close();
 }
 const readOnlyCalls=new Set(['get_app_access','get_schedule_snapshot','get_inventory_scopes','get_inventory_snapshot','get_walls_installation_snapshot','get_walls_production_snapshot','get_walls_production_weekly_forecast','get_weekly_planner_snapshot','employee_password_owner_status']);assert.deepEqual(harness.calls.filter(call=>call.identity===identities.reader.email&&!readOnlyCalls.has(call.name)),[]);assert.equal(await digest(),before,'Reader UI must leave every public table unchanged');
 assert.deepEqual(errors,[]);
}catch(error){failure=error;results.push('FAIL: '+error.stack)}finally{await writeFile(output+'/results.json',JSON.stringify({results,errors,calls:harness.calls},null,2));await browser?.close();await harness.close()}
if(failure)throw failure;console.log(results.join('\n'));
