// Real UI + real PostgreSQL RPC/RLS. Only Auth, Realtime and transport are stubs.
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startHarness,identities} from './database-browser-adapter.mjs';
const output='artifacts/disposable-workflow';await mkdir(output,{recursive:true});
const harness=await startHarness(),results=[];
const browser=await chromium.launch({headless:true});
let failure;
try{
 const anon=await harness.rpc(null,'generate_weekly_planner',{p_week_start:'2026-10-26'});assert.ok(anon.error);results.push('Anonymous planner generation rejected by real SQL/grants');
 const viewer=await harness.rpc(identities.viewer,'generate_weekly_planner',{p_week_start:'2026-10-26'});assert.ok(viewer.error);results.push('Viewer planner mutation rejected by actual permission function');
 const outsider=await harness.rpc(identities.outsider,'get_weekly_planner_snapshot',{p_week_start:'2026-10-26'});assert.ok(outsider.error);results.push('Unassigned identity cannot read planner snapshot');
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>d.accept());
 // Browser is physically restricted to the test adapter origin; CDN/API/business traffic cannot escape.
 await page.route('**/*',route=>route.request().url().startsWith(harness.url+'/')?route.continue():route.abort());
 await page.goto(harness.url+'/?view=weekly-planner');
 await page.locator('#authEmail').fill(identities.admin.email);
 await page.locator('#authPassword').fill('disposable-only');
 await page.locator('#authForm button[type="submit"]').click();
 await page.waitForFunction(()=>currentUserIsAdmin&&remoteReady);
 await page.evaluate(()=>{state.week='2026-10-26';state.view='weekly-planner';state.weeklyPlannerView='planner';saveUiPrefs();render()});
 await page.waitForFunction(()=>weeklyPlannerReady&&weeklyPlannerLoadedWeek==='2026-10-26');
 await page.locator('[data-planner-action="generate"]').click();
 await page.waitForFunction(()=>weeklyPlanner.sections.length===8&&!weeklyPlannerBusy&&!weeklyPlannerLoadPromise);
 assert.equal(await page.evaluate(()=>weeklyPlanner.week.week_start),'2026-10-26');
 results.push('Real Generate button created eight Oct26 sections through PostgreSQL');
 await page.locator('[data-planner-action="tab"][data-value="review"]').click();
 const sections=await page.evaluate(()=>weeklyPlanner.sections.map(s=>({key:s.section_key,id:s.section_id})));
 for(const [i,section] of sections.entries()){
  await page.locator(`[data-planner-action="select-section"][data-value="${section.key}"]`).click();
  await page.locator('#plannerCrewLeader').fill('TEST Leader '+i);
  await page.locator('#plannerCrewPeopleNew').fill('TEST Leader '+i+', TEST Employee '+i);
  await page.locator('[data-planner-action="save-section"]').click();
  await page.waitForFunction(id=>!weeklyPlannerBusy&&!weeklyPlannerLoadPromise&&weeklyPlanner.people.filter(p=>p.section_id===id).length===2,section.id);
  assert.equal(await page.getByRole('checkbox',{name:'TEST Employee '+i,exact:true}).isChecked(),true);
  // Employees really persisted and reloaded, not injected into frontend state.
  const saved=(await harness.rpc(identities.admin,'get_weekly_planner_snapshot',{p_week_start:'2026-10-26'})).data;
  assert.equal(saved.people.filter(p=>p.section_id===section.id).length,2);
  const stale=await harness.rpc(identities.admin,'save_weekly_planner_section',{p_section_id:section.id,p_expected_version:0,p_crew_leader:'Must not overwrite',p_people:[],p_assignments:[]});
  assert.ok(stale.error);assert.match(stale.error.message,/version|changed|refresh/i);
  await page.locator('[data-planner-action="approve-section"]').click();
  await page.waitForFunction(id=>!weeklyPlannerBusy&&!weeklyPlannerLoadPromise&&weeklyPlanner.sections.find(s=>s.section_id===id)?.status==='approved',section.id);
 }
 results.push('Eight actual SQL saves, staff reloads, stale-version rejections and actual Approve button transitions');
 await page.screenshot({path:output+'/desktop-approved-crew.png',fullPage:true});
 await page.locator('[data-planner-action="tab"][data-value="approved"]').click();
 assert.equal(await page.locator('[data-planner-action="publish"]').isEnabled(),true);
 await page.locator('[data-planner-action="publish"]').click();
 await page.waitForFunction(()=>weeklyPlanner.packs.some(p=>p.is_active)&&!weeklyPlannerBusy&&!weeklyPlannerLoadPromise);
 const packet=await page.evaluate(()=>weeklyPlanner.packs.find(p=>p.is_active));
 assert.equal(packet.snapshot.sections.length,8);
 assert.equal(packet.snapshot.sections.every(s=>s.people.length===2),true);
 results.push('Real Publish button froze eight approved crews into persisted SQL packet');
 await page.screenshot({path:output+'/desktop-published-packet.png',fullPage:true});
 await page.reload();await page.waitForFunction(()=>currentUserIsAdmin&&remoteReady&&weeklyPlannerReady);
 assert.equal(await page.evaluate(()=>weeklyPlanner.packs.some(p=>p.is_active)),true);
 results.push('Reload restored synthetic session and persisted published packet through real snapshot RPC');
 await page.setViewportSize({width:390,height:1000});
 await page.locator('[data-planner-action="tab"][data-value="review"]').click();
 await page.screenshot({path:output+'/mobile-approved-crew.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
 await page.locator('#signOutBtn').click();
 assert.equal(await page.evaluate(()=>currentUser===null),true);
 const denied=await page.evaluate(()=>sb.rpc('generate_weekly_planner',{p_week_start:'2026-11-02'}));assert.ok(denied.error);
 results.push('Sign-out cleared provider session; subsequent mutation denied under anonymous real DB role');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({results,calls:harness.calls},null,2));
}catch(error){failure=error;console.error(error)}finally{
 await writeFile(output+'/results.json',JSON.stringify({results,failure:failure?.stack||null,calls:harness.calls,coverageLimitations:['Supabase Auth JWT verification/password flows are not exercised','Realtime delivery is a provider stub; scheduling/refetch unit tests cover coalescing separately','No live operational records or external services are used']},null,2));
 await browser.close();await harness.close();
}
if(failure)throw failure;
