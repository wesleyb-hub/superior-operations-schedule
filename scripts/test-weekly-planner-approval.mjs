// Synthetic button-handler integration; no production requests or credentials.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(){
 const calls=[],messages=[],buttons=['generate','save-section','approve-section','publish'].map(action=>({dataset:{plannerAction:action}}));
 const inputs={plannerCrewLeader:{value:'Synthetic Leader'},plannerCrewPeopleNew:{value:''},plannerSectionFeedback:{textContent:''}};
 const selected=[{value:'Synthetic Leader'}];
 const db={sections:Array.from({length:8},(_,i)=>({section_id:`synthetic-${i}`,section_key:`area-${i}`,schedule_version:1,status:'needs_review'})),people:[],permissions:{edit:true,approve:true,publish:true},packs:[]};
 const c={currentUser:{id:"synthetic"},hubSessionEpoch:0,Promise,Number,Map,console,state:{week:'2026-10-26',view:'weekly-planner'},weeklyPlanner:structuredClone(db),weeklyPlannerSelected:'area-0',weeklyPlannerBusy:false,weeklyPlannerDraftError:'',refreshes:0,confirm:()=>true,saveUiPrefs:()=>{},showInventoryToast:m=>messages.push(m),document:{getElementById:id=>id==='view'?{querySelectorAll:()=>buttons}:inputs[id],querySelectorAll:q=>q.includes(':checked')?selected:[]}};
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
 for(const name of ['plannerEmployeeNames','plannerSelectedEmployeeNames'])vm.runInContext(html.split(/\r?\n/).find(line=>line.startsWith(`function ${name}(`)),c);
 for(const [start,end] of [['async function weeklyPlannerRpc(','function plannerCaptureInputs('],['function plannerCaptureSection(','function plannerAddAssignment('],['function bindWeeklyPlanner(','function render(){']])vm.runInContext(html.slice(html.indexOf(start),html.indexOf(end)),c);
 c.bindWeeklyPlanner();return {c,calls,messages,inputs,selected,db,click:action=>buttons.find(b=>b.dataset.plannerAction===action).onclick()};
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
