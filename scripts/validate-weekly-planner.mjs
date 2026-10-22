import assert from 'node:assert/strict';
import vm from 'node:vm';
// Focused controls for the companywide Weekly Crew Planner.
// Prepared by Scout for Wes Borgen
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const [html,sql,reapprovalMigration,stabilityMigration,agent]=await Promise.all([
  readFile(resolve(root,'index.html'),'utf8'),
  readFile(resolve(root,'supabase','migrations','20261016_015_weekly_crew_planner.sql'),'utf8'),
  readFile(resolve(root,'supabase','migrations','20261016_016_weekly_planner_reapproval_guard.sql'),'utf8'),
  readFile(resolve(root,'supabase','migrations','20261021111232_weekly_planner_stability_and_advisory_gates.sql'),'utf8'),
  readFile(resolve(root,'supabase','functions','operations-agent','index.ts'),'utf8'),
]);

const requiredSections=['walls_production','table_flow','walls_stripping_loading','box_precast_support','installation_stone','logistics_cranes','quality_control','maintenance_plant'];
const checks=[
  [html.includes('data-view="weekly-planner"'),'Weekly Planner is missing from the existing sidebar.'],
  [['Weekly Planner','Work Sources','Crew Review','Approved Packs'].every(x=>html.includes(x)),'One or more Weekly Planner subtabs are missing.'],
  [requiredSections.every(x=>sql.includes(`'${x}'`)),'One or more required departmental schedules are missing.'],
  [sql.includes('weekly_planner_section_revisions')&&sql.includes('weekly_planner_packs'),'Approval or packet history is missing.'],
  [sql.includes('source_fingerprint')&&sql.includes('reapproval_required'),'Source-change reapproval control is missing.'],
  [sql.includes("if v_conflict.severity='block' then raise exception"),'Hard conflicts can be acknowledged instead of resolved.'],
  [sql.includes("public.is_operations_admin()")&&sql.includes('weekly_planner_access'),'Management and future scoped access controls are missing.'],
  [html.includes('Superior_Operations_Employee_Schedules_${snap.week_start}_APPROVED.pdf'),'Approved combined-PDF naming is missing.'],
  [html.includes("week?.status==='reapproval_required'")&&html.includes('REAPPROVAL REQUIRED'),'Planner week-level reapproval is not surfaced to users.'],
  [html.includes('INACTIVE · retained for history'),'Inactive approved packets are not clearly distinguished from the active packet.'],
  [html.includes('class="header-more"')&&html.includes('id="importHeaderBtn"')&&html.includes('id="refreshLiveBtn"')&&html.includes('id="exportBtn"')&&html.includes('id="resetBtn"')&&html.includes('id="signOutBtn"'),'Mobile header compaction removed or obscured an existing action.'],
  [html.includes('.assistant-launch{position:static'),'The mobile Operations Assistant may obscure dashboard controls.'],
  [html.includes('<th>Planned pour date</th><th>Actual pour date</th>')&&html.includes("r.actualPourDate?fmt(r.actualPourDate):'—'"),'Weekly Forecast does not distinguish the actual pour date from the planned date.'],
  [reapprovalMigration.includes("status='reapproval_required'")&&reapprovalMigration.includes("'section_reapproval_required'")&&reapprovalMigration.includes('planning_inputs_saved_after_approval'),'Planning-input changes do not invalidate stale approvals with an audit trail.'],
  [reapprovalMigration.includes('approved_source_fingerprint=null')&&reapprovalMigration.includes('approved_at=null'),'Invalidated sections still appear to carry current approval metadata.'],
  [!(/delete\s+from\s+public\.weekly_planner_(section_revisions|packs)/i.test(reapprovalMigration)),'Planner reapproval migration must preserve frozen section and packet history.'],
  [agent.includes('Weekly Planner information is read-only context'),'The existing assistant is not explicitly read-only for Weekly Planner.'],
  [!html.includes('Weekly Planner Assistant'),'A duplicate scheduling assistant was introduced.'],
  [!html.includes('await Promise.all([loadInventory(),loadWallsProduction(),loadWeeklyPlanner()])'),'Weekly Planner snapshot blocks the general sign-in data load.'],
  [html.includes("state.view==='weekly-planner'")&&html.includes('weeklyPlannerLoadPromise')&&html.includes('get_weekly_planner_snapshot'),'Planner snapshots are not lazy-loaded and deduplicated.'],
  [html.includes('week_start=eq.')&&html.includes('weeklyPlannerRefreshTimer=setTimeout'),'Planner Realtime is not week-filtered and debounced.'],
  [html.includes("state.view==='weekly-planner'?await loadWeeklyPlanner(true,'post-write'):true")&&html.includes('finally{if(valid())weeklyPlannerBusy=false}'),'Planner write controls can remain locked or trigger off-screen snapshots.'],
  [html.includes("approve_weekly_planner_section")&&html.includes("p_expected_version:version")&&html.includes('Saving and approving section…'),'Section approval does not save and approve without an intermediate full snapshot.'],
  [html.includes('plannerCrewPeopleSelect')&&html.includes('weeklyPlanner.people')&&html.includes('weeklyPlanner.availability')&&html.includes('plannerCrewPeopleNew')&&html.includes("from('walls_installation_resources').select('resource_name').eq('resource_type','employee')")&&html.includes("sectionKey==='installation_stone'?weeklyPlannerInstallEmployees:[]")&&html.includes('data-planner-person')&&html.includes("querySelectorAll('#plannerCrewPeopleSelect [data-planner-person]:checked')"),'Crew review must preserve saved/manual names, offer explicit add/remove checkboxes, and source Installation choices from Installation employee resources.'],
  [html.includes('Advisory only · no acknowledgment required')&&!html.includes('data-planner-action="ack"'),'Advisory warnings still require repetitive acknowledgment.'],
  [stabilityMigration.includes("case when r.readiness_status in ('unavailable','hold') then 'block' else 'warning' end")&&stabilityMigration.includes("case when a.readiness_status='hold' then 'block' else 'warning' end"),'Explicit equipment/work holds are not distinguished from advisory unconfirmed status.'],
  [stabilityMigration.includes("c.status='open' and c.severity='block'")&&stabilityMigration.includes("status='open' and severity='block'"),'Section approvals or publication still gate on advisory warnings.'],
  [(stabilityMigration.match(/CREATE OR REPLACE FUNCTION/g)||[]).length===3&&(stabilityMigration.match(/\$function\$;/g)||[]).length===3,'Weekly Planner stability migration is missing a function terminator.'],
];
const failures=checks.filter(([ok])=>!ok);
if(failures.length){for(const [,message] of failures)console.error('FAIL: '+message);process.exitCode=1}else console.log('PASS: Weekly Planner load, refresh, crew entry, approval gates, navigation, history, PDF, permissions, and assistant boundary are present.');


// Execute the browser's real publication predicate and renderer with synthetic snapshots.
// This catches UI/SQL drift that source-string checks alone cannot detect.
const publicationContext={weeklyPlanner:null,plannerDateLabel:x=>x,htmlSafe:x=>String(x)};
for(const name of ['plannerPublicationState','plannerPacks']){
  const source=html.split(/\r?\n/).find(line=>line.startsWith('function '+name+'('));
  assert.ok(source,`Missing ${name}`);
  vm.runInNewContext(source,publicationContext);
}
const approvedPlanner=()=>({permissions:{publish:true},week:{source_stale:false},sections:Array.from({length:8},()=>({status:'approved'})),conflicts:[],recent_packs:[]});
const cases=[
  ['all approved and current',p=>{},true],
  ['advisory warnings do not block',p=>p.conflicts.push({status:'open',severity:'warning'}),true],
  ['open hard conflict blocks',p=>p.conflicts.push({status:'open',severity:'block'}),false],
  ['resolved hard conflict does not block',p=>p.conflicts.push({status:'resolved',severity:'block'}),true],
  ['source change blocks',p=>p.week.source_stale=true,false],
  ['unapproved section blocks',p=>p.sections[0].status='needs_review',false],
  ['missing section blocks',p=>p.sections.pop(),false],
  ['missing week blocks',p=>p.week=null,false],
  ['missing publication permission blocks',p=>p.permissions.publish=false,false],
];
for(const [label,mutate,expected] of cases){
  const planner=approvedPlanner();mutate(planner);publicationContext.weeklyPlanner=planner;
  assert.equal(publicationContext.plannerPublicationState(planner).canPublish,expected,label);
  const rendered=publicationContext.plannerPacks();
  if(planner.permissions.publish)assert.equal(/data-planner-action="publish" disabled/.test(rendered),!expected,label+' rendered button');
  else assert.ok(!rendered.includes('data-planner-action="publish"'),label+' hidden button');
  if(planner.conflicts.some(x=>x.status==='open'&&x.severity==='warning'))assert.ok(rendered.includes('they do not block publication'),label+' visible warning');
  console.log('PASS: publication behavior - '+label);
}
