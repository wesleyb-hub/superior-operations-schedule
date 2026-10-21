-- DISPOSABLE SYNTHETIC DATABASE ONLY: requires every repository migration and
-- test_workflow helpers from walls-workflow-cases.sql. No extracted/mocked RPCs.
-- Strict regression: legacy NULL comparison must fail this test; PR80 passes.
\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',false);
begin;
do $$
declare
  assignment uuid; result jsonb; variant jsonb; before_row jsonb;
  before_events bigint; hold_id bigint;
begin
  perform test_workflow.patch('walls','TEST-RELEASE-VARIANTS',
    '{"job":"TEST-RELEASE-VARIANTS","customer":"SYNTHETIC TEST ONLY","lf":10,"lfByHeight":{"h8":10}}');
  perform public.upsert_walls_production_table('TEST-RELEASE-VARIANTS-TABLE','TEST release variants',100,true);
  result:=public.upsert_walls_production_assignment(null,'TEST-RELEASE-VARIANTS','TEST-RELEASE-VARIANTS-TABLE',8,10,
    '2026-11-23 07:00','2026-11-23 15:00','2026-11-24 07:00','TEST release enforcement');
  assignment:=(result->>'assignment_id')::uuid;
  -- First variant leaves planReview entirely absent. Every subsequent patch
  -- replaces the entire nested object, rather than merging an earlier status.
  for variant in select value from jsonb_array_elements('[
    {"label":"absent planReview","patch":{}},
    {"label":"empty stages","patch":{"planReview":{"stages":{}}}},
    {"label":"missing approvedProduction","patch":{"planReview":{"stages":{"permitPackage":{"status":"Complete"}}}}},
    {"label":"missing status","patch":{"planReview":{"stages":{"approvedProduction":{}}}}},
    {"label":"JSON-null status","patch":{"planReview":{"stages":{"approvedProduction":{"status":null}}}}},
    {"label":"Not Started status","patch":{"planReview":{"stages":{"approvedProduction":{"status":"Not Started"}}}}},
    {"label":"Incomplete status","patch":{"planReview":{"stages":{"approvedProduction":{"status":"Incomplete"}}}}}
  ]'::jsonb) loop
    perform test_workflow.patch('walls','TEST-RELEASE-VARIANTS',variant->'patch');
    select to_jsonb(a) into before_row from public.walls_production_assignments a where a.assignment_id=assignment;
    select count(*) into before_events from public.walls_production_events e where e.assignment_id=assignment;
    perform test_workflow.rejects(format('select public.advance_walls_production_stage(%L::uuid,%L)',assignment,'setup_in_progress'),
      'not released','release fails closed: '||(variant->>'label'));
    perform test_workflow.assert((select to_jsonb(a)=before_row from public.walls_production_assignments a where a.assignment_id=assignment)
      and (select count(*)=before_events from public.walls_production_events e where e.assignment_id=assignment),
      'rejected release preserves assignment/version/events: '||(variant->>'label'));
  end loop;
  perform test_workflow.patch('walls','TEST-RELEASE-VARIANTS',
    '{"planReview":{"stages":{"approvedProduction":{"status":"Complete","date":"2026-10-21"}}}}');
  result:=public.advance_walls_production_stage(assignment,'setup_in_progress',1);
  perform test_workflow.assert(result->>'stage'='setup_in_progress','valid Complete release permits first stage');
  result:=public.report_walls_production_issue(assignment,'Drawing questions','TEST explicit hold is preserved');
  hold_id:=(result->>'issue_id')::bigint;
  perform test_workflow.rejects(format('select public.advance_walls_production_stage(%L::uuid,%L)',assignment,'setup_complete'),
    'production hold','valid release does not bypass an existing hold');
  perform public.resolve_walls_production_issue(hold_id,'TEST hold resolved before independent release withdrawal test');
  perform test_workflow.patch('walls','TEST-RELEASE-VARIANTS','{"planReview":{"stages":{}}}');
  select to_jsonb(a) into before_row from public.walls_production_assignments a where a.assignment_id=assignment;
  select count(*) into before_events from public.walls_production_events e where e.assignment_id=assignment;
  perform test_workflow.rejects(format('select public.advance_walls_production_stage(%L::uuid,%L)',assignment,'setup_complete'),
    'not released','withdrawing release after setup blocks the next stage');
  perform test_workflow.assert((select to_jsonb(a)=before_row from public.walls_production_assignments a where a.assignment_id=assignment)
    and (select count(*)=before_events from public.walls_production_events e where e.assignment_id=assignment),
    'withdrawn release preserves assignment/version/events');
end $$;
rollback;
reset role;
