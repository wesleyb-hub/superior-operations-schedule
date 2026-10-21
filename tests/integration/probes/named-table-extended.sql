-- Strict regression; disposable fixture only. Requires walls-workflow-cases helpers.
\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',true);
do $$
declare v_id text; v_row jsonb; v_count integer; v_snapshot jsonb; v_orders jsonb:='{}';
begin
 perform test_workflow.patch('walls','TEST-NAMED-TABLE-JOB','{"job":"TEST-NAMED-TABLE-JOB","customer":"SYNTHETIC ONLY","lf":100,"lfByHeight":{"h8":100},"productionDate":"2026-11-02","planReview":{"stages":{"approvedProduction":{"status":"Complete","date":"2026-10-21"}}}}');
 foreach v_id in array array['TEST-NAMED-TABLE-A','99999999999999999999999999'] loop
  v_row:=public.upsert_walls_production_table(v_id,'SYNTHETIC TEST '||v_id,100,true,'Disposable named-table regression');
  v_count:=(v_row->>'sort_order')::integer;
  v_row:=public.upsert_walls_production_assignment(null,'TEST-NAMED-TABLE-JOB',v_id,8,40,'2026-11-02 07:00','2026-11-02 15:00','2026-11-03 07:00','SYNTHETIC ONLY');
  perform test_workflow.assert(v_row->>'table_id'=v_id,'text table identifier persisted unchanged');
  v_orders:=v_orders||jsonb_build_object(v_row->>'assignment_id',v_count);
 end loop;
 perform public.generate_weekly_planner('2026-11-02');
 v_snapshot:=public.get_weekly_planner_snapshot('2026-11-02');
 select count(distinct w->>'section_id') into v_count from jsonb_array_elements(v_snapshot->'assignments') w where v_orders ? (w->>'source_id');
 perform test_workflow.assert(v_count=4,'named and oversized numeric table IDs generate all four production-linked planner sections');
 perform test_workflow.assert(not exists(select 1 from jsonb_array_elements(v_snapshot->'assignments') w where v_orders ? (w->>'source_id') and (w->>'sort_order')::integer is distinct from (v_orders->>(w->>'source_id'))::integer),'generated assignments use authoritative table sort_order');
 perform test_workflow.assert(jsonb_array_length(v_snapshot->'sections')=8,'all weekly sections retained with installation integration');
end $$;
rollback;
