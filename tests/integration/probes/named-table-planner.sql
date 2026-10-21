-- Public-schema contract probe: production table identifiers are text.
\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',false);
begin;
select test_workflow.patch('walls','TEST-NAMED-TABLE','{"job":"TEST-NAMED-TABLE","lf":20,"lfByHeight":{"h8":20}}');
select public.upsert_walls_production_table('TEST-NAMED-TABLE-A','TEST named table',100,true);
select public.upsert_walls_production_assignment(null,'TEST-NAMED-TABLE','TEST-NAMED-TABLE-A',8,20,'2026-11-16 07:00','2026-11-16 15:00','2026-11-17 07:00','TEST named table');
select public.generate_weekly_planner('2026-11-16');
select test_workflow.assert((select count(*)=8 from public.weekly_planner_sections where week_start='2026-11-16'),'text production table identifiers can generate all eight planner sections');
rollback;
reset role;
