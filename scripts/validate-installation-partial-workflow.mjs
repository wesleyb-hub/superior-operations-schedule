// Prepared by Scout
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase','migrations','20261018_022_walls_installation_partial_scope.sql'),'utf8');
const statusMigration=fs.readFileSync(path.join(root,'supabase','migrations','20261018_023_walls_installation_partial_status.sql'),'utf8');
const plannerMigration=fs.readFileSync(path.join(root,'supabase','migrations','20261018_025_weekly_planner_partial_run_scope.sql'),'utf8');
const resourceStatusMigration=fs.readFileSync(path.join(root,'supabase','migrations','20261019152227_normalize_installation_resource_status_defaults.sql'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const previous=fs.readFileSync(path.join(root,'supabase','migrations','20261017173729_walls_delivery_qc_status_transition_only_20261017.sql'),'utf8');
const checks=[
  ['A: delivery validates the explicitly mapped assignment set',/from public\.walls_installation_load_assignments m[\s\S]*where m\.load_record_id=new\.record_id and a\.wall_record_id=v_link_id/.test(migration)],
  ['B: selected shipment runs require stripped stage and final QC release',/count\(\*\) filter\(where a\.stage='stripped' and q\.status='released'\)/.test(migration)],
  ['B: open assignment holds on selected shipment runs block release',/i\.assignment_id is null or exists\(select 1 from public\.walls_installation_load_assignments/.test(migration)],
  ['C: installation scope requires a Delivered load',/p_activity_type='loading_hauling' or l\.data->>'status'='Delivered'/.test(migration)],
  ['C: loading and installation require an explicit mapped activity scope',/Select explicitly released production assignments/.test(migration)&&/walls_installation_activity_assignments where activity_id=p_activity_id/.test(migration)],
  ['D: activity scope is exact to assignment and load',/foreign key \(load_record_id, assignment_id\)[\s\S]*references public\.walls_installation_load_assignments\(load_record_id, assignment_id\)/.test(migration)],
  ['E: field completion requires every active production assignment installed',/not exists\(select 1 from public\.walls_production_assignments a where a\.wall_record_id=p_wall_record_id and a\.stage<>'cancelled'\)[\s\S]*not exists\(select 1 from public\.walls_installation_activity_assignments m/.test(migration)],
  ['E: derived dashboard status does not call a partial install complete',/not exists\(select 1 from public\.walls_production_assignments p where p\.wall_record_id=r\.record_id and p\.stage<>'cancelled'[\s\S]*Installation Complete/.test(statusMigration)],
  ['F: site and stone activities are excluded from the QC-gated set',/p_activity_type in \('loading_hauling','wall_installation'\)/.test(migration)&&!/p_activity_type in \('loading_hauling','wall_installation','field_closeout'\)/.test(migration)],
  ['G: absent or invalid scope fails closed',/Select at least one run and its linked load/.test(html)&&/Select explicitly released production assignments/.test(migration)],
  ['H: shipment release validation remains transition-only',/v_new_status in \('Loaded','Delivered'\)[\s\S]*v_old_status is distinct from v_new_status/.test(previous)],
  ['I: schedule date edits do not create a new load release transition',/v_new_status in \('Loaded','Delivered'\)[\s\S]*v_old_status is distinct from v_new_status/.test(migration)],
  ['J: concurrent activity-scope updates use row lock and version checking',/where activity_id=p_activity_id for update[\s\S]*v_activity\.version<>p_expected_version/.test(migration)],
  ['J: activity writes retain optimistic concurrency checks',/if v_row\.version<>p_expected_version then raise exception 'Installation activity changed; refresh and retry'/.test(migration)],
  ['Permissions: new scope RPC is management-gated and not public/anon callable',/walls_installation_permission\('manage'\)/.test(migration)&&/revoke all on function public\.set_walls_installation_activity_assignments\(uuid,bigint,jsonb\) from public,anon/.test(migration)],
  ['Resource saves convert empty availability/readiness to the safe unconfirmed state',/coalesce\(nullif\(btrim\(v_item->>'availability_status'\),''\),'unconfirmed'\)/.test(resourceStatusMigration)&&/coalesce\(nullif\(btrim\(v_item->>'readiness_status'\),''\),'unconfirmed'\)/.test(resourceStatusMigration)],
  ['UI: new job workspace includes required linked records and history',/\['overview','Overview'\][\s\S]*\['production','Production & Loads'\][\s\S]*\['history','History'\]/.test(html)],
  ['UI: Today is job-first with explicit next action and actual activity-based stages',/function installationJobCompactCard/.test(html)&&/function installationJobStageStatus/.test(html)&&/Next action/.test(html)&&/fieldJobs\.map\(j=>installationJobCompactCard\(j,day\)\)/.test(html)],
  ['UI: Update Progress opens the same job workspace at Field Activities',/data-install-update-job/.test(html)&&/openInstallationJobWorkspace\(b\.dataset\.installUpdateJob,'activities'\)/.test(html)],
  ['UI: Field Activities workspace short-circuits full resource aggregation and uses bounded lightweight rows',html.includes("installationWorkspacePanel=function(job,tab,events=[]){return tab==='activities'?installationWorkspaceActivityRows(job):installationWorkspacePanelFull(job,tab,events)}")&&html.includes('function installationWorkspaceActivityRows(job)')&&html.includes('visibleActivities=activities.slice(0,100)')&&html.includes('data-install-edit-activity=')&&html.includes('data-install-edit-resources=')&&!html.includes('activities.map(a=>installationWorkspaceActivityCard(job,a))')],
  ['Performance: Weekly Planner and all-year Installation snapshots are excluded from sign-in bootstrap',/subscribeLive\(\);await Promise\.all\(\[loadInventory\(\),loadWallsProduction\(\)\]\)/.test(html)&&!/Promise\.all\(\[loadInventory\(\),loadWallsProduction\(\),loadWeeklyPlanner\(\)\]\)/.test(html)&&!/Promise\.all\(\[loadInventory\(\),loadWallsProduction\(\),loadWallsInstallation\(\)\]\)/.test(html)],
  ['Performance: Installation data loads on demand, coalesces in-flight requests, and refreshes only while visible',/function ensureWallsInstallationLoaded\(force=false\)[\s\S]*?if\(wallsInstallationLoadPromise\)\{if\(force\)wallsInstallationReloadQueued=true;return wallsInstallationLoadPromise\}[\s\S]*?const request=loadWallsInstallation\(\)/.test(html)&&/function setView\(v\)[^\n]*ensureWallsInstallationLoaded\(true\)/.test(html)&&/function setSubview\(div,v\)[^\n]*ensureWallsInstallationLoaded\(true\)/.test(html)&&/wallsInstallationReloadTimer=setTimeout\(\(\)=>ensureWallsInstallationLoaded\(true\),500\)/.test(html)&&html.includes("state.view==='walls'&&state.subview.walls==='installation'")],
  ['Performance: all-horizon resource-conflict analysis is deferred until the Resources tab is opened',/wallsInstallation=\{permissions:\{\},jobs:\[\],resource_conflicts:null,\.\.\.\(data\|\|\{\}\),resource_conflicts:null\};wallsInstallationReady=true/.test(html)&&/conflicts=Array\.isArray\(wallsInstallation\.resource_conflicts\)\?wallsInstallation\.resource_conflicts:\(wallsInstallation\.resource_conflicts=installationResourceConflicts\(wallsInstallation\.jobs\)\)/.test(html)],
  ['UI: installation job workspace gets a full-width modal layout and nonshrinking tabs',/modalBody\.classList\.toggle\('install-job-modal-body',body\.includes\('class="install-job-tabs"'\)\)/.test(html)&&/\.modal-body\.install-job-modal-body\{display:block\}/.test(html)&&/\.install-job-tabs button\{white-space:nowrap;flex:0 0 auto;min-height:38px\}/.test(html)],
  ['UI: compact installation job cards adapt to phone-sized screens',/\.install-job-card\{[\s\S]*\.install-job-progress\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(html)],
['UI: week view avoids preparing Today and Resources aggregates',/fieldJobs=v==='today'\?jobs\.filter/.test(html)&&/upcoming=v==='today'\?jobs\.filter/.test(html)&&/activities=v==='resources'\?jobs\.flatMap/.test(html)],
  ['UI: weekly installation board groups existing jobs and catch-up cards by day',/function renderInstallationJobWeek\(jobs,dates,activities,cards,canManage\)[\s\S]*?byDate=new Map\(dates\.map/.test(html)&&/renderInstallationJobWeek\(jobs,dates,null,catchupCards,canManage\)/.test(html)&&/install-flow/.test(html)&&/data-catchup-add-day/.test(html)],
  ['UI: Today field-work board combines jobs and active catch-up cards before showing the empty state',html.includes('function installationTodayFieldWorkContent(jobs,day,cards,canManage)')&&html.includes("cards.filter(card=>card.work_date===day&&card.status!=='cancelled')")&&html.includes('...jobs.map(job=>installationJobCompactCard(job,day)),...activeCards.map(installationDayCardHtml)')&&html.includes("const boardContent=fieldWork.cardsMarkup||'<div class=\"production-empty\">")&&html.includes('body.slice(0,boardStart)+fieldWork.addCardMarkup')&&html.includes('bindInstallationCatchupControls()')],
  ['UI: Installation KPI cards use a readable three-column desktop layout and two-column mobile layout',/installation-kpis\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/.test(html)&&/@media\(max-width:760px\)[\s\S]*#view \.installation-kpis\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(html)&&/production-kpis installation-kpis/.test(html)],
  ['UI: Today field-hold KPI counts jobs with on-hold activities or open hold issues',/function installationFieldHoldCount\(jobs,day\)/.test(html)&&/fieldHolds=installationFieldHoldCount\(fieldJobs,day\)/.test(html)&&/Jobs on hold \/ restricted/.test(html)],
  ['UI: job workspace overview de-duplicates resource names across multiple activities',html.includes("resourceSummary=[...new Map(resources.map(r=>[`${r.resource_type}|${String(r.resource_name||'').toLowerCase()}`,r.resource_name]).filter(([key,name])=>name)).values()]")&&/Resources:<\/strong> \$\{resourceSummary\.length/.test(html)],
  ['UI: job progress stages wrap status below labels instead of compressing across five narrow columns',/\.install-job-progress\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)/.test(html)&&/\.install-stage\{display:grid;grid-template-columns:9px minmax\(0,1fr\)/.test(html)&&/\.install-stage small\{display:block;grid-column:2;margin:0/.test(html)],
  ['UI: weekly board retains a responsive five-day flow',/\.install-flow\{display:grid;grid-template-columns:repeat\(5,minmax\(180px,1fr\)\)/.test(html)&&/\.install-day\{/.test(html)],
  ['UI: issue, resolution, and resource status use in-app forms',/function openWallsInstallationIssueForm/.test(html)&&/function openWallsInstallationResolveForm/.test(html)&&/function openWallsInstallationResourceStatusForm/.test(html)],
  ['UI: employee and equipment assignments use selectors with an explicit add-name fallback',/function installationResourceNameChoices/.test(html)&&/data-resource-choice/.test(html)&&/Add a name not listed/.test(html)&&/data-resource-custom/.test(html)],
  ['UI: scope updates refresh across connected clients',/walls_installation_activity_assignments','walls_installation_resources/.test(html)&&/activity_id,assignment_id,load_record_id/.test(html)],
  ['UI: superseded activity-first renderer, modal, and binder are removed',!/function renderWallsInstallation\(/.test(html)&&!/function bindWallsInstallationControls\(/.test(html)&&!/function openWallsInstallationActivityModal\(/.test(html)&&/function renderWallsInstallationEnhanced\(/.test(html)],
  ['UI: held scope remains fixed and Resume re-enters in-progress state',/scope\.required&&canManage&&status==='planned'/.test(html)&&/data-install-status="\$\{a\.activity_id\}\|in_progress">Resume/.test(html)],
  ['UI: only unstarted, unscoped planned activities expose a delete action',/function installationActivityCanBeRemoved\(activity\)\{return Boolean\(activity&&activity\.status==='planned'&&!\(activity\.production_scope\|\|\[\]\)\.length\)\}/.test(html)&&/canRemove=canManage&&installationActivityCanBeRemoved\(a\)/.test(html)&&/data-install-cancel-activity/.test(html)],
  ['UI: removal requires a reason, preserves the row as cancelled, and uses version checking',/Reason for removing this activity/.test(html)&&/p_status:'cancelled'/.test(html)&&/p_expected_version:activity\.version/.test(html)&&/status<>'cancelled'/.test(fs.readFileSync(path.join(root,'supabase','migrations','20261016_017_walls_installation_execution.sql'),'utf8'))],
  ['UI: Resources board labels held work separately from planned work',html.includes("x._activity.status==='on_hold'")&&html.includes("installationStatusLabel(x._activity.status)")],
  ['Weekly Planner receives the explicit production run scope',/Runs: '\|\|string_agg\('Table '\|\|p\.table_id/.test(plannerMigration)],
];
const failures=checks.filter(([,ok])=>!ok);

const dayCardCancelStart=html.indexOf('function installationDayCardCanBeCancelled');
const dayCardCancelEnd=html.indexOf('\nfunction installationDayCardHtml',dayCardCancelStart);
if(dayCardCancelStart<0||dayCardCancelEnd<0){console.log('FAIL: day-card cancellation helper is extractable');process.exitCode=1}else{
  const canCancel=new Function(`${html.slice(dayCardCancelStart,dayCardCancelEnd)};return installationDayCardCanBeCancelled`)();
  const dayCardChecks=[
    ['planned-only card can be cancelled',canCancel({tasks:[{status:'planned'}]})],
    ['card with in-progress task cannot be cancelled',!canCancel({tasks:[{status:'in_progress'}]})],
    ['card with completed task cannot be cancelled',!canCancel({tasks:[{status:'completed'}]})],
  ];
  for(const [label,ok]of dayCardChecks)console.log(`${ok?'PASS':'FAIL'}: behavior — ${label}`);
  if(dayCardChecks.some(([,ok])=>!ok))process.exitCode=1
}
for(const [label,ok] of checks)console.log(`${ok?'PASS':'FAIL'}: ${label}`);

const stageStart=html.indexOf('function installationJobStageStatus');
const compactStart=html.indexOf('function installationJobCompactCard',stageStart);
if(stageStart<0||compactStart<0){console.log('FAIL: job-progress helpers are extractable for behavior tests');process.exitCode=1}else{
  const helpers=new Function('normalizeDate',`${html.slice(stageStart,compactStart)};return{installationJobStageStatus,installationJobNextAction,installationFieldHoldCount}`)(value=>value||null);
  const job=(activities=[],extra={})=>({activities,issues:[],job:{},installation:{},...extra});
  const behaviorChecks=[
    ['past scheduled date alone does not mark site work complete',helpers.installationJobStageStatus(job([]),'site_preparation')==='not_started'],
    ['scheduled activity remains scheduled, not complete',helpers.installationJobStageStatus(job([{activity_type:'stone_footing',status:'planned',activity_date:'2026-10-12'}]),'stone_footing')==='scheduled'],
    ['in-progress activity reflects real progress',helpers.installationJobStageStatus(job([{activity_type:'wall_installation',status:'in_progress'}]),'wall_installation')==='in_progress'],
    ['completed activity is complete from its recorded status',helpers.installationJobStageStatus(job([{activity_type:'stone_footing',status:'completed'}]),'stone_footing')==='complete'],
    ['partial multi-day work remains in progress while another activity is active',helpers.installationJobStageStatus(job([{activity_type:'wall_installation',status:'completed'},{activity_type:'wall_installation',status:'in_progress'}]),'wall_installation')==='in_progress'],
    ['open field issue becomes the explicit next action',helpers.installationJobNextAction({...job(),issues:[{status:'open',severity:'hold'}]}).startsWith('Resolve 1 open field issue')],
    ['on-hold work takes priority over another planned activity',helpers.installationJobNextAction(job([{activity_type:'stone_footing',status:'planned',activity_date:'2026-10-19'},{activity_type:'stone_footing',status:'on_hold',activity_date:'2026-10-19'}])).startsWith('Review on-hold activity before dispatch')],
    ['changed master schedule is reviewed before field activity proceeds',helpers.installationJobNextAction({...job([{activity_type:'stone_footing',status:'planned'}]),installation:{needs_review:true}})==='Review field plan after master schedule change'],
    ['planned activity prompts resource confirmation before start',helpers.installationJobNextAction(job([{activity_type:'stone_footing',status:'planned',activity_date:'2026-10-20'}])).startsWith('Confirm resources')],
    ['field-hold KPI counts one job once across multiple held activities',helpers.installationFieldHoldCount([{activities:[{activity_date:'2026-10-19',status:'on_hold'},{activity_date:'2026-10-19',status:'on_hold'}],issues:[]}],'2026-10-19')===1],
    ['field-hold KPI counts a job with an open hold issue',helpers.installationFieldHoldCount([{activities:[],issues:[{status:'open',severity:'hold'}]}],'2026-10-19')===1],
  ];
  for(const [label,ok]of behaviorChecks)console.log(`${ok?'PASS':'FAIL'}: behavior — ${label}`);
  if(behaviorChecks.some(([,ok])=>!ok))process.exitCode=1;
}
const todayContentStart=html.indexOf('function installationTodayFieldWorkContent');
const todayContentEnd=html.indexOf('\nfunction renderInstallationJobWeek',todayContentStart);
if(todayContentStart<0||todayContentEnd<0){console.log('FAIL: Today field-work board helper is extractable for behavior tests');process.exitCode=1}else{
  const makeTodayContent=new Function('installationJobCompactCard','installationDayCardHtml','renderInstallationCatchupToday',`${html.slice(todayContentStart,todayContentEnd)};return installationTodayFieldWorkContent`);
  const todayContent=makeTodayContent(job=>`<job:${job.id}>`,card=>`<catchup:${card.title}>`,()=>'<button>Add catch-up</button>');
  const active={work_date:'2026-10-19',status:'planned',title:'Geo Foam'},cancelled={work_date:'2026-10-19',status:'cancelled',title:'Duplicate'};
  const populated=todayContent([],'2026-10-19',[active,cancelled],true);
  const regularJob=todayContent([{id:'2912'}],'2026-10-19',[active],true);
  const empty=todayContent([],'2026-10-19',[cancelled],true);
  const todayChecks=[
    ['active catch-up task appears on Today when no job-linked field activity exists',populated.hasWork&&populated.cardsMarkup==='<catchup:Geo Foam>'],
    ['cancelled catch-up card is excluded from Today',!populated.cardsMarkup.includes('Duplicate')],
    ['job-linked work and catch-up cards appear together',regularJob.cardsMarkup==='<job:2912><catchup:Geo Foam>'],
    ['only cancelled cards leave Today in its no-field-work state',!empty.hasWork&&empty.cardsMarkup===''],
    ['manager retains catch-up add control alongside field-work board',populated.addCardMarkup.includes('Add catch-up')],
  ];
  for(const [label,ok]of todayChecks)console.log(`${ok?'PASS':'FAIL'}: behavior — ${label}`);
  if(todayChecks.some(([,ok])=>!ok))process.exitCode=1;
}
const resourceStart=html.indexOf('function installationResourceNameChoices');
const resourceEnd=html.indexOf('function installationResourceRowsHtml',resourceStart);
if(resourceStart<0||resourceEnd<0){console.log('FAIL: resource selector helpers are extractable for behavior tests');process.exitCode=1}else{
  const resourceHelpers=new Function('wallsInstallation','weeklyPlanner','installResources','htmlSafe',`${html.slice(resourceStart,resourceEnd)};return{installationResourceNameChoices,installationResourceRowHtml}`)(
    {jobs:[{activities:[{resources:[{resource_type:'crane',resource_name:'Crane 1'},{resource_type:'employee',resource_name:'Taylor'}]}]}]},
    {availability:[{employee_name:'Taylor'},{employee_name:'Jordan'}],resources:[{resource_name:'Truck 2'}]},
    a=>a.resources||[],s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  );
  const employees=resourceHelpers.installationResourceRowHtml({resource_type:'employee'}),equipment=resourceHelpers.installationResourceRowHtml({resource_type:'crane',resource_name:'Crane 1'}),custom=resourceHelpers.installationResourceRowHtml({resource_type:'truck',resource_name:'New truck'});
  const resourceChecks=[
    ['employee selector includes existing planner employees',employees.includes('value="Jordan"')&&employees.includes('value="Taylor"')],
    ['equipment selector reuses known equipment and planner resources',equipment.includes('value="Crane 1"')&&equipment.includes('value="Truck 2"')],
    ['unlisted resources retain a controlled custom-name option',custom.includes('value="__custom" selected')&&custom.includes('value="New truck"')],
  ];
  for(const [label,ok]of resourceChecks)console.log(`${ok?'PASS':'FAIL'}: behavior — ${label}`);
  if(resourceChecks.some(([,ok])=>!ok))process.exitCode=1;
}
const conflictStart=html.indexOf('function installationResourceConflicts');
const conflictEnd=html.indexOf('\nfunction installationActivityScopeState',conflictStart);
if(conflictStart<0||conflictEnd<0){console.log('FAIL: resource conflict helper is extractable for behavior tests');process.exitCode=1}else{
  const conflictCode=html.slice(conflictStart,conflictEnd);
  const conflictHelper=new Function('installResources',conflictCode+';return installationResourceConflicts')(a=>a.resources||[]);
  const assignment=(status,start_time,end_time)=>({activity_id:status+'-'+start_time,status,activity_date:'2026-10-19',start_time,end_time,resources:[{resource_type:'employee',resource_name:'Taylor',availability_status:'unconfirmed'}]});
  const conflictChecks=[
    ['on-hold activities do not reserve resources or create false conflicts',conflictHelper([{activities:[assignment('planned','07:00','17:00'),assignment('on_hold','07:00','17:00')]}]).length===0],
    ['overlapping planned/in-progress resource windows are still flagged',conflictHelper([{activities:[assignment('planned','07:00','12:00')]},{activities:[assignment('in_progress','10:00','17:00')]}]).length===1],
    ['non-overlapping resource windows on the same day are allowed',conflictHelper([{activities:[assignment('planned','07:00','10:00')]},{activities:[assignment('planned','13:00','17:00')]}]).length===0],
  ];
  for(const [label,ok]of conflictChecks)console.log((ok?'PASS':'FAIL')+': behavior — '+label);
  if(conflictChecks.some(([,ok])=>!ok))process.exitCode=1;
}
if(failures.length)process.exitCode=1;
const removableStart=html.indexOf('function installationActivityCanBeRemoved');
const removableEnd=html.indexOf('\nasync function cancelWallsInstallationActivity',removableStart);
if(removableStart<0||removableEnd<0){console.log('FAIL: activity-removal eligibility helper is extractable for behavior tests');process.exitCode=1}else{
  const canRemove=new Function(`${html.slice(removableStart,removableEnd)};return installationActivityCanBeRemoved`)();
  const removalChecks=[
    ['unstarted planned activity without run scope may be removed',canRemove({status:'planned',production_scope:[]})],
    ['started activity is protected',!canRemove({status:'in_progress',production_scope:[]})],
    ['held activity is protected',!canRemove({status:'on_hold',production_scope:[]})],
    ['completed activity is protected',!canRemove({status:'completed',production_scope:[]})],
    ['planned activity with linked production runs is protected',!canRemove({status:'planned',production_scope:[{assignment_id:'fixture'}]})],
  ];
  for(const [label,ok]of removalChecks)console.log(`${ok?'PASS':'FAIL'}: behavior — ${label}`);
  if(removalChecks.some(([,ok])=>!ok))process.exitCode=1;
}

const editStart=html.indexOf('function openWallsInstallationEditActivity(');
const editEnd=html.indexOf('\nfunction ',editStart+1);
if(editStart<0||editEnd<0){console.log('FAIL: field-activity editor is present for regression checks');process.exitCode=1}else{
  const editFn=html.slice(editStart,editEnd);
  const saveStart=editFn.indexOf("'Save activity',async()=>{");
  const closeAt=editFn.indexOf('closeProductionModal()',saveStart);
  const editChecks=[
    ['editor uses Installation management permission',editFn.includes('installationCanManage()')&&!editFn.includes('if(!currentUserIsAdmin)return;')],
    ['date, times, and notes are captured before modal close',closeAt>saveStart&&editFn.indexOf("const date=document.getElementById('installEditDate').value",saveStart)<closeAt&&editFn.indexOf("const start=document.getElementById('installEditStart').value",saveStart)<closeAt&&editFn.indexOf("notes=document.getElementById('installEditNotes').value",saveStart)<closeAt],
    ['edit save retains optimistic version and current status',editFn.includes('p_expected_version:a.version')&&editFn.includes('p_status:a.status')],
    ['field edit retains final QC gate',editFn.includes('!installationQcReady(job)')],
    ['edit rejects a non-positive activity time window',editFn.includes('start>=end')],
  ];
  for(const [label,ok]of editChecks)console.log(`${ok?'PASS':'FAIL'}: behavior — ${label}`);
  if(editChecks.some(([,ok])=>!ok))process.exitCode=1;
}
const catchupMigration=fs.readFileSync(path.join(root,'supabase','migrations','20261019_028_walls_installation_multiple_day_cards.sql'),'utf8');
const catchupChecks=[
  ['multiple active catch-up cards per date are allowed',/drop\s+index\s+if\s+exists\s+public\.walls_installation_one_active_day_card_idx/i.test(catchupMigration)],
  ['multiple-day-card migration preserves existing card/task rows',!/(delete\s+from|truncate\s+table)\s+public\.walls_installation_day_(cards|tasks)/i.test(catchupMigration)],
  ['catch-up editor tells managers how to separate jobs',html.includes('multiple cards for one day')&&html.includes('identify the job or crew in each title')],
  ['Today and 5-Day views retain add-card controls with existing cards',html.includes('data-catchup-add-day=')&&html.includes('function installationTodayFieldWorkContent(jobs,day,cards,canManage)')&&html.includes('activeCards.map(installationDayCardHtml)')&&html.includes('rows.map(card=>')],
];
for(const [label,ok]of catchupChecks)console.log(`${ok?'PASS':'FAIL'}: behavior — ${label}`);
if(catchupChecks.some(([,ok])=>!ok))process.exitCode=1;

const workspaceStart=html.indexOf('function openInstallationJobWorkspace(');
const workspaceEnd=html.indexOf('function openWallsInstallationIssueForm',workspaceStart);
const workspaceSource=html.slice(workspaceStart,workspaceEnd);
const workspaceBindingChecks=[
  ['workspace tab buttons are explicit non-submit controls',workspaceSource.includes('<button type="button" class="mini ${k===active?')],
  ['workspace tabs delegate clicks from their own navigation',workspaceSource.includes("tabNav?.addEventListener('click',event=>")],
  ['workspace panel binds controls within its own panel',workspaceSource.includes('bindWallsInstallationEnhancedControls(panel)')],
  ['workspace control binder supports a scoped root',html.includes('function bindWallsInstallationEnhancedControls(root=document)')],
  ['activity editor remains delegated after panel changes',workspaceSource.includes('bindWallsInstallationEditControls()')],
  ['job workspace activities use bounded lightweight rows instead of the frozen derived-card path',html.includes('visibleActivities=activities.slice(0,100)')&&!html.includes('activities.map(a=>installationWorkspaceActivityCard(job,a))')],
  ['focused workspace activity cards preserve edit and progress controls',html.includes('function installationWorkspaceActivityCard(job,a)')&&html.includes('data-install-edit-activity')],
];
const labelNormalizationChecks=[
  ['Installation label observer avoids rewriting unchanged canonical labels',html.includes('const label=labels.get(key);if(label&&node.textContent!==label)node.textContent=label;')&&html.includes("const current=node.textContent,next=current.replace(/site preparation/gi,'site readiness').replace(/wall installation/gi,'wall install');if(next!==current)node.textContent=next;")],
];
for(const [label,ok] of labelNormalizationChecks)console.log(`${ok?'PASS':'FAIL'}: performance — ${label}`);
if(labelNormalizationChecks.some(([,ok])=>!ok))process.exitCode=1;
for(const [label,ok] of workspaceBindingChecks)console.log(`${ok?'PASS':'FAIL'}: behavior — ${label}`);
if(workspaceBindingChecks.some(([,ok])=>!ok))process.exitCode=1;


