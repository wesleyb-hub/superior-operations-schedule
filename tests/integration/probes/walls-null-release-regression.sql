-- Requires full migration baseline + workflow helpers. Run in isolated DB only.
-- Fails on deployed pre-PR80 behavior; passes with actual fail-closed migration.
\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',false);
begin;
select test_workflow.patch('walls','TEST-NULL-RELEASE','{"job":"TEST-NULL-RELEASE","lf":10,"lfByHeight":{"h8":10}}');
do $$ declare row jsonb;a uuid;begin
 row:=public.upsert_walls_production_assignment(null,'TEST-NULL-RELEASE','9001',8,10,'2026-11-02 07:00','2026-11-02 15:00','2026-11-03 07:00','TEST missing plan review');a:=(row->>'assignment_id')::uuid;
 perform test_workflow.rejects(format('select public.advance_walls_production_stage(%L::uuid,%L)',a,'setup_in_progress'),'not released','absent plan review fails closed');
end $$;
rollback;
reset role;
