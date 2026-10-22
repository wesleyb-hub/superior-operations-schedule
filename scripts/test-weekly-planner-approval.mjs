// Synthetic button-handler integration; no production requests or credentials.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(){
 const calls=[],messages=[],buttons=['generate','save-section','approve-section','publish'].map(action=>({dataset:{plannerAction:action},disabled:false,textContent:action==='approve-section'?'Approve section':action==='save-section'?'Save section':action}));
 const inputs={plannerCrewLeader:{value:'Synthetic Leader'},plannerCrewPeopleNew:{value:''},plannerSectionFeedback:{textContent:''}};
 const selected=[{value:'Synthetic Leader'}];
 const metadata={dataset:{sectionId:'synthetic-0'},innerHTML:'Version 1 · APPROVED'},statusLabel={dataset:{plannerSectionStatus:'synthetic-0'},textContent:'approved'};inputs.plannerSectionMetadata=metadata;
 const db={sections:Array.from({length:8},(_,i)=>({section_id:`synthetic-${i}`,section_key:`area-${i}`,schedule_version:1,status:'needs_review'})),people:[],permissions:{edit:true,approve:true,publish:true},packs:[]};
 const c={currentUser:{id:"synthetic"},hubSessionEpoch:0,Promise,Number,Map,console,state:{week:'2026-10-26',view:'weekly-planner'},weeklyPlanner:structuredClone(db),weeklyPlannerSelected:'area-0',weeklyPlannerBusy:false,weeklyPlannerProgress:null,weeklyPlannerManualRefreshRequest:null,weeklyPlannerDraftError:'',refreshes:0,confirm:()=>true,saveUiPrefs:()=>{},showInventoryToast:m=>messages.push(m),document:{getElementById:id=>id==='view'?{querySelectorAll:()=>buttons}:inputs[id],querySelectorAll:q=>q.includes(':checked')?selected:q==='[data-planner-section-status]'?[statusLabel]:q.startsWith('#view ')?buttons:[]}};
 c.bindPlannerEmployeePicker=()=>{};c.plannerSectionPeople=id=>c.weeklyPlanner.people.filter(p=>p.section_id===id);
 c.plannerSection=key=>c.weeklyPlanner.sections.find(s=>s.section_key===key);
 c.loadWeeklyPlanner=async()=>{c.refreshes++;c.weeklyPlanner=structuredClone(db);return true};
 c.sb={rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});if(c.fail===name)return {error:{message:'canceling statement due to statement timeout',code:'57014'}};
 if(name==='generate_weekly_planner')return {data:{week_start:args.p_week_start}};
 const s=db.sections.find(s=>s.section_id===args.p_section_id);
 if(name==='save_weekly_planner_section'){if(s.schedule_version!==args.p_expected_version)return {error:{message:'Weekly Planner version conflict; refresh before saving'}};s.schedule_version++;s.status='needs_review';s.crew_leader=args.p_crew_leader;db.people=db.people.filter(p=>p.section_id!==s.section_id).concat(args.p_people.map(p=>({section_id:s.section_id,employee_name:p.name})));return {data:structuredClone(s)}}
 if(name==='approve_weekly_planner_section'){assert.equal(args.p_expected_version,s.schedule_version);if(!s.crew_leader||!db.people.some(p=>p.section_id===s.section_id))return {error:{message:'Confirm the crew leader and assigned employees before approval'}};s.status='approved';return {data:structuredClone(s)}}
 if(name==='publish_weekly_planner_pack'){if(db.sections.filter(s=>s.status==='approved').length!==8)return {error:{message:'All eight sections must be approved and current before publishing'}};db.packs.push({pack_version:1});return {data:db.packs[0]}}
 throw Error(`Unexpected RPC ${name}`);
 }};
 vm.createContext(c);
 for(const name of ['htmlSafe','plannerStatus','plannerEmployeeNames','plannerSelectedEmployeeNames'])vm.runInContext(html.split(/\r?\n/).find(line=>line.startsWith(`function ${name}(`)),c);
 for(const [start,end] of [['async function weeklyPlannerRpc(','function plannerCaptureInputs('],['function plannerCaptureSection(','function plannerAddAssignment('],['function bindWeeklyPlanner(','function render(){']])vm.runInContext(html.slice(html.indexOf(start),html.indexOf(end)),c);
 c.bindWeeklyPlanner();return {c,calls,messages,inputs,selected,db,metadata,statusLabel,buttons,click:action=>buttons.find(b=>b.dataset.plannerAction===action).onclick()};
}
test('actual buttons generate Oct26, edit/select staff, save, approve eight sections, publish and reload',async()=>{
 const {c,click,db,calls,inputs}=setup();await click('generate');assert.equal(calls[0].args.p_week_start,'2026-10-26');
 for(let i=0;i<8;i++){c.weeklyPlannerSelected=`area-${i}`;inputs.plannerCrewLeader.value=`Synthetic Leader ${i}`;inputs.plannerCrewPeopleNew.value=`Synthetic Leader ${i}, Synthetic Worker ${i}`;await click('save-section');assert.equal(db.sections[i].status,'needs_review');await click('approve-section');assert.equal(db.sections[i].status,'approved');}
 await click('publish');assert.equal(c.weeklyPlanner.packs.length,1);assert.equal(calls.filter(x=>x.name==='approve_weekly_planner_section').length,8);
});
test('save timeout retains typed staff, displays durable explanation, does not approve or refresh; retry succeeds',async()=>{
 const {c,click,calls,inputs,db}=setup();inputs.plannerCrewPeopleNew.value='Synthetic New Worker';c.fail='save_weekly_planner_section';await click('approve-section');
 assert.equal(c.refreshes,0);assert.equal(calls.length,1);assert.match(inputs.plannerSectionFeedback.textContent,/on-screen edits are retained/);assert.equal(inputs.plannerCrewPeopleNew.value,'Synthetic New Worker');assert.equal(db.sections[0].schedule_version,1);
 c.fail='';await click('approve-section');assert.equal(db.sections[0].status,'approved');assert.equal(c.weeklyPlannerDraftError,'');
});
test('approval failure retains returned saved version for safe retry without discarding draft',async()=>{
 const {c,click,calls,db}=setup();c.fail='approve_weekly_planner_section';await click('approve-section');assert.equal(c.refreshes,0);assert.equal(c.plannerSection('area-0').schedule_version,2);assert.equal(db.sections[0].status,'needs_review');
 c.fail='';await click('approve-section');assert.equal(calls[2].args.p_expected_version,2);assert.equal(calls[3].args.p_expected_version,3);assert.equal(db.sections[0].status,'approved');
});
test('missing crew prerequisites explain what to enter before submitting any request',async()=>{
 for(const missing of ['leader','people']){const {click,inputs,selected,calls}=setup();if(missing==='leader')inputs.plannerCrewLeader.value='';else selected.length=0;await click('approve-section');assert.equal(calls.length,0);assert.match(inputs.plannerSectionFeedback.textContent,/enter a crew leader and select at least one employee/);}
});
test('busy double-click cannot duplicate a save or approve',async()=>{const {c,click,calls}=setup();c.weeklyPlannerBusy=true;await click('approve-section');await click('save-section');assert.equal(calls.length,0)});

test('confirmed save clears stale approved metadata while preserving the real form on rejected approval',async()=>{
 const {c,click,inputs,metadata,statusLabel}=setup();c.plannerSection('area-0').status='approved';inputs.plannerCrewPeopleNew.value='Retained typed worker';c.fail='approve_weekly_planner_section';
 await click('approve-section');assert.equal(c.refreshes,0);assert.equal(inputs.plannerCrewPeopleNew.value,'Retained typed worker');assert.match(metadata.innerHTML,/Version 2/);assert.match(metadata.innerHTML,/planner-status needs_review/);assert.doesNotMatch(metadata.innerHTML,/planner-status approved/);assert.equal(statusLabel.textContent,'needs review');
});
test('confirmed approval metadata remains correct when the subsequent snapshot refresh fails',async()=>{
 const {c,click,metadata,statusLabel}=setup();c.loadWeeklyPlanner=async()=>false;await click('approve-section');assert.match(metadata.innerHTML,/Version 2/);assert.match(metadata.innerHTML,/planner-status approved/);assert.equal(statusLabel.textContent,'approved');
});
test('section metadata completion does not replace a different section header or any typed inputs',async()=>{
 const {c,click,inputs,metadata,statusLabel}=setup();metadata.dataset.sectionId='different-section';metadata.innerHTML='Other section header';inputs.plannerCrewPeopleNew.value='Unsaved typed worker';c.fail='approve_weekly_planner_section';await click('approve-section');assert.equal(metadata.innerHTML,'Other section header');assert.equal(inputs.plannerCrewPeopleNew.value,'Unsaved typed worker');assert.equal(statusLabel.textContent,'needs review');
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('slow save and approval show durable distinct progress, block repeated actions, and retain input nodes',async()=>{
 const {c,click,calls,inputs,buttons,metadata}=setup(),pending=[];
 c.sb.rpc=(name,args)=>new Promise((resolve,reject)=>{calls.push({name,args});pending.push({resolve,reject})});
 let finishRefresh;c.loadWeeklyPlanner=()=>new Promise(resolve=>finishRefresh=resolve);
 const field=inputs.plannerCrewPeopleNew;field.value='Retained slow draft';const request=click('approve-section');
 assert.match(inputs.plannerSectionFeedback.textContent,/Saving your draft/);assert.equal(buttons.find(b=>b.dataset.plannerAction==='approve-section').textContent,'Saving…');assert.ok(buttons.every(b=>b.disabled));
 await click('save-section');await click('generate');assert.equal(calls.length,1);
 pending[0].resolve({data:{schedule_version:2,status:'needs_review'}});await settle();
 assert.equal(calls[1].name,'approve_weekly_planner_section');assert.match(inputs.plannerSectionFeedback.textContent,/Approval is in progress/);assert.match(metadata.innerHTML,/needs_review/);assert.equal(buttons.find(b=>b.dataset.plannerAction==='approve-section').textContent,'Approving…');
 await click('approve-section');assert.equal(calls.length,2);assert.equal(inputs.plannerCrewPeopleNew,field);assert.equal(field.value,'Retained slow draft');
 pending[1].resolve({data:{status:'approved'}});await settle();assert.match(inputs.plannerSectionFeedback.textContent,/Section approved.*Refreshing/);assert.ok(buttons.every(b=>b.disabled));
 finishRefresh(false);await request;assert.equal(c.weeklyPlannerProgress,null);assert.ok(buttons.every(b=>!b.disabled));assert.equal(buttons.find(b=>b.dataset.plannerAction==='approve-section').textContent,'Approve section');assert.match(inputs.plannerSectionFeedback.textContent,/saved and approved.*Refresh failed/);
});
test('lost approval response stops progress honestly and preserves inputs without retry',async()=>{
 const {c,click,inputs,buttons}=setup();c.sb.rpc=async name=>{if(name==='save_weekly_planner_section')return {data:{schedule_version:2,status:'needs_review'}};throw Error('lost response')};inputs.plannerCrewPeopleNew.value='Retained uncertain draft';
 await click('approve-section');assert.equal(c.weeklyPlannerProgress,null);assert.ok(buttons.every(b=>!b.disabled));assert.match(inputs.plannerSectionFeedback.textContent,/response was lost.*may have completed/);assert.equal(inputs.plannerCrewPeopleNew.value,'Retained uncertain draft');
});

test('old pending save cannot clear or unlock a replacement session progress owner',async()=>{
 let finish;const f=setup(),c=f.c;c.sb.rpc=()=>new Promise(resolve=>finish=resolve);
 const pending=c.plannerSaveSection(true);c.currentUser={id:'replacement'};c.hubSessionEpoch++;
 const newer={action:'approve-section',label:'Approving…',message:'Replacement session approval is in progress.'};
 c.weeklyPlannerProgress=newer;c.weeklyPlannerBusy=true;c.plannerUpdatePendingUI();
 finish({data:{schedule_version:2,status:'needs_review'}});assert.equal(await pending,false);
 assert.equal(c.weeklyPlannerProgress,newer);assert.equal(c.weeklyPlannerBusy,true);assert.ok(f.buttons.every(b=>b.disabled));assert.equal(f.inputs.plannerSectionFeedback.textContent,newer.message);
});
