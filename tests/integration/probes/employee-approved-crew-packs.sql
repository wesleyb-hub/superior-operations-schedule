-- SYNTHETIC DISPOSABLE DATABASE ONLY. Run after walls-workflow-cases.sql.
-- Actual functions, default privileges and RLS execute; every fixture rolls back.
\set ON_ERROR_STOP on
do $$ begin
 if current_database()<>'superior_workflow_test' or to_regprocedure('test_workflow.assert(boolean,text)') is null then
  raise exception 'Refusing non-disposable database or missing synthetic test fixture';
 end if;
end $$;
begin;
insert into auth.users(id,email) select ('00000000-0000-4000-8000-0000000000'||n)::uuid,'crew-test-'||n||'@example.invalid' from generate_series(61,69) n;
insert into public.app_employee_access(user_id,profile_key,division_key,inventory_area,legal_entity,allowed_views,enabled) values
 ('00000000-0000-4000-8000-000000000061','walls_inventory_counter','walls','production','Superior Walls of North Dakota, LLC','{weekly-planner}',true),
 ('00000000-0000-4000-8000-000000000062','plant_manager_readonly','walls','production','Superior Walls of North Dakota, LLC','{overview,walls,inventory,weekly-planner}',true),
 ('00000000-0000-4000-8000-000000000063','walls_inventory_counter','walls','production','Superior Walls of North Dakota, LLC','{weekly-planner}',false),
 ('00000000-0000-4000-8000-000000000064','walls_inventory_counter','boxes','production','Superior Precast Structures, LLC','{weekly-planner}',true),
 ('00000000-0000-4000-8000-000000000065','walls_inventory_counter','walls','install','Superior Walls of North Dakota, LLC','{weekly-planner}',true),
 ('00000000-0000-4000-8000-000000000066','walls_inventory_counter','walls','production','Superior Walls of North Dakota, LLC','{overview,walls,inventory}',true),
 ('00000000-0000-4000-8000-000000000067','walls_inventory_counter','walls','production','Superior Walls of North Dakota, LLC','{overview}',true),
 ('00000000-0000-4000-8000-000000000067','walls_inventory_counter','boxes','production','Superior Precast Structures, LLC','{weekly-planner}',true);
-- An independent supervisor keeps the original planner authorization/behavior.
insert into public.weekly_planner_access(user_id,can_view,can_edit,can_approve,can_publish,allowed_sections) values
 ('00000000-0000-4000-8000-000000000068',true,false,false,false,'{walls_production}');

select test_workflow.assert(not has_function_privilege('anon','public.get_employee_approved_crew_packs(date)','execute'),'anon has no endpoint execute');
select test_workflow.assert(not has_function_privilege('anon','employee_pack_private.approved_crew_packs(date)','execute'),'anon has no private endpoint execute');
select test_workflow.assert(not has_function_privilege('authenticated','employee_pack_private.pack_text(jsonb,text)','execute'),'projection helper is not a client API');
select test_workflow.assert((select not prosecdef from pg_proc where oid='public.get_employee_approved_crew_packs(date)'::regprocedure),'public wrapper is SECURITY INVOKER');
select test_workflow.assert((select prosecdef and proconfig=array['search_path=pg_catalog'] from pg_proc where oid='employee_pack_private.approved_crew_packs(date)'::regprocedure),'private definer has pinned safe search_path');

-- A synthetic production source is created before approval, through the real
-- assignment RPC. This allows a true publish -> source mutation freshness probe.
insert into public.schedule_records(collection,record_id,division,data) values
 ('walls','TEST-CREW-SOURCE-001','walls','{"id":"TEST-CREW-SOURCE-001","job":"TEST-CREW-SOURCE","lf":40,"lfByHeight":{"h8":40},"status":"Active"}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',true);
select public.upsert_walls_production_assignment(null,'TEST-CREW-SOURCE-001','9001',8,40,'2027-01-04 07:00','2027-01-04 15:00','2027-01-05 07:00','TEST source only');
select public.generate_weekly_planner('2027-01-04');
do $$ declare s record; begin
 for s in select * from public.weekly_planner_sections where week_start='2027-01-04' order by section_key loop
  perform public.save_weekly_planner_section(s.section_id,s.schedule_version,'TEST leader '||s.section_key,
   jsonb_build_array(jsonb_build_object('name','TEST crew '||s.section_key,'is_leader',true)),
   jsonb_build_array(jsonb_build_object('work_date','2027-01-04','project_location','TEST location '||s.section_key,
    'assignment_text','TEST duty '||s.section_key,'start_time','07:00','status_hold','TEST safety note',
    'backup_instructions','TEST fallback','readiness_status','confirmed')));
 end loop;
 for s in select * from public.weekly_planner_sections where week_start='2027-01-04' order by section_key loop
  perform public.approve_weekly_planner_section(s.section_id,s.schedule_version);
 end loop;
 perform test_workflow.assert(public.publish_weekly_planner_pack('2027-01-04')->>'pack_id' is not null,'admin can still generate, save, approve and publish real pack');
end $$;
reset role;
-- Add hostile/unknown payload fields without touching the approved field/version gates.
-- No real business record is ever copied into this fixture.
update public.weekly_planner_packs p set snapshot=p.snapshot||jsonb_build_object('private_root','LEAK_ROOT','resources',jsonb_build_array(jsonb_build_object('private','LEAK_RESOURCE')),
 'sections',(select jsonb_agg(x||jsonb_build_object('private_section_wrapper','LEAK_WRAPPER','section',(x->'section')||'{"private":"LEAK_SECTION","pay_rate":99}'::jsonb,
  'people',(select jsonb_agg(y||'{"private":"LEAK_PERSON","email":"LEAK_EMAIL"}'::jsonb) from jsonb_array_elements(x->'people') y),
  'assignments',(select jsonb_agg(y||'{"private":"LEAK_ASSIGNMENT","readiness_status":"LEAK_READINESS","source_id":"LEAK_SOURCE","updated_by":"LEAK_ACTOR"}'::jsonb) from jsonb_array_elements(x->'assignments') y)))
  from jsonb_array_elements(p.snapshot->'sections') x)) where week_start='2027-01-04';
create temporary table crew_test_pack as select * from public.weekly_planner_packs where week_start='2027-01-04';
create temporary table crew_test_before as select md5(string_agg(data::text,'|' order by name)) digest from (
 select 'packs' name,jsonb_agg(to_jsonb(p) order by pack_id) data from public.weekly_planner_packs p
 union all select 'weeks',jsonb_agg(to_jsonb(w) order by week_start) from public.weekly_planner_weeks w
 union all select 'sections',jsonb_agg(to_jsonb(s) order by section_id) from public.weekly_planner_sections s
 union all select 'audit',jsonb_agg(to_jsonb(a) order by audit_id) from public.weekly_planner_audit a
) q;

select set_config('test.crew_section_id',(select section_id::text from public.weekly_planner_sections where week_start='2027-01-04' and section_key='walls_production'),true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
do $$ declare result jsonb; s jsonb; keys text[]; t text; begin
 result:=public.get_employee_approved_crew_packs('2027-01-04');
 perform test_workflow.assert(jsonb_array_length(result->'packs')=1,'opt-in inventory-counter profile receives one active approved division pack');
 perform test_workflow.assert(result#>'{permissions}'='{"view":true,"edit":false,"approve":false,"publish":false}'::jsonb,'endpoint is explicitly read-only');
 perform test_workflow.assert(jsonb_array_length(result#>'{packs,0,snapshot,sections}')=3,'only three Walls production sections are returned');
 select array_agg(x#>>'{section,section_key}' order by x#>>'{section,section_key}') into keys from jsonb_array_elements(result#>'{packs,0,snapshot,sections}') x;
 perform test_workflow.assert(keys=array['table_flow','walls_production','walls_stripping_loading'],'exact section scope excludes all five other crews/divisions');
 perform test_workflow.assert(result::text not like '%LEAK_%' and result::text not like '%readiness%' and result::text not like '%source_fingerprint%' and result::text not like '%published_by%' and result::text not like '%approved_by%' and result::text not like '%schedule_version%','no root/row metadata, private fields, readiness or actor/source data leak');
 perform test_workflow.assert(result::text not like '%installation_stone%' and result::text not like '%box_precast_support%' and result::text not like '%logistics_cranes%' and result::text not like '%quality_control%' and result::text not like '%maintenance_plant%','no other crew strings leak through nested arrays');
 for s in select value from jsonb_array_elements(result#>'{packs,0,snapshot,sections}') loop
  perform test_workflow.assert(s#>>'{section,status}'='approved' and jsonb_array_length(s->'people')=1 and jsonb_array_length(s->'assignments')=1,'approved section keeps operational people and duty');
 end loop;
 perform test_workflow.assert(public.get_app_access()->'allowed_views' ? 'weekly-planner','app navigation opt-in does not need planner permission');
 perform test_workflow.assert(not public.weekly_planner_permission('view') and not public.weekly_planner_permission('edit') and not public.weekly_planner_permission('approve') and not public.weekly_planner_permission('publish'),'navigation opt-in grants NO planner capability');
 perform test_workflow.rejects($q$select public.get_weekly_planner_snapshot('2027-01-04')$q$,'access required','cannot bypass via full planner snapshot');
 perform test_workflow.assert(public.get_weekly_planner_agent_context()->>'authorized'='false','assistant planner context remains denied');
 perform test_workflow.rejects($q$select public.weekly_planner_source_fingerprint('2027-01-04')$q$,'permission denied','cannot bypass via source fingerprint');
 perform test_workflow.rejects($q$select public.generate_weekly_planner('2027-01-04')$q$,'access required','generation still denied');
 perform test_workflow.rejects($q$select public.save_weekly_planner_inputs('2027-01-04','[]','[]')$q$,'access required','input mutation still denied');
 perform test_workflow.rejects(format('select public.save_weekly_planner_section(%L,1,%L,%L,%L)',current_setting('test.crew_section_id'),'TEST forbidden','[]','[]'),'access required','section save denied even with known real ID');
 perform test_workflow.rejects(format('select public.approve_weekly_planner_section(%L,1)',current_setting('test.crew_section_id')),'access required','section approval denied even with known real ID');
 perform test_workflow.rejects($q$select public.publish_weekly_planner_pack('2027-01-04')$q$,'access required','publication still denied');
 perform test_workflow.rejects($q$select public.rebuild_weekly_planner_conflicts('2027-01-04')$q$,'permission denied','internal mutation still denied');
 foreach t in array array['weekly_planner_weeks','weekly_planner_sections','weekly_planner_section_people','weekly_planner_assignments','weekly_planner_availability','weekly_planner_resources','weekly_planner_conflicts','weekly_planner_section_revisions','weekly_planner_packs','weekly_planner_source_snapshots','weekly_planner_audit','weekly_planner_access'] loop
  execute format('select test_workflow.assert(not exists(select 1 from public.%I),%L)',t,'direct REST-style read blocked: '||t);
 end loop;
 perform test_workflow.rejects($q$update public.weekly_planner_packs set is_active=false where week_start='2027-01-04'$q$,'permission denied','direct packet mutation denied');
 perform test_workflow.rejects($q$update public.app_employee_access set allowed_views='{weekly-planner}'$q$,'permission denied','cannot self-grant scopes');
 perform test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-11')->'packs'='[]'::jsonb,'unpublished week returns no pack');
 perform test_workflow.rejects($q$select public.get_employee_approved_crew_packs(null)$q$,'Monday','null week fails closed');
 perform test_workflow.rejects($q$select public.get_employee_approved_crew_packs('2027-01-05')$q$,'Monday','non-Monday week fails closed');
end $$;
-- The second existing employee profile is not special-cased or accidentally denied.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000062","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=1,'opt-in plant-manager-readonly profile receives same scoped projection');
-- All denied scope variants, including split grants, exercise both public/private calls.
do $$ declare n integer; begin
 for n in 63..69 loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-0000000000'||n,'role','authenticated')::text,true);
  perform test_workflow.rejects($q$select public.get_employee_approved_crew_packs('2027-01-04')$q$,'access required','disabled/wrong division/wrong area/no opt-in/split grant/supervisor-only/unassigned denied '||n);
  perform test_workflow.rejects($q$select employee_pack_private.approved_crew_packs('2027-01-04')$q$,'access required','private direct call has same scope gate '||n);
 end loop;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated","is_anonymous":true}',true);
select test_workflow.rejects($q$select public.get_employee_approved_crew_packs('2027-01-04')$q$,'access required','anonymous Auth user denied even with accidental row');
select set_config('request.jwt.claims','{"role":"authenticated","user_metadata":{"division_key":"walls","allowed_views":["weekly-planner"]}}',true);
select test_workflow.rejects($q$select public.get_employee_approved_crew_packs('2027-01-04')$q$,'access required','missing UID/user-editable metadata cannot grant authority');
reset role;
set local role anon;
do $$ declare caught text; begin
 begin perform public.get_employee_approved_crew_packs('2027-01-04'); exception when insufficient_privilege then caught:=sqlerrm; end;
 if caught is null then raise exception 'anonymous call unexpectedly succeeded'; end if;
end $$;
reset role;
select test_workflow.assert((select digest from crew_test_before)=(select md5(string_agg(data::text,'|' order by name)) from (
 select 'packs' name,jsonb_agg(to_jsonb(p) order by pack_id) data from public.weekly_planner_packs p
 union all select 'weeks',jsonb_agg(to_jsonb(w) order by week_start) from public.weekly_planner_weeks w
 union all select 'sections',jsonb_agg(to_jsonb(s) order by section_id) from public.weekly_planner_sections s
 union all select 'audit',jsonb_agg(to_jsonb(a) order by audit_id) from public.weekly_planner_audit a
) q),'all read and denied mutation calls leave planner state and audit unchanged');

-- Change only synthetic fixture state as owner to probe publication/approval guards.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
update public.weekly_planner_packs set is_active=false where week_start='2027-01-04';
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'inactive historical pack excluded');
update public.weekly_planner_packs set is_active=true where week_start='2027-01-04';
update public.weekly_planner_weeks set status='reapproval_required' where week_start='2027-01-04';
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'reapproval-required week excluded');
update public.weekly_planner_weeks set status='draft' where week_start='2027-01-04';
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'draft week excluded despite active flag');
update public.weekly_planner_weeks set status='approved' where week_start='2027-01-04';
update public.weekly_planner_sections set status='draft' where week_start='2027-01-04' and section_key='walls_production';
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'current unapproved section excludes pack');
update public.weekly_planner_sections set status='approved',schedule_version=schedule_version+1 where week_start='2027-01-04' and section_key='walls_production';
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'changed approval version excludes pack');
update public.weekly_planner_sections set schedule_version=schedule_version-1 where week_start='2027-01-04' and section_key='walls_production';
update public.weekly_planner_packs set snapshot=jsonb_set(snapshot,'{sections,0,section,status}','"draft"') where week_start='2027-01-04';
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'frozen unapproved section excludes pack');
update public.weekly_planner_packs set snapshot=(select snapshot from crew_test_pack) where week_start='2027-01-04';
update public.weekly_planner_packs set snapshot=jsonb_set(snapshot,'{sections}','{}') where week_start='2027-01-04';
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'malformed sections fail closed without exposing JSON');
update public.weekly_planner_packs set snapshot=(select snapshot from crew_test_pack) where week_start='2027-01-04';
update public.weekly_planner_packs set snapshot=jsonb_set(jsonb_set(snapshot,'{sections,0,assignments,0,project_location}','{"private":"LEAK_NESTED"}'),'{sections,0,people,0,employee_name}','{"private":"LEAK_NESTED"}') where week_start='2027-01-04';
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')::text not like '%LEAK_%','object/array under an allowlisted string key is never serialized into output');
update public.weekly_planner_packs set snapshot=(select snapshot from crew_test_pack) where week_start='2027-01-04';
insert into public.weekly_planner_packs(week_start,pack_version,source_fingerprint,snapshot,published_by_user_id,published_by_email) select week_start,pack_version+1,source_fingerprint,snapshot,published_by_user_id,published_by_email from crew_test_pack;
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'ambiguous multiple active packs fail closed');
delete from public.weekly_planner_packs where week_start='2027-01-04' and pack_version>(select pack_version from crew_test_pack);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000068","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_weekly_planner_snapshot('2027-01-04')->'sections')=8,'independently authorized supervisor retains existing full planner read behavior');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select test_workflow.assert(public.weekly_planner_permission('edit') and public.weekly_planner_permission('approve') and public.weekly_planner_permission('publish'),'existing admin capabilities retained');

-- The old publication flags alone do NOT detect every production source change.
-- Mutate through the actual manager RPC and verify the endpoint's live hash gate.
do $$ declare a public.walls_production_assignments%rowtype; begin
 select * into a from public.walls_production_assignments where wall_record_id='TEST-CREW-SOURCE-001';
 perform public.upsert_walls_production_assignment(a.assignment_id,a.wall_record_id,a.table_id,a.wall_height,a.planned_lf,
  a.setup_start_at+interval '1 hour',a.pour_at,a.strip_at,'TEST changed setup',a.version);
 perform test_workflow.assert((select is_active from public.weekly_planner_packs where week_start='2027-01-04')
  and (select status='approved' from public.weekly_planner_weeks where week_start='2027-01-04'),
  'regression fixture confirms source change leaves historical active/approved flags intact');
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'real production source change hides otherwise active approved pack');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.generate_weekly_planner('2027-01-04');
do $$ declare s record; begin
 for s in select * from public.weekly_planner_sections where week_start='2027-01-04' order by section_key loop
  perform public.save_weekly_planner_section(s.section_id,s.schedule_version,'TEST renewed '||s.section_key,
   jsonb_build_array(jsonb_build_object('name','TEST renewed '||s.section_key,'is_leader',true)),'[]');
 end loop;
 for s in select * from public.weekly_planner_sections where week_start='2027-01-04' order by section_key loop
  perform public.approve_weekly_planner_section(s.section_id,s.schedule_version);
 end loop;
 perform public.publish_weekly_planner_pack('2027-01-04');
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=1,'fresh reapproved republished pack becomes visible again');
do $$ declare started timestamptz:=clock_timestamp(); i integer; begin
 for i in 1..25 loop perform public.get_employee_approved_crew_packs('2027-01-04'); end loop;
 raise notice 'PERF: 25 authorized reads with pure source hash, synthetic fixture total ms=%',round(extract(epoch from clock_timestamp()-started)*1000,2);
end $$;
reset role;
-- Source revision-only drift also fails closed; no broad source data is returned.
update public.schedule_meta set revision=revision+1 where id=1;
set local role authenticated;
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'master source revision drift hides approved pack');
reset role;
update public.schedule_meta set revision=revision-1 where id=1;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare s public.weekly_planner_sections%rowtype; begin
 select * into s from public.weekly_planner_sections where week_start='2027-01-04' and section_key='walls_production';
 perform public.save_weekly_planner_section(s.section_id,s.schedule_version,'TEST changed draft','[{"name":"TEST draft crew","is_leader":true}]','[]');
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'real current section draft save hides all prior publication content');
reset role;
rollback;
select 'PASS: employee approved-division-pack allow/deny matrix; synthetic fixtures rolled back' as result;
