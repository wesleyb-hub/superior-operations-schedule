// Focused controls for the companywide Weekly Crew Planner.
// Prepared by Scout for Wes Borgen
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const [html,sql,reapprovalMigration,agent]=await Promise.all([
  readFile(resolve(root,'index.html'),'utf8'),
  readFile(resolve(root,'supabase','migrations','20261016_015_weekly_crew_planner.sql'),'utf8'),
  readFile(resolve(root,'supabase','migrations','20261016_016_weekly_planner_reapproval_guard.sql'),'utf8'),
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
  [reapprovalMigration.includes("status='reapproval_required'")&&reapprovalMigration.includes("'section_reapproval_required'")&&reapprovalMigration.includes('planning_inputs_saved_after_approval'),'Planning-input changes do not invalidate stale approvals with an audit trail.'],
  [reapprovalMigration.includes('approved_source_fingerprint=null')&&reapprovalMigration.includes('approved_at=null'),'Invalidated sections still appear to carry current approval metadata.'],
  [!(/delete\s+from\s+public\.weekly_planner_(section_revisions|packs)/i.test(reapprovalMigration)),'Planner reapproval migration must preserve frozen section and packet history.'],
  [agent.includes('Weekly Planner information is read-only context'),'The existing assistant is not explicitly read-only for Weekly Planner.'],
  [!html.includes('Weekly Planner Assistant'),'A duplicate scheduling assistant was introduced.'],
];
const failures=checks.filter(([ok])=>!ok);
if(failures.length){for(const [,message] of failures)console.error('FAIL: '+message);process.exitCode=1}else console.log('PASS: Weekly Planner navigation, eight schedules, approvals, history, PDF, permissions, and assistant boundary are present.');

