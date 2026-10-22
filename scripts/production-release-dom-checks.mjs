// Actual browser rendering, strip click, RPC refresh and full-page reload against synthetic memory only.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';

export async function productionReleaseDomChecks(browser,html,width,output){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.request().url()==='http://offline.test/'?route.fulfill({contentType:'text/html',body:html}):route.abort());
 const install=async data=>page.evaluate(async data=>{
  window.qaReleaseDb=structuredClone(data);window.qaReleaseCalls=[];
  currentUser={id:'synthetic-production-user'};currentUserIsAdmin=true;currentUserAuthorized=true;showAuthGate(false);
  state.view='walls';state.subview.walls='production';state.productionView='today';state.productionDay='2026-10-20';
  state.walls=data.wall?[structuredClone(data.wall)]:[];
  sb={rpc:async(name,args)=>{
   window.qaReleaseCalls.push({name,args:structuredClone(args)});
   const db=window.qaReleaseDb;
   if(name==='get_walls_production_snapshot'){
    const wall=db.wall,active=wall&&!wall.completedDate&&!wall.completedMonth;
    return {data:{permissions:{view:true,setup:true,strip:true,issue:true},tables:[{table_id:'synthetic-table',label:'Synthetic table',capacity_lf:150}],
     jobs:active?[{id:wall.id,job:wall.job,model:wall.type,releaseStatus:wall.planReview?.stages?.approvedProduction?.status==='Complete'?'Released for Production':'Not Released for Production'}]:[],
     assignments:[structuredClone(db.assignment)],issues:structuredClone(db.issues),events:[]}};
   }
   if(name==='get_walls_production_weekly_forecast')return {data:{}};
   if(name==='advance_walls_production_stage'){
    if(args.p_assignment_id!==db.assignment.assignment_id||args.p_new_stage!=='stripped'||db.assignment.stage!=='curing')throw Error('Unexpected synthetic stage transition');
    db.assignment.stage='stripped';return {data:structuredClone(db.assignment)};
   }
   throw Error('Unexpected synthetic RPC: '+name);
  }};
  return loadWallsProduction();
 },data);
 try{
  await page.goto('http://offline.test/');
  assert.equal(await install({wall:{id:'synthetic-wall',job:'SYNTHETIC — release regression',type:'Test foundation',planReview:{stages:{approvedProduction:{status:'Not Started'}}}},assignment:{assignment_id:'synthetic-run',wall_record_id:'synthetic-wall',table_id:'synthetic-table',stage:'planned',wall_height:8,planned_lf:100,setup_start_at:'2026-10-20T06:00',pour_at:'2026-10-20T12:00',strip_at:'2026-10-20T16:00'},issues:[]}),true);
  let card=page.locator('.production-card.strip');
  assert.match(await card.textContent(),/Not Released for Production/);
  assert.equal(await card.getByRole('button',{name:'Start setup',exact:true}).isDisabled(),true);
  await page.evaluate(async()=>{window.qaReleaseDb.wall.planReview.stages.approvedProduction.status='Complete';state.walls=[structuredClone(window.qaReleaseDb.wall)];await loadWallsProduction()});
  assert.equal(await card.locator('.production-pill.release').textContent(),'Released for Production');
  assert.equal(await card.getByRole('button',{name:'Start setup',exact:true}).isEnabled(),true);
  await page.evaluate(async()=>{window.qaReleaseDb.assignment.stage='curing';await loadWallsProduction()});
  assert.match(await card.textContent(),/Actual strip status: Not recorded/);
  page.once('dialog',dialog=>dialog.accept('Synthetic strip recorded'));
  await card.getByRole('button',{name:'Record stripped',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.production-card.strip')?.textContent.includes('Actual strip status: Complete'));
  assert.equal(await card.locator('.production-pill.release').textContent(),'Released for Production');
  assert.equal(await page.evaluate(()=>window.qaReleaseCalls.filter(c=>c.name==='advance_walls_production_stage').length),1);
  // Completion belongs to the independent schedule, not the strip RPC. Its snapshot filter causes the fallback.
  await page.evaluate(async()=>{window.qaReleaseDb.wall.completedMonth='2026-10';state.walls=[structuredClone(window.qaReleaseDb.wall)];await loadWallsProduction()});
  assert.equal(await page.evaluate(()=>wallsProduction.jobs.length),0);
  assert.equal(await page.evaluate(()=>Object.hasOwn(state.walls[0],'releaseStatus')),false);
  assert.equal(await card.locator('.production-pill.release').textContent(),'Released for Production');
  assert.match(await card.textContent(),/Stripped \/ Table Available/);assert.doesNotMatch(await card.textContent(),/Not Released for Production|Final QC released/);
  const persisted=await page.evaluate(()=>structuredClone(window.qaReleaseDb));
  await page.reload();assert.equal(await install(persisted),true);card=page.locator('.production-card.strip');
  assert.match(await card.textContent(),/Actual strip status: Complete/);
  assert.equal(await card.locator('.production-pill.release').textContent(),'Released for Production');
  if(output)await page.screenshot({path:resolve(output,`${width}-production-stripped-release.png`),fullPage:true});
  await page.evaluate(async()=>{window.qaReleaseDb.issues=[{assignment_id:'synthetic-run',status:'open',category:'Synthetic hold',description:'Inspection follow-up'}];await loadWallsProduction()});
  assert.equal(await card.evaluate(element=>element.classList.contains('hold')),true);
  assert.match(await card.textContent(),/1 open issue/);assert.equal(await card.locator('.production-pill.release').count(),1);
  await page.evaluate(async()=>{window.qaReleaseDb.wall.planReview.stages.approvedProduction.status='Waiting';state.walls=[structuredClone(window.qaReleaseDb.wall)];await loadWallsProduction()});
  assert.match(await card.textContent(),/Not Released for Production/);assert.match(await card.textContent(),/1 open issue/);assert.match(await card.textContent(),/Actual strip status: Complete/);
  assert.equal(await card.locator('.production-pill.release').count(),0);
  if(output)await page.screenshot({path:resolve(output,`${width}-production-stripped-hold.png`),fullPage:true});
  await page.evaluate(async()=>{window.qaReleaseDb.wall=null;state.walls=[];await loadWallsProduction()});
  assert.match(await card.textContent(),/Production release unavailable/);assert.equal(await card.locator('.production-pill.release').count(),0);
  assert.match(await card.textContent(),/Actual strip status: Complete/);assert.match(await card.textContent(),/1 open issue/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);assert.deepEqual(errors,[]);
  return {width,view:'production-stripped-release',checks:['pre-release blocked','explicit approval','actual strip click','completed-job fallback','full reload and RPC refresh','independent hold and revoked approval','missing source fail-closed'],passed:true};
 }finally{await page.close()}
}
