// Synthetic button-handler integration; no production requests or credentials.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const html=readFileSync(process.env.PLANNER_SOURCE||new URL('../index.html',import.meta.url),'utf8');
function setup(){
 const calls=[],messages=[],buttons=['generate','save-section','approve-section','publish'].map(action=>({dataset:{plannerAction:action},disabled:false,textContent:action==='approve-section'?'Approve section':action==='save-section'?'Save section':action}));
 const classNode=(classes,textContent='')=>{const values=new Set(classes);return {textContent,classList:{remove:name=>values.delete(name),add:name=>values.add(name),contains:name=>values.has(name)}}};
 const approvedBadge=classNode(['planner-status','approved'],'Approved'),approvedCard=classNode(['planner-section-card','approved']),approvedCount={textContent:'8'};
 const unrelatedBadge=classNode(['planner-status','approved'],'Approved'),unrelatedCard=classNode(['planner-section-card','approved']),linkedBadge=classNode(['planner-status','approved'],'3 linked'),readinessTitle={textContent:'REAPPROVAL COMPLETE — NEW PACKET READY'},readinessDetail={textContent:'All eight sections are approved again.'};
 approvedCard.dataset={plannerSectionCard:'synthetic-0'};approvedCard.querySelector=()=>approvedBadge;unrelatedCard.dataset={plannerSectionCard:'synthetic-1'};unrelatedCard.querySelector=()=>unrelatedBadge;
 const inputs={plannerCrewLeader:{value:'Synthetic Leader'},plannerCrewPeopleNew:{value:''},plannerSectionFeedback:{textContent:''}};
 const selected=[{value:'Synthetic Leader'}];
 const metadata={dataset:{sectionId:'synthetic-0'},innerHTML:'Version 1 · APPROVED'},statusLabel={dataset:{plannerSectionStatus:'synthetic-0'},textContent:'approved'};inputs.plannerSectionMetadata=metadata;
 const db={sections:Array.from({length:8},(_,i)=>({section_id:`synthetic-${i}`,section_key:`area-${i}`,schedule_version:1,status:'needs_review'})),people:[],permissions:{edit:true,approve:true,publish:true},packs:[]};
 const c={currentUser:{id:"synthetic"},hubSessionEpoch:0,Promise,Number,Map,console,state:{week:'2026-10-26',view:'weekly-planner'},weeklyPlanner:structuredClone(db),weeklyPlannerSelected:'area-0',weeklyPlannerBusy:false,weeklyPlannerProgress:null,weeklyPlannerManualRefreshRequest:null,weeklyPlannerDraftError:'',refreshes:0,confirm:()=>true,saveUiPrefs:()=>{},showInventoryToast:m=>messages.push(m),document:{getElementById:id=>id==='view'?{querySelectorAll:()=>buttons}:inputs[id],querySelectorAll:q=>q.includes(':checked')?selected:q==='[data-planner-section-status]'?[statusLabel]:q==='#view .planner-status.approved'?[approvedBadge,unrelatedBadge,linkedBadge].filter(node=>node.classList.contains('approved')):q==='#view .planner-section-card.approved'?[approvedCard,unrelatedCard].filter(node=>node.classList.contains('approved')):q==='[data-planner-section-card]'?[approvedCard,unrelatedCard]:q==='[data-planner-readiness-title]'?[readinessTitle]:q==='[data-planner-readiness-detail]'?[readinessDetail]:q==='[data-planner-approved-count]'?[approvedCount]:q==='#view [data-planner-action=\"publish\"]'?buttons.filter(button=>button.dataset.plannerAction==='publish'):q.startsWith('#view [data-planner-action],')?buttons:[]}};
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
 vm.runInContext(html.slice(html.indexOf('function plannerRpcRequest('),html.indexOf('function plannerQueueSnapshot(')),c);
 for(const name of ['htmlSafe','plannerStatus','plannerEmployeeNames','plannerSelectedEmployeeNames','plannerCaptureInputs','plannerPublicationState'])vm.runInContext(html.split(/\r?\n/).find(line=>line.startsWith(`function ${name}(`)),c);
 for(const [start,end] of [['async function weeklyPlannerRpc(','function plannerCaptureInputs('],['function plannerCaptureSection(','function plannerAddAssignment('],['function bindWeeklyPlanner(','function render(){']])vm.runInContext(html.slice(html.indexOf(start),html.indexOf(end)),c);
 c.bindWeeklyPlanner();return {c,calls,messages,inputs,selected,db,metadata,statusLabel,buttons,approvedBadge,approvedCard,approvedCount,unrelatedBadge,unrelatedCard,linkedBadge,readinessTitle,readinessDetail,click:action=>buttons.find(b=>b.dataset.plannerAction===action).onclick()};
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
 await click('approve-section');assert.equal(c.weeklyPlannerProgress,null);assert.ok(buttons.filter(b=>b.dataset.plannerAction!=='publish').every(b=>!b.disabled));assert.equal(buttons.find(b=>b.dataset.plannerAction==='publish').disabled,true);assert.match(inputs.plannerSectionFeedback.textContent,/response was lost.*may have completed/);assert.equal(inputs.plannerCrewPeopleNew.value,'Retained uncertain draft');
});

test('old pending save cannot clear or unlock a replacement session progress owner',async()=>{
 let finish;const f=setup(),c=f.c;c.sb.rpc=()=>new Promise(resolve=>finish=resolve);
 const pending=c.plannerSaveSection(true);c.currentUser={id:'replacement'};c.hubSessionEpoch++;
 const newer={action:'approve-section',label:'Approving…',message:'Replacement session approval is in progress.'};
 c.weeklyPlannerProgress=newer;c.weeklyPlannerBusy=true;c.plannerUpdatePendingUI();
 finish({data:{schedule_version:2,status:'needs_review'}});assert.equal(await pending,false);
 assert.equal(c.weeklyPlannerProgress,newer);assert.equal(c.weeklyPlannerBusy,true);assert.ok(f.buttons.every(b=>b.disabled));assert.equal(f.inputs.plannerSectionFeedback.textContent,newer.message);
});

for(const [label,data] of [
 ['null',null],['missing',{}],['needs review',{status:'needs_review'}],
 ['reapproval required',{status:'reapproval_required'}],['unrecognized',{status:'APPROVED'}],
])test(`malformed ${label} approval response never reports or displays approval`,async()=>{
 const {c,click,calls,inputs,metadata,statusLabel,messages}=setup();
 const rpc=c.sb.rpc;c.sb.rpc=async(name,args)=>name==='approve_weekly_planner_section'?(calls.push({name,args}),{data}):rpc(name,args);
 inputs.plannerCrewPeopleNew.value='Retained unconfirmed approval';
 await click('approve-section');
 assert.equal(calls.length,2);assert.equal(c.refreshes,0);
 assert.equal(c.plannerSection('area-0').schedule_version,2);
 assert.equal(c.plannerSection('area-0').status,'needs_review');
 assert.match(metadata.innerHTML,/planner-status needs_review/);assert.doesNotMatch(metadata.innerHTML,/planner-status approved/);
 assert.equal(statusLabel.textContent,'needs review');assert.match(inputs.plannerSectionFeedback.textContent,/approval was not confirmed/);
 assert.equal(inputs.plannerCrewPeopleNew.value,'Retained unconfirmed approval');
 assert.ok(!messages.some(message=>/Section (?:saved and )?approved\./.test(message)));
});

for(const [label,version] of [
 ['missing',undefined],['null',null],['zero',0],['negative',-1],['fraction',1.5],
 ['infinity',Infinity],['NaN',NaN],['unsafe integer',Number.MAX_SAFE_INTEGER+1],['boolean',true],['string','2'],
])test(`invalid ${label} saved version cannot issue an approval or update the displayed version`,async()=>{
 const {c,click,calls,inputs}=setup();
 c.sb.rpc=async(name,args)=>{calls.push({name,args});return {data:{schedule_version:version,status:'needs_review'}}};
 await click('approve-section');
 assert.equal(calls.length,1);assert.equal(calls[0].name,'save_weekly_planner_section');assert.equal(c.refreshes,0);
 assert.equal(c.plannerSection('area-0').schedule_version,1);assert.notEqual(c.plannerSection('area-0').status,'approved');
 assert.match(inputs.plannerSectionFeedback.textContent,/valid new version was not returned/);
});

test('save response cannot display approved before a separate approval is confirmed',async()=>{
 const {c,calls,metadata,statusLabel}=setup();let finishApproval;
 c.sb.rpc=(name,args)=>{calls.push({name,args});return name==='save_weekly_planner_section'?Promise.resolve({data:{schedule_version:2,status:'approved'}}):new Promise(resolve=>finishApproval=resolve)};
 const request=c.plannerSaveSection(true);await settle();
 assert.equal(calls.length,2);assert.equal(c.plannerSection('area-0').status,'needs_review');
 assert.doesNotMatch(metadata.innerHTML,/planner-status approved/);assert.equal(statusLabel.textContent,'needs review');
 finishApproval({data:null});assert.equal(await request,false);assert.equal(c.plannerSection('area-0').status,'needs_review');
});


test('malformed saved version clears obsolete approved badge even when new version cannot be confirmed',async()=>{
 const {c,click,metadata,statusLabel}=setup();c.plannerSection('area-0').status='approved';
 c.sb.rpc=async()=>({data:{schedule_version:null,status:'approved'}});
 await click('approve-section');assert.equal(c.plannerSection('area-0').schedule_version,1);assert.equal(c.plannerSection('area-0').status,'needs_review');
 assert.doesNotMatch(metadata.innerHTML,/planner-status approved/);assert.equal(statusLabel.textContent,'needs review');assert.equal(c.refreshes,0);
});

const uncertainResponses=[
 ['status 0',{status:0,error:{message:'Failed to fetch',code:''}}],
 ['gateway 502',{status:502,error:{message:'Bad Gateway',code:''}}],
 ['gateway 504',{status:504,error:{message:'Gateway Timeout',code:''}}],
 ['gateway 544',{status:544,error:{message:'Gateway timeout',code:''}}],
 ['SQL 08007',{status:500,error:{message:'transaction resolution unknown',code:'08007'}}],
 ['SQL 40003',{status:500,error:{message:'statement completion unknown',code:'40003'}}],
];
for(const [label,response]of uncertainResponses)for(const phase of ['save','approval'])test(`uncertain ${phase} ${label} retains draft/version, marks approval unverified, and never retries`,async()=>{
 const f=setup(),{c,calls,inputs,metadata,statusLabel,buttons}=f;for(const section of c.weeklyPlanner.sections)section.status='approved';
 const field=inputs.plannerCrewPeopleNew;field.value='Retained uncertainty draft';
 c.sb.rpc=async(name,args)=>{calls.push({name,args});return name==='save_weekly_planner_section'&&phase==='approval'?{data:{schedule_version:2,status:'needs_review'}}:structuredClone(response)};
 assert.equal(await c.plannerSaveSection(true),false);await settle();await settle();
 assert.equal(calls.length,phase==='save'?1:2);assert.equal(c.refreshes,0);assert.equal(c.plannerSection('area-0').status,'approval_unverified');assert.equal(c.plannerSection('area-0').schedule_version,phase==='save'?1:2);
 assert.equal(inputs.plannerCrewPeopleNew,field);assert.equal(field.value,'Retained uncertainty draft');assert.match(metadata.innerHTML,/planner-status approval_unverified/);assert.doesNotMatch(metadata.innerHTML,/planner-status approved/);assert.equal(statusLabel.textContent,'approval unverified');
 assert.match(inputs.plannerSectionFeedback.textContent,/response was lost.*may have completed.*Refresh and verify.*No automatic retry/);assert.doesNotMatch(inputs.plannerSectionFeedback.textContent,/Try Save section again/);
 assert.equal(buttons.find(button=>button.dataset.plannerAction==='publish').disabled,true);
 assert.equal(f.unrelatedBadge.textContent,'Approved');assert.equal(f.unrelatedBadge.classList.contains('approved'),true);assert.equal(f.unrelatedCard.classList.contains('approved'),true);assert.equal(c.plannerSection('area-1').status,'approved');assert.equal(f.linkedBadge.textContent,'3 linked');assert.equal(f.linkedBadge.classList.contains('approved'),true);assert.equal(f.readinessTitle.textContent,'APPROVAL UNVERIFIED');assert.match(f.readinessDetail.textContent,/Refresh and verify before publishing/);
});

for(const [code,status]of [['57014',500],['P0001',400],['PGRST003',504]])test(`definitive ${code} save rejection does not become an uncertain commit`,async()=>{
 const {c,calls,inputs}=setup();c.plannerSection('area-0').status='approved';
 c.sb.rpc=async(name,args)=>{calls.push({name,args});return {status,error:{code,message:`Definitive ${code}`}}};
 assert.equal(await c.plannerSaveSection(true),false);assert.equal(calls.length,1);assert.equal(c.refreshes,0);assert.equal(c.plannerSection('area-0').status,'approved');
 assert.match(inputs.plannerSectionFeedback.textContent,new RegExp(`Definitive ${code}`));assert.doesNotMatch(inputs.plannerSectionFeedback.textContent,/response was lost|outcome unknown/);
});

for(const name of ['generate_weekly_planner','save_weekly_planner_inputs'])test(`uncertain ${name} neutralizes approval badges, cards, count and stale publish handler without rerender`,async()=>{
 const f=setup(),{c,calls,inputs,approvedBadge,approvedCard,approvedCount,buttons,click}=f;for(const section of c.weeklyPlanner.sections)section.status='approved';
 const field=inputs.plannerCrewPeopleNew;field.value='Retained generic draft';c.sb.rpc=async(rpc,args)=>{calls.push({name:rpc,args});return {status:0,error:{message:'Failed to fetch',code:''}}};
 assert.equal(await c.weeklyPlannerRpc(name,{},'Saved'),false);await settle();assert.equal(calls.length,1);assert.equal(c.refreshes,0);
 assert.ok(c.weeklyPlanner.sections.every(section=>section.status==='approval_unverified'));assert.equal(approvedBadge.classList.contains('approved'),false);assert.equal(approvedBadge.classList.contains('approval_unverified'),true);assert.equal(approvedBadge.textContent,'Approval unverified');assert.equal(approvedCard.classList.contains('approved'),false);assert.equal(approvedCount.textContent,'0');assert.equal(f.linkedBadge.textContent,'3 linked');assert.equal(f.linkedBadge.classList.contains('approved'),true);assert.equal(f.readinessTitle.textContent,'APPROVAL UNVERIFIED');assert.match(f.readinessDetail.textContent,/Refresh and verify before publishing/);
 assert.equal(inputs.plannerCrewPeopleNew,field);assert.equal(field.value,'Retained generic draft');assert.equal(buttons.find(button=>button.dataset.plannerAction==='publish').disabled,true);
 assert.match(inputs.plannerSectionFeedback.textContent,/outcome unknown.*Refresh and verify.*no automatic retry/);
 await click('publish');assert.equal(calls.length,1,'even a saved stale click handler cannot publish an unverified local snapshot');
});

test('uncertain packet publication retains section approvals and directs verification to packet history',async()=>{
 const {c,calls,inputs,buttons,click}=setup();for(const section of c.weeklyPlanner.sections)section.status='approved';
 c.sb.rpc=async(name,args)=>{calls.push({name,args});return {status:504,error:{message:'Gateway timeout',code:''}}};
 assert.equal(await c.weeklyPlannerRpc('publish_weekly_planner_pack',{},'Published'),false);await settle();assert.equal(calls.length,1);assert.equal(c.refreshes,0);assert.ok(c.weeklyPlanner.sections.every(section=>section.status==='approved'));
 assert.match(inputs.plannerSectionFeedback.textContent,/Packet publication outcome unknown.*check packet history.*no automatic retry/);
 assert.equal(c.plannerPublishVerificationRequired(),true);assert.equal(buttons.find(button=>button.dataset.plannerAction==='publish').disabled,true);
 c.weeklyPlanner.week={source_stale:false};assert.equal(c.plannerPublicationState(c.weeklyPlanner).canPublish,false);
 await click('publish');assert.equal(await c.weeklyPlannerRpc('publish_weekly_planner_pack',{},'Published'),false);assert.equal(calls.length,1);
 c.currentUser={id:'synthetic'};assert.equal(c.plannerPublishVerificationRequired(),true,'same identity remains latched across a replacement login object');assert.equal(await c.weeklyPlannerRpc('publish_weekly_planner_pack',{},'Published'),false);assert.equal(calls.length,1);
});


test('uncertain section replaces an old packet-ready header and remains unverified on later actual header render',async()=>{
 const {c,calls,readinessTitle}=setup();for(const section of c.weeklyPlanner.sections)section.status='approved';c.weeklyPlanner.week={status:'reapproval_required',week_end:'2026-10-30',source_stale:false};
 Object.assign(c,{plannerTabs:()=>'',plannerDateLabel:String,addDays:()=>''});vm.runInContext(html.slice(html.indexOf('function plannerHeader('),html.indexOf('function plannerDashboard(')),c);
 assert.match(c.plannerHeader(),/REAPPROVAL COMPLETE — NEW PACKET READY/);
 c.sb.rpc=async(name,args)=>{calls.push({name,args});return {status:0,error:{message:'Failed to fetch',code:''}}};assert.equal(await c.plannerSaveSection(true),false);
 assert.equal(readinessTitle.textContent,'APPROVAL UNVERIFIED');assert.match(c.plannerHeader(),/APPROVAL UNVERIFIED/);assert.doesNotMatch(c.plannerHeader(),/NEW PACKET READY|All eight sections are approved again/);
});

test('actual Save inputs locks submitted source fields and preserves typed nodes and prior-disabled state on uncertainty',async()=>{
 const f=setup(),{c,calls,buttons}=f;
 const employee={value:'Retained Availability Draft',disabled:false},resource={value:'Retained Crane Draft',disabled:false},locked={value:'Restricted field',disabled:true};
 const original=c.document.querySelectorAll;c.document.querySelectorAll=q=>q==='[data-planner-availability]'?[{querySelector:field=>field.includes('employee_name')?employee:null}]:q==='[data-planner-resource]'?[{querySelector:field=>field.includes('resource_name')?resource:field.includes('project_location')?locked:null}]:q.startsWith('#view [data-planner-action],')?[...original(q),...(q.includes('[data-planner-availability]')?[employee]:[]),...(q.includes('[data-planner-resource]')?[resource,locked]:[])]:original(q);
 buttons.push({dataset:{plannerAction:'save-inputs'},disabled:false,textContent:'Save inputs'});c.bindWeeklyPlanner();let finish;
 c.sb.rpc=(name,args)=>new Promise(resolve=>{calls.push({name,args});finish=resolve});const request=f.click('save-inputs');
 assert.equal(calls.length,1);assert.equal(calls[0].args.p_availability[0].employee_name,employee.value);assert.equal(calls[0].args.p_resources[0].resource_name,resource.value);assert.equal(employee.disabled,true);assert.equal(resource.disabled,true);assert.equal(locked.disabled,true);
 finish({status:0,error:{message:'Failed to fetch',code:''}});await request;
 assert.equal(employee.disabled,false);assert.equal(resource.disabled,false);assert.equal(locked.disabled,true);assert.equal(employee.value,'Retained Availability Draft');assert.equal(resource.value,'Retained Crane Draft');assert.equal(c.refreshes,0);assert.equal(calls.length,1);
 assert.equal(c.document.querySelectorAll('[data-planner-availability]')[0].querySelector('[data-field="employee_name"]'),employee);assert.equal(c.document.querySelectorAll('[data-planner-resource]')[0].querySelector('[data-field="resource_name"]'),resource);
});

test('unknown current-week mutation marks active packet activation unverified without changing packet data or other labels',async()=>{
 const {c,calls}=setup(),current={dataset:{plannerPackActivation:'2026-10-26',plannerPackActive:'true'},textContent:'ACTIVE'},other={dataset:{plannerPackActivation:'2026-10-19',plannerPackActive:'true'},textContent:'ACTIVE'},inactive={dataset:{plannerPackActivation:'2026-10-26',plannerPackActive:'false'},textContent:'INACTIVE · retained for history'};
 const original=c.document.querySelectorAll;c.document.querySelectorAll=q=>q==='[data-planner-pack-activation]'?[current,other,inactive]:original(q);
 for(const section of c.weeklyPlanner.sections)section.status='approved';c.weeklyPlanner.week={status:'approved'};c.weeklyPlanner.recent_packs=[{pack_id:'current',week_start:'2026-10-26',is_active:true,pack_version:2,published_at:'2026-10-22T12:00:00Z',published_by_email:'synthetic@example.invalid'},{pack_id:'other',week_start:'2026-10-19',is_active:true,pack_version:1},{pack_id:'inactive',week_start:'2026-10-26',is_active:false,pack_version:1}];
 const before=structuredClone(c.weeklyPlanner.recent_packs);c.plannerDateLabel=String;vm.runInContext(html.slice(html.indexOf('function plannerPublicationState('),html.indexOf('function renderWeeklyPlanner(')),c);
 assert.doesNotMatch(c.plannerPacks(),/Activation unverified/);c.sb.rpc=async(name,args)=>{calls.push({name,args});return {status:0,error:{message:'Failed to fetch',code:''}}};assert.equal(await c.plannerSaveSection(true),false);
 assert.equal(current.textContent,'Activation unverified — refresh to verify');assert.equal(other.textContent,'ACTIVE');assert.equal(inactive.textContent,'INACTIVE · retained for history');assert.equal(current.dataset.plannerPackActive,'true');assert.deepEqual(c.weeklyPlanner.recent_packs,before);
 const rendered=c.plannerPacks();assert.equal((rendered.match(/Activation unverified — refresh to verify/g)||[]).length,1);assert.match(rendered,/data-planner-pack-activation="2026-10-19" data-planner-pack-active="true">ACTIVE/);assert.match(rendered,/data-planner-pack-activation="2026-10-26" data-planner-pack-active="false">INACTIVE · retained for history/);assert.deepEqual(c.weeklyPlanner.recent_packs,before);assert.equal(calls.length,1);
});
