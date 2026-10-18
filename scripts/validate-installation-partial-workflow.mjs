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
  ['UI: weekly plan is organized as job rows and adapts on mobile',/function renderInstallationJobWeek/.test(html)&&/\.install-week-grid\{grid-template-columns:minmax\(0,1fr\)/.test(html)],
  ['UI: issue, resolution, and resource status use in-app forms',/function openWallsInstallationIssueForm/.test(html)&&/function openWallsInstallationResolveForm/.test(html)&&/function openWallsInstallationResourceStatusForm/.test(html)],
  ['UI: scope updates refresh across connected clients',/walls_installation_activity_assignments','walls_installation_resources/.test(html)&&/activity_id,assignment_id,load_record_id/.test(html)],
  ['Weekly Planner receives the explicit production run scope',/Runs: '\|\|string_agg\('Table '\|\|p\.table_id/.test(plannerMigration)],
];
const failures=checks.filter(([,ok])=>!ok);
for(const [label,ok] of checks)console.log(`${ok?'PASS':'FAIL'}: ${label}`);
if(failures.length)process.exitCode=1;
