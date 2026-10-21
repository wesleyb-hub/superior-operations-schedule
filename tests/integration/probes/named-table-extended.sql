-- Strict regression; disposable fixture only. Requires walls-workflow-cases helpers.
\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',true);
do $$
declare v_id text; v_row jsonb; v_count integer;
begin
 perform test_workflow.patch('walls','TEST-NAMED-TABLE-JOB','{"job":"TEST-NAMED-TABLE-JOB","customer":"SYNTHETIC ONLY","lf":100,"lfByHeight":{"h8":100},"productionDate":"2026-11-02","planReview":{"stages":{"approvedProduction":{"status":"Complete","date":"2026-10-21"}}}}');
 foreach v_id in array array['TEST-NAMED-TABLE-A','99999999999999999999999999'] loop
  perform public.upsert_walls_production_table(v_id,'SYNTHETIC TEST '||v_id,100,true,'Disposable named-table regression');
  v_row:=public.upsert_walls_production_assignment(null,'TEST-NAMED-TABLE-JOB',v_id,8,40,'2026-11-02 07:00','2026-11-02 15:00','2026-11-03 07:00','SYNTHETIC ONLY');
  perform test_workflow.assert(v_row->>'table_id'=v_id,'text table identifier persisted unchanged');
 end loop;
 perform public.generate_weekly_planner('2026-11-02');
 select count(distinct s.section_key) into v_count
 from public.weekly_planner_assignments w join public.weekly_planner_sections s on s.section_id=w.section_id
 join public.walls_production_assignments p on p.assignment_id::text=w.source_id and w.source_type='walls_production_assignment'
 where s.week_start='2026-11-02' and p.wall_record_id='TEST-NAMED-TABLE-JOB';
 perform test_workflow.assert(v_count=4,'named and oversized numeric table IDs generate all four production-linked planner sections');
 perform test_workflow.assert(not exists(
  select 1 from public.weekly_planner_assignments w join public.weekly_planner_sections s on s.section_id=w.section_id
  join public.walls_production_assignments p on p.assignment_id::text=w.source_id and w.source_type='walls_production_assignment'
  join public.walls_production_tables t on t.table_id=p.table_id
  where s.week_start='2026-11-02' and p.wall_record_id='TEST-NAMED-TABLE-JOB' and w.sort_order is distinct from t.sort_order
 ),'generated assignments use authoritative table sort_order');
 perform test_workflow.assert((select count(*)=8 from public.weekly_planner_sections where week_start='2026-11-02'),'all weekly sections retained with installation integration');
end $$;
rollback;
