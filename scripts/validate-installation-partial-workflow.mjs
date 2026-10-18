// Prepared by Scout
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase','migrations','20261018_022_walls_installation_partial_scope.sql'),'utf8');
const statusMigration=fs.readFileSync(path.join(root,'supabase','migrations','20261018_023_walls_installation_partial_status.sql'),'utf8');
const plannerMigration=fs.readFileSync(path.join(root,'supabase','migrations','20261018_025_weekly_planner_partial_run_scope.sql'),'utf8');
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
  ['UI: new job workspace includes required linked records and history',/\['overview','Overview'\][\s\S]*\['production','Production & Loads'\][\s\S]*\['history','History'\]/.test(html)],
  ['UI: Today is job-first with explicit next action and actual activity-based stages',/function installationJobCompactCard/.test(html)&&/function installationJobStageStatus/.test(html)&&/Next action/.test(html)&&/fieldJobs\.map\(j=>installationJobCompactCard\(j,day\)\)/.test(html)],
  ['UI: Update Progress opens the same job workspace at Field Activities',/data-install-update-job/.test(html)&&/openInstallationJobWorkspace\(b\.dataset\.installUpdateJob,'activities'\)/.test(html)],
  ['UI: compact installation job cards adapt to phone-sized screens',/\.install-job-card\{[\s\S]*\.install-job-progress\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(html)],
  ['UI: catch-up day row is composed inside the active job-week renderer',/function renderInstallationJobWeek\(jobs,dates,activities,cards,canManage\)[\s\S]*?renderInstallationCatchupWeekRow\(dates,cards,canManage\)/.test(html)&&/renderInstallationJobWeek\(jobs,dates,activities,catchupCards,canManage\)/.test(html)&&!html.includes('body=body.replace(/<\\/div>$/')&&!html.includes('function injectInstallationCatchupUI')],
  ['UI: today catch-up cards render before control binding',/function renderInstallationCatchupToday/.test(html)&&/renderInstallationCatchupToday\(day,catchupCards,canManage\)/.test(html)&&/bindInstallationCatchupControls\(\)/.test(html)],
  ['UI: weekly plan is organized as job rows and adapts on mobile',/function renderInstallationJobWeek/.test(html)&&/\.install-week-grid\{grid-template-columns:minmax\(0,1fr\)/.test(html)],
  ['UI: issue, resolution, and resource status use in-app forms',/function openWallsInstallationIssueForm/.test(html)&&/function openWallsInstallationResolveForm/.test(html)&&/function openWallsInstallationResourceStatusForm/.test(html)],
  ['UI: employee and equipment assignments use selectors with an explicit add-name fallback',/function installationResourceNameChoices/.test(html)&&/data-resource-choice/.test(html)&&/Add a name not listed/.test(html)&&/data-resource-custom/.test(html)],
  ['UI: scope updates refresh across connected clients',/walls_installation_activity_assignments','walls_installation_resources/.test(html)&&/activity_id,assignment_id,load_record_id/.test(html)],
  ['UI: superseded activity-first renderer, modal, and binder are removed',!/function renderWallsInstallation\(/.test(html)&&!/function bindWallsInstallationControls\(/.test(html)&&!/function openWallsInstallationActivityModal\(/.test(html)&&/function renderWallsInstallationEnhanced\(/.test(html)],
  ['UI: held scope remains fixed and Resume re-enters in-progress state',/scope\.required&&canManage&&status==='planned'/.test(html)&&/data-install-status="\$\{a\.activity_id\}\|in_progress">Resume/.test(html)],
  ['UI: Resources board labels held work separately from planned work',html.includes("x._activity.status==='on_hold'")&&html.includes("installationStatusLabel(x._activity.status)")],
  ['Weekly Planner receives the explicit production run scope',/Runs: '\|\|string_agg\('Table '\|\|p\.table_id/.test(plannerMigration)],
];
const failures=checks.filter(([,ok])=>!ok);
for(const [label,ok] of checks)console.log(`${ok?'PASS':'FAIL'}: ${label}`);

const stageStart=html.indexOf('function installationJobStageStatus');
const compactStart=html.indexOf('function installationJobCompactCard',stageStart);
if(stageStart<0||compactStart<0){console.log('FAIL: job-progress helpers are extractable for behavior tests');process.exitCode=1}else{
  const helpers=new Function('normalizeDate',`${html.slice(stageStart,compactStart)};return{installationJobStageStatus,installationJobNextAction}`)(value=>value||null);
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
  ];
  for(const [label,ok]of behaviorChecks)console.log(`${ok?'PASS':'FAIL'}: behavior — ${label}`);
  if(behaviorChecks.some(([,ok])=>!ok))process.exitCode=1;
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
