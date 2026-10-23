-- SYNTHETIC DISPOSABLE DATABASE ONLY; all added users/access/records roll back.
-- Run after walls-workflow-cases.sql, never against hosted Supabase.
\set ON_ERROR_STOP on
do $guard$
begin
  if current_database() <> 'superior_workflow_test'
    or to_regprocedure('test_workflow.assert(boolean,text)') is null then
    raise exception 'Refusing non-disposable database or missing synthetic test fixture';
  end if;
end;
$guard$;

begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000041','planner-reader@example.invalid'),
 ('00000000-0000-4000-8000-000000000042','planner-editor@example.invalid'),
 ('00000000-0000-4000-8000-000000000043','planner-approver@example.invalid'),
 ('00000000-0000-4000-8000-000000000044','planner-outsider@example.invalid'),
 ('00000000-0000-4000-8000-000000000045','planner-disabled@example.invalid'),
 ('00000000-0000-4000-8000-000000000046','planner-publisher@example.invalid');
insert into public.weekly_planner_access(user_id,can_view,can_edit,can_approve,can_publish,allowed_sections,enabled) values
 ('00000000-0000-4000-8000-000000000041',true,false,false,false,'{}',true),
 ('00000000-0000-4000-8000-000000000042',true,true,false,false,'{walls_production}',true),
 ('00000000-0000-4000-8000-000000000043',true,false,true,false,'{walls_production}',true),
 ('00000000-0000-4000-8000-000000000045',true,true,true,true,'{}',false),
 ('00000000-0000-4000-8000-000000000046',true,false,false,true,'{}',true);

select test_workflow.assert(not has_function_privilege('anon','public.rebuild_weekly_planner_conflicts(date)','EXECUTE'),'anon cannot execute internal conflict writer');
select test_workflow.assert(not has_function_privilege('authenticated','public.rebuild_weekly_planner_conflicts(date)','EXECUTE'),'authenticated cannot execute internal conflict writer');
select test_workflow.assert(has_function_privilege('service_role','public.rebuild_weekly_planner_conflicts(date)','EXECUTE'),'existing service-role privilege is unchanged');
select test_workflow.assert(
  (select count(*)=4 and bool_and(p.prosecdef and has_function_privilege(p.proowner,h.oid,'EXECUTE'))
   from pg_proc p cross join pg_proc h
   where p.pronamespace='public'::regnamespace
     and h.oid='public.rebuild_weekly_planner_conflicts(date)'::regprocedure
     and p.oid<>h.oid and p.prosrc like '%rebuild_weekly_planner_conflicts%'),
  'all four existing callers remain SECURITY DEFINER with helper EXECUTE for their owners');

-- Every screen-level admin action uses a guarded owner-executed caller, not the helper RPC.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',true);
select test_workflow.assert(public.is_operations_admin(),'existing manager remains admin');
select test_workflow.rejects($q$select public.rebuild_weekly_planner_conflicts('2026-12-21')$q$,'permission denied for function rebuild_weekly_planner_conflicts','direct helper is internal-only even for an admin JWT');
select public.generate_weekly_planner('2026-12-21');
select test_workflow.assert((select count(*)=8 from public.weekly_planner_sections where week_start='2026-12-21'),'admin generate still recomputes through its owner');
select public.save_weekly_planner_inputs('2026-12-21','[]','[]');
select test_workflow.assert(true,'admin save inputs still recomputes through its owner');
do $seed$
declare s record;
begin
 for s in select * from public.weekly_planner_sections where week_start='2026-12-21' order by section_key loop
   perform public.save_weekly_planner_section(s.section_id,s.schedule_version,'TEST '||s.section_key,
     jsonb_build_array(jsonb_build_object('name','TEST '||s.section_key,'is_leader',true)),'[]');
 end loop;
 perform test_workflow.assert(not exists(select 1 from public.weekly_planner_conflicts where week_start='2026-12-21' and status='open'),'synthetic staffed plan has no open conflicts');
end;
$seed$;

-- Viewer read succeeds; direct mutation is rejected before running the function and preserves state.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000041","email":"planner-reader@example.invalid","role":"authenticated"}',true);
do $reader$
declare before_state jsonb;
begin
 perform test_workflow.assert(public.weekly_planner_permission('view') and not public.weekly_planner_permission('edit'),'reader fixture really has view only');
 before_state:=public.get_weekly_planner_snapshot('2026-12-21');
 perform test_workflow.assert(jsonb_array_length(before_state->'sections')=8,'planner viewer keeps existing read access');
 perform test_workflow.rejects($q$select public.rebuild_weekly_planner_conflicts('2026-12-21')$q$,'permission denied for function rebuild_weekly_planner_conflicts','viewer cannot rebuild conflicts');
 perform test_workflow.assert(public.get_weekly_planner_snapshot('2026-12-21')=before_state,'denied viewer rebuild leaves planner state and audit unchanged');
 perform test_workflow.rejects($q$select public.generate_weekly_planner('2026-12-21')$q$,'access required','viewer cannot bypass through generation');
 perform test_workflow.rejects($q$select public.save_weekly_planner_inputs('2026-12-21','[]','[]')$q$,'access required','viewer cannot bypass through inputs');
end;
$reader$;

-- A section-limited editor retains save but cannot approve/publish or invoke the helper directly.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000042","email":"planner-editor@example.invalid","role":"authenticated"}',true);
do $editor$
declare s public.weekly_planner_sections%rowtype; result jsonb;
begin
 select * into s from public.weekly_planner_sections where week_start='2026-12-21' and section_key='walls_production';
 perform test_workflow.assert(public.weekly_planner_permission('edit',s.section_key) and not public.weekly_planner_permission('approve',s.section_key),'scoped editor capability unchanged');
 result:=public.save_weekly_planner_section(s.section_id,s.schedule_version,'TEST updated leader','[{"name":"TEST updated leader","is_leader":true}]','[]');
 perform test_workflow.assert((result->>'schedule_version')::bigint=s.schedule_version+1,'scoped editor save succeeds and internally rebuilds');
 perform test_workflow.rejects($q$select public.rebuild_weekly_planner_conflicts('2026-12-21')$q$,'permission denied for function rebuild_weekly_planner_conflicts','editor has no direct helper RPC');
 perform test_workflow.rejects(format('select public.approve_weekly_planner_section(%L,%s)',s.section_id,result->>'schedule_version'),'approval access required','editor cannot approve');
 perform test_workflow.rejects($q$select public.publish_weekly_planner_pack('2026-12-21')$q$,'publication access required','editor cannot publish');
end;
$editor$;

-- Approve-only is the reason not to change the helper's old view guard to edit.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000043","email":"planner-approver@example.invalid","role":"authenticated"}',true);
do $approver$
declare s public.weekly_planner_sections%rowtype; other public.weekly_planner_sections%rowtype; result jsonb;
begin
 select * into s from public.weekly_planner_sections where week_start='2026-12-21' and section_key='walls_production';
 select * into other from public.weekly_planner_sections where week_start='2026-12-21' and section_key='installation_stone';
 perform test_workflow.assert(public.weekly_planner_permission('approve',s.section_key) and not public.weekly_planner_permission('edit'),'approve-only fixture has no edit authority');
 result:=public.approve_weekly_planner_section(s.section_id,s.schedule_version);
 perform test_workflow.assert(result->>'status'='approved','scoped approve-only caller succeeds and internally rebuilds');
 perform test_workflow.rejects(format('select public.approve_weekly_planner_section(%L,%s)',other.section_id,other.schedule_version),'approval access required','approver cannot approve another section');
 perform test_workflow.rejects($q$select public.rebuild_weekly_planner_conflicts('2026-12-21')$q$,'permission denied for function rebuild_weekly_planner_conflicts','approve-only has no direct helper RPC');
end;
$approver$;

-- Unassigned and disabled users cannot read or use write wrappers.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000044","email":"planner-outsider@example.invalid","role":"authenticated"}',true);
select test_workflow.rejects($q$select public.get_weekly_planner_snapshot('2026-12-21')$q$,'access required','unassigned user cannot read planner');
select test_workflow.rejects($q$select public.rebuild_weekly_planner_conflicts('2026-12-21')$q$,'permission denied for function rebuild_weekly_planner_conflicts','unassigned user cannot invoke helper');
select test_workflow.rejects($q$select public.generate_weekly_planner('2026-12-21')$q$,'access required','unassigned user cannot use generation wrapper');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000045","email":"planner-disabled@example.invalid","role":"authenticated"}',true);
select test_workflow.rejects($q$select public.get_weekly_planner_snapshot('2026-12-21')$q$,'access required','disabled user cannot read planner');
select test_workflow.rejects($q$select public.rebuild_weekly_planner_conflicts('2026-12-21')$q$,'permission denied for function rebuild_weekly_planner_conflicts','disabled user cannot invoke helper');
select test_workflow.rejects($q$select public.generate_weekly_planner('2026-12-21')$q$,'access required','disabled user cannot use generation wrapper');

-- Existing admin approval and dedicated publication still work end to end.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',true);
do $approve_rest$
declare s record;
begin
 for s in select * from public.weekly_planner_sections where week_start='2026-12-21' and status<>'approved' order by section_key loop
   perform public.approve_weekly_planner_section(s.section_id,s.schedule_version);
 end loop;
 perform test_workflow.assert((select count(*)=8 from public.weekly_planner_sections where week_start='2026-12-21' and status='approved'),'manager can approve all eight sections');
end;
$approve_rest$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000046","email":"planner-publisher@example.invalid","role":"authenticated"}',true);
select test_workflow.assert(public.weekly_planner_permission('publish') and not public.weekly_planner_permission('edit') and not public.weekly_planner_permission('approve'),'publisher-only capability unchanged');
select test_workflow.rejects($q$select public.rebuild_weekly_planner_conflicts('2026-12-21')$q$,'permission denied for function rebuild_weekly_planner_conflicts','publisher has no direct helper RPC');
select test_workflow.assert(public.publish_weekly_planner_pack('2026-12-21')->>'pack_id' is not null,'dedicated publisher can publish approved packet');

reset role;
rollback;
select 'PASS: planner helper access boundaries; all synthetic fixtures rolled back' as result;
