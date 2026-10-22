// Actual browser planner orchestration and controls; every service call is synthetic memory only.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';

export async function plannerSnapshotDomChecks(browser,html,width,output){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.request().url()==='http://offline.test/'?route.fulfill({contentType:'text/html',body:html}):route.abort());
 page.on('dialog',dialog=>dialog.accept());
 try{
  await page.goto('http://offline.test/');
  await page.clock.install();
  await page.evaluate(()=>{
   currentUser={id:'synthetic-planner-queue'};currentUserIsAdmin=true;currentUserAuthorized=true;showAuthGate(false);
   state.view='weekly-planner';state.week='2026-10-26';state.weeklyPlannerView='review';weeklyPlannerSelected='walls_production';
   weeklyPlannerReady=false;weeklyPlannerLoadedWeek='';weeklyPlannerLoadPromise=null;weeklyPlannerLoadToken=null;weeklyPlannerError='';weeklyPlannerDraftError='';
   weeklyPlannerChannel=null;weeklyPlannerRealtimePromise=null;weeklyPlannerRealtimeDirty=false;
   window.qaQueueCalls=[];window.qaQueueHandlers=[];window.qaQueueActive=0;window.qaQueueMaxActive=0;
   window.qaQueueDb={permissions:{edit:true,approve:true,publish:true},week:null,sections:[{section_id:'synthetic-section',section_key:'walls_production',section_name:'Synthetic production',status:'needs_review',schedule_version:1,crew_leader:'Synthetic Leader',source_fingerprint:'synthetic-source'}],people:[{section_id:'synthetic-section',employee_name:'Synthetic Leader',role_name:'',is_leader:true}],assignments:[],availability:[],resources:[],conflicts:[],packs:[],recent_packs:[],audit:[]};
   sb={rpc(name,args){const read=name==='get_weekly_planner_snapshot';if(read){window.qaQueueActive++;window.qaQueueMaxActive=Math.max(window.qaQueueMaxActive,window.qaQueueActive)}const call={name,args:structuredClone(args)};window.qaQueueCalls.push(call);return new Promise((resolve,reject)=>{let settled=false;call.resolve=result=>{if(settled)return;settled=true;if(read)window.qaQueueActive--;resolve(result)};call.reject=error=>{if(settled)return;settled=true;if(read)window.qaQueueActive--;reject(error)}})},channel(){return {on(_event,_filter,fn){window.qaQueueHandlers.push(fn);return this},subscribe(){return this}}},removeChannel(){},from(){const chain={select:()=>chain,eq:()=>chain,not:()=>chain,order:()=>chain,limit:async()=>({data:[]}),maybeSingle:async()=>({data:null})};return chain}};
   plannerEmployeeHistoryCache().ready=true;plannerCompanyRosterCache().ready=true;weeklyPlannerInstallEmployeesReady=true;
   renderWeeklyPlanner();
  });
  await page.waitForFunction(()=>window.qaQueueCalls.length===1);
  await page.evaluate(()=>window.qaQueueHandlers[0]());await page.clock.fastForward(500);
  await page.evaluate(()=>{window.qaQueueManual=refreshWeeklyPlannerManually();for(let i=0;i<40;i++)void refreshWeeklyPlannerManually()});
  assert.equal(await page.evaluate(()=>window.qaQueueCalls.length),1);
  assert.equal(await page.evaluate(()=>window.qaQueueMaxActive),1);
  await page.evaluate(()=>window.qaQueueCalls[0].resolve({data:structuredClone(window.qaQueueDb)}));
  await page.waitForFunction(()=>window.qaQueueCalls.length===2);
  await page.evaluate(()=>window.qaQueueCalls[1].resolve({data:structuredClone(window.qaQueueDb)}));
  assert.equal(await page.evaluate(()=>window.qaQueueManual),true);
  assert.equal(await page.locator('#plannerSectionFeedback').textContent(),'Weekly plan refreshed.');
  assert.equal(await page.locator('[data-planner-action="reload"]').isEnabled(),true);

  // A previously-started snapshot stays physically active through save/approval.
  await page.locator('#plannerCrewPeopleNew').fill('Retained Synthetic Employee');
  await page.evaluate(()=>{window.qaQueueDraftNode=document.getElementById('plannerCrewPeopleNew');window.qaQueueOld=loadWeeklyPlanner(true,'realtime')});
  await page.waitForFunction(()=>window.qaQueueCalls.length===3);
  await page.locator('[data-planner-action="approve-section"]').click();
  await page.waitForFunction(()=>window.qaQueueCalls.length===4);
  assert.equal(await page.locator('[data-planner-action="approve-section"]').isDisabled(),true);
  assert.equal(await page.locator('#weekSelect').isDisabled(),true);
  assert.match(await page.locator('#plannerSectionFeedback').textContent(),/Saving your draft/);
  await page.evaluate(()=>{for(let i=0;i<20;i++)void document.querySelector('[data-planner-action="approve-section"]').onclick()});
  assert.equal(await page.evaluate(()=>window.qaQueueCalls.length),4);
  await page.evaluate(()=>{const call=window.qaQueueCalls[3],section=window.qaQueueDb.sections[0];section.schedule_version=2;section.status='needs_review';window.qaQueueDb.people=call.args.p_people.map(person=>({section_id:section.section_id,employee_name:person.name,role_name:person.role,is_leader:person.is_leader}));call.resolve({data:structuredClone(section)})});
  await page.waitForFunction(()=>window.qaQueueCalls.length===5);
  assert.match(await page.locator('#plannerSectionFeedback').textContent(),/Approval is in progress/);
  assert.equal(await page.locator('[data-planner-action="approve-section"]').textContent(),'Approving…');
  assert.equal(await page.locator('#plannerCrewPeopleNew').inputValue(),'Retained Synthetic Employee');
  assert.equal(await page.evaluate(()=>window.qaQueueDraftNode===document.getElementById('plannerCrewPeopleNew')),true);
  await page.evaluate(()=>{window.qaQueueDb.sections[0].status='approved';window.qaQueueCalls[4].resolve({data:structuredClone(window.qaQueueDb.sections[0])})});
  await page.waitForFunction(()=>weeklyPlannerProgress?.label==='Refreshing…');
  assert.equal(await page.evaluate(()=>window.qaQueueCalls.length),5,'post-write read waits for older physical snapshot');
  assert.equal(await page.locator('[data-planner-action="approve-section"]').isDisabled(),true);
  await page.evaluate(()=>window.qaQueueCalls[2].resolve({data:{...structuredClone(window.qaQueueDb),sections:[{...window.qaQueueDb.sections[0],status:'needs_review',schedule_version:1}]}}));
  assert.equal(await page.evaluate(()=>window.qaQueueOld),false);
  await page.waitForFunction(()=>window.qaQueueCalls.length===6);
  assert.equal(await page.evaluate(()=>window.qaQueueMaxActive),1);
  await page.evaluate(()=>window.qaQueueCalls[5].resolve({data:structuredClone(window.qaQueueDb)}));
  await page.waitForFunction(()=>!weeklyPlannerProgress&&!weeklyPlannerLoadPromise);
  assert.equal(await page.locator('[data-planner-action="approve-section"]').isEnabled(),true);
  assert.equal(await page.getByRole('checkbox',{name:'Retained Synthetic Employee',exact:true}).isChecked(),true);
  assert.match(await page.locator('#plannerSectionMetadata').textContent(),/Version 2/);
  assert.equal(await page.locator('#plannerSectionMetadata .planner-status.approved').count(),1);
  if(output)await page.screenshot({path:resolve(output,`${width}-planner-snapshot-queue-approved.png`),fullPage:true});

  // A subsequent rejected approval must clear the old badge and retain typed input.
  await page.locator('#plannerCrewPeopleNew').fill('Retained Rejected Approval');
  await page.locator('[data-planner-action="approve-section"]').click();
  await page.waitForFunction(()=>window.qaQueueCalls.length===7);
  await page.evaluate(()=>{const section=window.qaQueueDb.sections[0];section.schedule_version=3;section.status='needs_review';window.qaQueueCalls[6].resolve({data:structuredClone(section)})});
  await page.waitForFunction(()=>window.qaQueueCalls.length===8);
  await page.evaluate(()=>window.qaQueueCalls[7].resolve({error:{message:'Synthetic source changed; refresh required'}}));
  await page.waitForFunction(()=>!weeklyPlannerProgress);
  assert.match(await page.locator('#plannerSectionFeedback').textContent(),/approval failed.*Synthetic source changed/);
  assert.equal(await page.locator('#plannerSectionMetadata .planner-status.approved').count(),0);
  assert.equal(await page.locator('#plannerSectionMetadata .planner-status.needs_review').count(),1);
  assert.equal(await page.locator('#plannerCrewPeopleNew').inputValue(),'Retained Rejected Approval');
  assert.equal(await page.evaluate(()=>window.qaQueueCalls.length),8);assert.equal(await page.evaluate(()=>window.qaQueueMaxActive),1);assert.equal(await page.evaluate(()=>window.qaQueueActive),0);
  if(output)await page.screenshot({path:resolve(output,`${width}-planner-snapshot-queue-rejected.png`),fullPage:true});
  // Supabase reports lost fetches as returned status 0, not always thrown errors.
  await page.evaluate(()=>{window.qaQueueDb.sections[0].status='approved';weeklyPlanner.sections[0].status='approved';plannerRefreshSectionMetadata(weeklyPlanner.sections[0])});
  assert.equal(await page.locator('#plannerSectionMetadata .planner-status.approved').count(),1);
  await page.locator('#plannerCrewPeopleNew').fill('Retained Unknown Outcome');
  await page.evaluate(()=>window.qaQueueUnknownDraft=document.getElementById('plannerCrewPeopleNew'));
  await page.locator('[data-planner-action="approve-section"]').click();
  await page.waitForFunction(()=>window.qaQueueCalls.length===9);
  await page.evaluate(()=>window.qaQueueCalls[8].resolve({status:0,error:{message:'Failed to fetch',code:''}}));
  await page.waitForFunction(()=>!weeklyPlannerProgress);
  assert.match(await page.locator('#plannerSectionFeedback').textContent(),/response was lost.*may have completed.*No automatic retry/);
  assert.equal(await page.locator('#plannerSectionMetadata .planner-status.approval_unverified').count(),1);
  assert.equal(await page.locator('#plannerSectionMetadata .planner-status.approved').count(),0);
  assert.equal(await page.locator('#plannerCrewPeopleNew').inputValue(),'Retained Unknown Outcome');
  assert.equal(await page.evaluate(()=>window.qaQueueUnknownDraft===document.getElementById('plannerCrewPeopleNew')),true);
  assert.equal(await page.evaluate(()=>window.qaQueueCalls.length),9);
  if(output)await page.screenshot({path:resolve(output,`${width}-planner-snapshot-queue-uncertain.png`),fullPage:true});
  // Deliberate authoritative verification restores approval; a later unknown
  // Generate result neutralizes all rendered badges/cards/counts without a reload.
  await page.evaluate(()=>{const first=window.qaQueueDb.sections[0];window.qaQueueDb.sections=Array.from({length:8},(_,i)=>({...first,section_id:i?'synthetic-section-'+i:first.section_id,section_key:i?'synthetic-area-'+i:first.section_key,section_name:'Synthetic section '+i,status:'approved'}));window.qaQueueDb.week={status:'reapproval_required',week_end:'2026-10-30',source_stale:false};window.qaQueueDb.recent_packs=[{pack_id:'current',week_start:'2026-10-26',is_active:true,pack_version:2,published_at:'2026-10-22T12:00:00Z',published_by_email:'synthetic@example.invalid'},{pack_id:'other',week_start:'2026-10-19',is_active:true,pack_version:1,published_at:'2026-10-15T12:00:00Z',published_by_email:'synthetic@example.invalid'},{pack_id:'inactive',week_start:'2026-10-26',is_active:false,pack_version:1,published_at:'2026-10-21T12:00:00Z',published_by_email:'synthetic@example.invalid'}]});
  await page.locator('[data-planner-action="reload"]').click();
  await page.waitForFunction(()=>window.qaQueueCalls.length===10);
  await page.evaluate(()=>window.qaQueueCalls[9].resolve({data:structuredClone(window.qaQueueDb)}));
  await page.waitForFunction(()=>!weeklyPlannerManualRefreshRequest);
  await page.evaluate(()=>{state.weeklyPlannerView='planner';renderWeeklyPlanner()});
  assert.equal(await page.locator('.planner-section-card.approved').count(),8);
  assert.equal(await page.locator('[data-planner-readiness-title]').textContent(),'REAPPROVAL COMPLETE — NEW PACKET READY');
  await page.locator('[data-planner-action="generate"]').click();
  await page.waitForFunction(()=>window.qaQueueCalls.length===11);
  await page.evaluate(()=>window.qaQueueCalls[10].resolve({status:504,error:{message:'Gateway timeout',code:''}}));
  await page.waitForFunction(()=>!weeklyPlannerProgress);
  assert.match(await page.locator('#plannerSaveFeedback').textContent(),/outcome unknown.*Refresh and verify.*no automatic retry/);
  assert.equal(await page.locator('.planner-section-card.approved').count(),0);
  assert.equal(await page.locator('#view .planner-status.approved').count(),0);
  assert.equal(await page.locator('[data-planner-approved-count]').textContent(),'0');
  assert.equal(await page.locator('[data-planner-readiness-title]').textContent(),'APPROVAL UNVERIFIED');
  await page.evaluate(()=>renderWeeklyPlanner());
  assert.equal(await page.locator('[data-planner-readiness-title]').textContent(),'APPROVAL UNVERIFIED');
  assert.equal(await page.evaluate(()=>window.qaQueueCalls.length),11);
  assert.equal(await page.evaluate(()=>window.qaQueueMaxActive),1);assert.equal(await page.evaluate(()=>window.qaQueueActive),0);
  if(output)await page.screenshot({path:resolve(output,`${width}-planner-snapshot-queue-generate-uncertain.png`),fullPage:true});
  // Sources have a green linked-row count that is not an approval badge.
  // Unknown Save inputs must keep it intact and retain the actual draft fields.
  await page.evaluate(()=>{window.qaQueueDb.availability=[{employee_name:'Synthetic Available Employee',availability:{mon:'available',tue:'available',wed:'available',thu:'available',fri:'available'},notes:'',confirmed:true}];window.qaQueueDb.resources=[{resource_type:'crane',resource_name:'Synthetic Crane',work_date:'2026-10-26',section_key:'walls_production',readiness_status:'ready'}]});
  await page.locator('[data-planner-action="reload"]').click();await page.waitForFunction(()=>window.qaQueueCalls.length===12);
  await page.evaluate(()=>window.qaQueueCalls[11].resolve({data:structuredClone(window.qaQueueDb)}));await page.waitForFunction(()=>!weeklyPlannerManualRefreshRequest);
  await page.evaluate(()=>{state.weeklyPlannerView='sources';renderWeeklyPlanner()});
  const availability=page.locator('[data-planner-availability] [data-field="employee_name"]'),resource=page.locator('[data-planner-resource] [data-field="resource_name"]'),lockedResource=page.locator('[data-planner-resource] [data-field="project_location"]');
  await availability.fill('Retained Availability Draft');await resource.fill('Retained Crane Draft');
  await page.evaluate(()=>{window.qaQueueAvailabilityNode=document.querySelector('[data-planner-availability] [data-field="employee_name"]');window.qaQueueResourceNode=document.querySelector('[data-planner-resource] [data-field="resource_name"]');document.querySelector('[data-planner-resource] [data-field="project_location"]').disabled=true});
  assert.equal(await page.locator('[data-planner-readiness-title]').textContent(),'REAPPROVAL COMPLETE — NEW PACKET READY');
  const linked=page.locator('.planner-status').filter({hasText:/^0 linked$/});assert.equal(await linked.count(),1);assert.match(await linked.getAttribute('class'),/approved/);
  await page.locator('[data-planner-action="save-inputs"]').click();await page.waitForFunction(()=>window.qaQueueCalls.length===13);
  assert.equal(await availability.isDisabled(),true);assert.equal(await resource.isDisabled(),true);assert.equal(await lockedResource.isDisabled(),true);
  await page.evaluate(()=>window.qaQueueCalls[12].resolve({status:0,error:{message:'Failed to fetch',code:''}}));await page.waitForFunction(()=>!weeklyPlannerProgress);
  assert.equal(await availability.isEnabled(),true);assert.equal(await resource.isEnabled(),true);assert.equal(await lockedResource.isDisabled(),true);
  assert.equal(await availability.inputValue(),'Retained Availability Draft');assert.equal(await resource.inputValue(),'Retained Crane Draft');
  assert.equal(await page.evaluate(()=>window.qaQueueAvailabilityNode===document.querySelector('[data-planner-availability] [data-field="employee_name"]')&&window.qaQueueResourceNode===document.querySelector('[data-planner-resource] [data-field="resource_name"]')),true);
  assert.equal(await linked.textContent(),'0 linked');assert.match(await linked.getAttribute('class'),/approved/);assert.equal(await page.locator('[data-planner-readiness-title]').textContent(),'APPROVAL UNVERIFIED');
  assert.match(await page.locator('#plannerSaveFeedback').textContent(),/outcome unknown.*no automatic retry/);
  assert.equal(await page.evaluate(()=>window.qaQueueCalls.length),13);
  if(output)await page.screenshot({path:resolve(output,`${width}-planner-snapshot-queue-inputs-uncertain.png`),fullPage:true});
  await page.evaluate(()=>{window.qaQueuePackData=JSON.stringify(weeklyPlanner.recent_packs);state.weeklyPlannerView='approved';renderWeeklyPlanner()});
  assert.equal(await page.locator('[data-planner-pack-activation="2026-10-26"][data-planner-pack-active="true"]').textContent(),'Activation unverified — refresh to verify');
  assert.equal(await page.locator('[data-planner-pack-activation="2026-10-19"][data-planner-pack-active="true"]').textContent(),'ACTIVE');
  assert.equal(await page.locator('[data-planner-pack-activation="2026-10-26"][data-planner-pack-active="false"]').textContent(),'INACTIVE · retained for history');
  assert.equal(await page.evaluate(()=>window.qaQueuePackData===JSON.stringify(weeklyPlanner.recent_packs)),true);
  assert.equal(await page.locator('[data-planner-action="publish"]').isDisabled(),true);
  // Successful source save keeps fields locked until its authoritative read ends.
  await page.locator('[data-planner-action="reload"]').click();await page.waitForFunction(()=>window.qaQueueCalls.length===14);
  await page.evaluate(()=>window.qaQueueCalls[13].resolve({data:structuredClone(window.qaQueueDb)}));await page.waitForFunction(()=>!weeklyPlannerManualRefreshRequest);
  await page.evaluate(()=>{state.weeklyPlannerView='sources';renderWeeklyPlanner()});
  await availability.fill('Confirmed Availability Draft');await resource.fill('Confirmed Crane Draft');
  await page.locator('[data-planner-action="save-inputs"]').click();await page.waitForFunction(()=>window.qaQueueCalls.length===15);
  assert.equal(await availability.isDisabled(),true);assert.equal(await resource.isDisabled(),true);
  await page.evaluate(()=>{window.qaQueueDb.availability=structuredClone(window.qaQueueCalls[14].args.p_availability);window.qaQueueDb.resources=structuredClone(window.qaQueueCalls[14].args.p_resources);window.qaQueueCalls[14].resolve({data:true})});
  await page.waitForFunction(()=>window.qaQueueCalls.length===16&&weeklyPlannerProgress?.label==='Refreshing…');
  assert.equal(await availability.isDisabled(),true);assert.equal(await resource.isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.qaQueueCalls[15].name),'get_weekly_planner_snapshot');
  await page.evaluate(()=>window.qaQueueCalls[15].resolve({data:structuredClone(window.qaQueueDb)}));await page.waitForFunction(()=>!weeklyPlannerProgress);
  assert.equal(await availability.isEnabled(),true);assert.equal(await resource.isEnabled(),true);assert.equal(await availability.inputValue(),'Confirmed Availability Draft');assert.equal(await resource.inputValue(),'Confirmed Crane Draft');
  assert.equal(await page.evaluate(()=>window.qaQueueCalls.length),16);assert.equal(await page.evaluate(()=>window.qaQueueMaxActive),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);assert.deepEqual(errors,[]);
  return {width,view:'planner-snapshot-queue',checks:['mixed initial/realtime/manual one active read','double-click lock','typed DOM retained','post-write freshness barrier','confirmed approval','failed approval clears old badge','status-zero uncertainty retains draft','unknown generation neutralizes approval display','unknown input save retains draft and linked count','current packet activation uncertainty','source field lock through authoritative refresh'],passed:true};
 }finally{await page.close()}
}
