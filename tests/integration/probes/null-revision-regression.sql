-- DISPOSABLE DB ONLY. Reject omission of optimistic-concurrency tokens.
-- Expected to fail on existing NULL-comparison behavior until separately fixed.
\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',false);
begin;
do $$ declare snap jsonb; after_save jsonb;begin
 snap:=public.get_schedule_snapshot();
 perform test_workflow.rejects(format('select public.save_schedule_snapshot(null,%L::jsonb)',snap#>'{payload,data}'),'Revision conflict','missing master revision cannot bypass stale-write protection');
 after_save:=public.get_schedule_snapshot();
 perform test_workflow.assert(after_save->'revision'=snap->'revision' and after_save->'payload'=snap->'payload','NULL revision rejection preserves revision and records');
 perform test_workflow.rejects(format('select public.save_schedule_snapshot(%s,%L::jsonb)',(snap->>'revision')::bigint-1,snap#>'{payload,data}'),'Revision conflict','stale master revision still rejected after null fix');
 after_save:=public.save_schedule_snapshot((snap->>'revision')::bigint,snap#>'{payload,data}','TEST exact revision succeeds');
 perform test_workflow.assert((after_save->>'revision')::bigint=(snap->>'revision')::bigint+1 and after_save->'payload'=snap->'payload','matching revision still saves exactly once without data changes');
end $$;
rollback;
reset role;
