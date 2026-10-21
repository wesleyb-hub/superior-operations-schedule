-- SYNTHETIC DISPOSABLE DATABASE ONLY. Exercises repository business RPCs and RLS.
-- Auth identities are local fixtures, not real Supabase users or credentials.
\set ON_ERROR_STOP on
create schema if not exists test_workflow;
grant usage on schema test_workflow to authenticated;
create or replace function test_workflow.assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERT FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
create or replace function test_workflow.rejects(statement text, fragment text, label text) returns void language plpgsql as $$
declare caught text;
begin
 begin execute statement; exception when others then caught:=sqlerrm; end;
 if caught is null then raise exception 'ASSERT FAILED: % (operation unexpectedly succeeded)',label; end if;
 if position(lower(fragment) in lower(caught))=0 then raise exception 'ASSERT FAILED: % (unexpected error: %)',label,caught; end if;
 raise notice 'PASS: % [%]',label,caught;
end $$;
create or replace function test_workflow.patch(collection text, id text, patch jsonb) returns jsonb language plpgsql as $$
declare snap jsonb; records jsonb; v_exists boolean;
begin
 snap:=public.get_schedule_snapshot();
 select coalesce(jsonb_agg(case when value->>'id'=id then value||patch else value end),'[]'::jsonb),coalesce(bool_or(value->>'id'=id),false)
 into records,v_exists from jsonb_array_elements(coalesce(snap#>array['payload','data',collection],'[]'::jsonb));
 if not v_exists then records:=records||jsonb_build_array(jsonb_build_object('id',id)||patch); end if;
 return public.save_schedule_snapshot((snap->>'revision')::bigint,jsonb_set(snap#>'{payload,data}',array[collection],records),'SYNTHETIC TEST workflow');
end $$;
grant execute on all functions in schema test_workflow to authenticated;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',false);
do $$
declare a uuid; site uuid; stone uuid; haul uuid; install uuid; closeout uuid; row jsonb; ver bigint; issue bigint; snapshot jsonb; v_stage text;
begin
 perform test_workflow.assert(public.is_operations_admin(),'synthetic admin identity has actual admin permissions');
 perform test_workflow.patch('walls','TEST-E2E-WALL-001','{"job":"TEST-E2E-001","customer":"SYNTHETIC TEST ONLY","name":"TEST full lifecycle","lf":120,"lfByHeight":{"h8":120},"status":"Active","planReview":{"stages":{"approvedProduction":{"status":"Not Started"}}}}');
 perform test_workflow.rejects($q$select test_workflow.patch('walls','TEST-E2E-WALL-001','{"productionDate":"2026-10-26"}')$q$,'Production Date requires','production scheduling rejects missing approval');
 foreach v_stage in array array['permitPackage','preliminarySubmittal','finalSubmittal','structuralReview','productionDrawings','installDrawings','approvedProduction'] loop
  select data->'planReview' into row from public.schedule_records where collection='walls' and record_id='TEST-E2E-WALL-001';
  row:=jsonb_set(row,array['stages',v_stage],jsonb_build_object('status','Complete','date','2026-10-21','note','SYNTHETIC TEST milestone verified'));
  perform test_workflow.patch('walls','TEST-E2E-WALL-001',jsonb_build_object('planReview',row));
 end loop;
 perform test_workflow.patch('walls','TEST-E2E-WALL-001','{"productionDate":"2026-10-26","installDate":"2026-10-28"}');
 perform test_workflow.assert((select count(*)=7 from public.schedule_milestones where parent_id='TEST-E2E-WALL-001' and status='Complete'),'plan review milestones persist through actual snapshot save');
 snapshot:=public.get_schedule_snapshot();
 perform test_workflow.rejects(format('select public.save_schedule_snapshot(%s,%L::jsonb)',(snapshot->>'revision')::bigint-1,snapshot#>'{payload,data}'),'Revision conflict','stale master schedule save rejected');
 perform public.upsert_walls_production_table('TEST-TABLE-A','TEST production board A',150,true,'Synthetic test fixture');
 row:=public.upsert_walls_production_assignment(null,'TEST-E2E-WALL-001','TEST-TABLE-A',8,120,'2026-10-26 07:00','2026-10-26 15:00','2026-10-27 07:00','TEST only'); a:=(row->>'assignment_id')::uuid;
 perform test_workflow.assert(row->>'stage'='planned','120 LF assigned to real production board');
 perform test_workflow.rejects($q$select public.upsert_walls_production_assignment(null,'TEST-E2E-WALL-001','TEST-TABLE-A',8,151,'2026-11-02 07:00','2026-11-02 15:00','2026-11-03 07:00')$q$,'table capacity','configured production board capacity enforced');
 perform test_workflow.rejects($q$select public.upsert_walls_production_assignment(null,'TEST-E2E-WALL-001','TEST-TABLE-A',8,1,'2026-11-02 07:00','2026-11-02 15:00','2026-11-03 07:00')$q$,'authoritative job linear footage','sequential allocations cannot exceed job total');
 perform test_workflow.rejects(format('select public.upsert_walls_production_assignment(%L::uuid,%L,%L,8,120,%L::timestamp,%L::timestamp,%L::timestamp,%L,999)',a,'TEST-E2E-WALL-001','TEST-TABLE-A','2026-10-26 07:00','2026-10-26 15:00','2026-10-27 07:00','TEST'),'version conflict','assignment stale version rejected');
 perform test_workflow.rejects(format('select public.advance_walls_production_stage(%L::uuid,%L)',a,'poured'),'advance in order','production cannot skip setup');
 perform test_workflow.rejects(format('select public.set_walls_installation_qc(%L::uuid,%L)',a,'released'),'must be stripped','final QC cannot precede stripping');
 -- Field crews prepare the site while production remains planned; this is intentionally parallel.
 row:=public.save_walls_installation_activity(null,'TEST-E2E-WALL-001','site_preparation','2026-10-26','07:00','09:00','completed','[{"resource_type":"crew","resource_name":"TEST field crew","availability_status":"confirmed","readiness_status":"ready"}]','TEST parallel site grading');site:=(row->>'activity_id')::uuid;
 row:=public.save_walls_installation_activity(null,'TEST-E2E-WALL-001','stone_footing','2026-10-26','09:00','11:00','completed','[{"resource_type":"crew","resource_name":"TEST field crew","availability_status":"confirmed","readiness_status":"ready"}]','TEST stone/screed/chalk');stone:=(row->>'activity_id')::uuid;
 perform test_workflow.assert(site<>stone and (select stage='planned' from public.walls_production_assignments where assignment_id=a),'site preparation and stone footing remain separate parallel activities');
 row:=public.advance_walls_production_stage(a,'setup_in_progress',1);row:=public.update_walls_production_setup_progress(a,50,'TEST setup pairs underway');
 perform test_workflow.assert((row->>'setup_progress')::int=50,'setup progress persists');
 row:=public.report_walls_production_issue(a,'Drawing questions','TEST missing dimension hold');issue:=(row->>'issue_id')::bigint;
 perform test_workflow.rejects(format('select public.advance_walls_production_stage(%L::uuid,%L)',a,'setup_complete'),'production hold','production hold blocks stage advance');
 perform public.resolve_walls_production_issue(issue,'TEST drawing dimension verified');
 perform public.advance_walls_production_stage(a,'setup_complete');
 perform test_workflow.rejects(format('select public.advance_walls_production_stage(%L::uuid,%L)',a,'ready_for_pour'),'pre-pour readiness','pre-pour QC required');
 perform public.advance_walls_production_stage(a,'ready_for_pour',null,null,true,'TEST pre-pour inspection complete');
 perform test_workflow.rejects(format('select public.advance_walls_production_stage(%L::uuid,%L,null,121)',a,'poured'),'cannot exceed planned','overreported actual pour rejected');
 perform public.advance_walls_production_stage(a,'poured',null,120,true,'TEST pour crew complete');
 perform public.advance_walls_production_stage(a,'curing');
 perform public.advance_walls_production_stage(a,'stripped',null,null,null,'TEST next morning strip and inspection');
 perform test_workflow.assert((select stage='stripped' and actual_poured_lf=120 from public.walls_production_assignments where assignment_id=a),'all production stages persist through strip');
 perform test_workflow.patch('loads','TEST-E2E-LOAD-001','{"division":"walls","linkType":"wall","linkId":"TEST-E2E-WALL-001","status":"Scheduled","date":"2026-10-28","truck":"TEST truck"}');
 perform public.link_walls_installation_load_assignments('TEST-E2E-LOAD-001',array[a]);
 perform test_workflow.rejects($q$select test_workflow.patch('loads','TEST-E2E-LOAD-001','{"status":"Loaded"}')$q$,'QC','unreleased final QC blocks loading');
 perform public.set_walls_installation_qc(a,'hold','TEST patch needed after stripping');
 perform test_workflow.rejects($q$select test_workflow.patch('loads','TEST-E2E-LOAD-001','{"status":"Loaded"}')$q$,'QC','final QC hold blocks loading');
 perform public.set_walls_installation_qc(a,'released','TEST same final inspection, patch complete; labels/inserts/frames verified');
 row:=public.save_walls_installation_activity(null,'TEST-E2E-WALL-001','loading_hauling','2026-10-28','07:00','09:00','planned',null,'TEST driver and securement');haul:=(row->>'activity_id')::uuid;
 row:=public.set_walls_installation_activity_assignments(haul,(row->>'version')::bigint,jsonb_build_array(jsonb_build_object('assignment_id',a,'load_record_id','TEST-E2E-LOAD-001')));
 perform public.save_walls_installation_activity(haul,'TEST-E2E-WALL-001','loading_hauling','2026-10-28','07:00','09:00','in_progress',null,'TEST loading',(row->>'version')::bigint);
 perform test_workflow.rejects($q$select test_workflow.patch('loads','TEST-E2E-LOAD-001','{"status":"Delivered"}')$q$,'pass through Loaded','delivery cannot skip Loaded');
 perform test_workflow.patch('loads','TEST-E2E-LOAD-001','{"status":"Loaded"}');
 row:=public.save_walls_installation_activity(null,'TEST-E2E-WALL-001','wall_installation','2026-10-28','09:00','15:00','planned',null,'TEST set corner and brace');install:=(row->>'activity_id')::uuid;
 perform test_workflow.rejects(format('select public.set_walls_installation_activity_assignments(%L::uuid,%s,%L::jsonb)',install,(row->>'version')::bigint,jsonb_build_array(jsonb_build_object('assignment_id',a,'load_record_id','TEST-E2E-LOAD-001'))),'Delivered load','installation requires actual delivered load');
 perform test_workflow.patch('loads','TEST-E2E-LOAD-001','{"status":"Delivered"}');
 select version into ver from public.walls_installation_activities where activity_id=haul;
 perform public.save_walls_installation_activity(haul,'TEST-E2E-WALL-001','loading_hauling','2026-10-28','07:00','09:00','completed',null,'TEST delivery completed',ver);
 row:=public.set_walls_installation_activity_assignments(install,(row->>'version')::bigint,jsonb_build_array(jsonb_build_object('assignment_id',a,'load_record_id','TEST-E2E-LOAD-001')));
 row:=public.save_walls_installation_activity(install,'TEST-E2E-WALL-001','wall_installation','2026-10-28','09:00','15:00','in_progress',null,'TEST set square brace',(row->>'version')::bigint);
 perform test_workflow.rejects(format('select public.set_walls_installation_activity_assignments(%L::uuid,%s,%L::jsonb)',install,(row->>'version')::bigint,'[]'),'locked after field work starts','installation scope immutable after start');
 perform test_workflow.rejects($q$select public.save_walls_installation_job('TEST-E2E-WALL-001','{}','{"field_complete":true}')$q$,'every active production assignment installed','closeout cannot precede installation');
 row:=public.save_walls_installation_activity(install,'TEST-E2E-WALL-001','wall_installation','2026-10-28','09:00','15:00','completed',null,'TEST walls installed',(row->>'version')::bigint);
 perform test_workflow.assert((select status='completed' from public.walls_installation_jobs where wall_record_id='TEST-E2E-WALL-001'),'all installed runs complete installation job');
 perform test_workflow.rejects($q$select public.save_walls_installation_job('TEST-E2E-WALL-001','{}','{"field_complete":true,"caulking":"pending"}')$q$,'applicable closeout item complete','unfinished caulking blocks final field completion');
 row:=public.save_walls_installation_job('TEST-E2E-WALL-001','{"site_ready":true}','{"field_complete":true,"bolting":"complete","foaming":"not_required","caulking":"complete","corrections":"not_required","other":"not_required"}');
 perform test_workflow.assert((row#>>'{closeout,field_complete}')::boolean,'field closeout persisted');
 perform test_workflow.patch('walls','TEST-E2E-WALL-001','{"completedDate":"2026-10-28","completedMonth":"2026-10"}');
 snapshot:=public.get_schedule_snapshot();
 perform test_workflow.assert((select count(*)=1 from jsonb_array_elements(snapshot#>'{payload,data,walls}') j where j->>'id'='TEST-E2E-WALL-001' and j->>'completedDate'='2026-10-28'),'fresh schedule reload retains completed job');
 perform test_workflow.assert((select count(*)=6 from public.walls_production_events where assignment_id=a and event_type='stage_changed'),'all six production transitions audited once');
end $$;
-- Genuine RLS and RPC authorization: test helpers are security-invoker, not bypasses.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","email":"test-viewer@superiorwallsnd.com","role":"authenticated"}',false);
select test_workflow.assert(not public.is_operations_admin(),'reader is not administrator');
select test_workflow.rejects($q$select public.save_schedule_snapshot(0,'{}')$q$,'Read-only','read-only caller cannot change authoritative jobs');
select test_workflow.rejects($q$select public.upsert_walls_production_table('TEST-UNAUTHORIZED','TEST unauthorized',100,true)$q$,'permission required','reader cannot create production board');
select test_workflow.assert((select count(*)=0 from public.schedule_records where record_id='TEST-E2E-WALL-001'),'RLS hides raw schedule rows from non-admin reader');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003","email":"test-outsider@example.invalid","role":"authenticated"}',false);
select test_workflow.rejects('select public.get_schedule_snapshot()','Not authorized','authenticated outsider cannot read business snapshot');
select test_workflow.assert((select count(*)=0 from public.schedule_records),'RLS denies outsider raw schedule rows');
reset role;
select 'PASS: synthetic SQL lifecycle complete; no live services called' as result;
