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
-- Mutate through the actual manager RPC and verify the endpoint's planned-data gate.
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
-- Scoped freshness: legacy source snapshots are read, never migrated/backfilled.
select test_workflow.assert(not has_function_privilege('authenticated','employee_pack_private.production_plan_matches(date,text,timestamptz)','execute'),'planned-data helper is not a new client API');
reset role;

-- Explicit duplicate-source defense even if a legacy schema has lost uniqueness.
savepoint planned_freshness_case;
do $$ declare c text; begin
 select conname into strict c from pg_constraint where conrelid='public.weekly_planner_source_snapshots'::regclass and contype='u';
 execute format('alter table public.weekly_planner_source_snapshots drop constraint %I',c);
end $$;
insert into public.weekly_planner_source_snapshots(week_start,source_revision,source_fingerprint,source_data,created_by,created_at)
 select s.week_start,s.source_revision,s.source_fingerprint,s.source_data,'synthetic',s.created_at
 from public.weekly_planner_source_snapshots s join public.weekly_planner_packs p using(week_start,source_fingerprint)
 where p.week_start='2027-01-04' and p.is_active;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'duplicate legacy source snapshots fail closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- Table identity is planned work, not a presentation sort/version field.
savepoint planned_freshness_case;
insert into public.walls_production_tables(table_id,label,capacity_lf) values('TEST-FRESHNESS-TABLE','TEST other table',150);
update public.walls_production_assignments set table_id='TEST-FRESHNESS-TABLE' where wall_record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'planned table change requires review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- Nonfinite numeric JSON serializes as a string, even when both rows match.
savepoint planned_freshness_case;
alter table public.walls_production_assignments disable trigger walls_production_assignment_validate;
update public.walls_production_assignments set planned_lf='NaN'::numeric where wall_record_id='TEST-CREW-SOURCE-001';
update public.weekly_planner_source_snapshots set source_data=jsonb_set(source_data,'{walls_production,0,planned_lf}',to_jsonb('NaN'::numeric))
 where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'matching malformed current and historical NaN LF fail closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- Nonfinite numeric JSON serializes as a string, even when both rows match.
savepoint planned_freshness_case;
alter table public.walls_production_assignments disable trigger walls_production_assignment_validate;
update public.walls_production_assignments set planned_lf='Infinity'::numeric where wall_record_id='TEST-CREW-SOURCE-001';
update public.weekly_planner_source_snapshots set source_data=jsonb_set(source_data,'{walls_production,0,planned_lf}',to_jsonb('Infinity'::numeric))
 where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(public.get_employee_approved_crew_packs('2027-01-04')->'packs'='[]'::jsonb,'matching malformed current and historical Infinity LF fail closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- missing legacy source snapshot fails closed
savepoint planned_freshness_case;
delete from public.weekly_planner_source_snapshots where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'missing legacy source snapshot fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- legacy baseline after publication fails closed
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set created_at=now()+interval '1 day' where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'legacy baseline after publication fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- missing baseline array fails closed
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=source_data-'walls_production' where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'missing baseline array fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- non-array baseline fails closed
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(source_data,'{walls_production}','{}') where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'non-array baseline fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- duplicate baseline assignment IDs fails closed
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(source_data,'{walls_production}',(source_data->'walls_production')||(source_data#>'{walls_production,0}')) where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'duplicate baseline assignment IDs fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- missing planned baseline key fails closed
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(source_data,'{walls_production,0}',(source_data#>'{walls_production,0}')-'pour_at') where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'missing planned baseline key fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- object planned timestamp fails closed
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(source_data,'{walls_production,0,pour_at}','{"private":"LEAK_FRESHNESS"}') where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'object planned timestamp fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- invalid timestamp fails closed
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(source_data,'{walls_production,0,pour_at}','"not a date"') where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'invalid timestamp fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- nonfinite timestamp fails closed
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(source_data,'{walls_production,0,pour_at}','"infinity"') where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'nonfinite timestamp fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- numeric-string LF fails closed
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(source_data,'{walls_production,0,planned_lf}','"40"') where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'numeric-string LF fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- cancelled historical baseline fails closed
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(source_data,'{walls_production,0,stage}','"cancelled"') where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'cancelled historical baseline fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- unknown historical stage fails closed
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(source_data,'{walls_production,0,stage}','"invalid"') where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'unknown historical stage fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- malformed historical review flag fails closed
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(source_data,'{walls_production,0,needs_review}','{}') where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'malformed historical review flag fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- unrelated source snapshot keys are ignored
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=source_data||'{"private":"LEAK_FRESHNESS"}'::jsonb where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=1,'unrelated source snapshot keys are ignored');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- The new comparison itself is independent of timestamp presentation. Existing
-- endpoint date-text checks deliberately remain unchanged in this narrow patch.
savepoint planned_freshness_case;
set local timezone='Pacific/Honolulu';set local datestyle='SQL, DMY';
select test_workflow.assert((select employee_pack_private.production_plan_matches(week_start,source_fingerprint,published_at) from public.weekly_planner_packs where week_start=date '2027-01-04' and is_active),'planned comparison is timezone/DateStyle independent');
rollback to planned_freshness_case;
release planned_freshness_case;

-- unrelated other-division master rows do not hide a valid plan
savepoint planned_freshness_case;
insert into public.schedule_records(collection,record_id,division,data) values ('jobs','TEST-UNRELATED-BOX','boxes','{"products":[{"plannedDate":"2027-01-04","private":"LEAK_FRESHNESS"}]}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=1,'unrelated other-division master rows do not hide a valid plan');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- unrelated master metadata does not hide a valid plan
savepoint planned_freshness_case;
update public.schedule_records set data=data||'{"privateNote":"LEAK_FRESHNESS","job":"TEST revised descriptive label"}'::jsonb where record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=1,'unrelated master metadata does not hide a valid plan');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- planned setup_start_at change requires review
savepoint planned_freshness_case;
update public.walls_production_assignments set setup_start_at=setup_start_at+interval '1 minute' where wall_record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'planned setup_start_at change requires review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- planned pour_at change requires review
savepoint planned_freshness_case;
update public.walls_production_assignments set pour_at=pour_at+interval '1 minute' where wall_record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'planned pour_at change requires review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- planned strip_at change requires review
savepoint planned_freshness_case;
update public.walls_production_assignments set strip_at=strip_at+interval '1 hour' where wall_record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'planned strip_at change requires review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- planned planned_lf change requires review
savepoint planned_freshness_case;
update public.walls_production_assignments set planned_lf=39 where wall_record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'planned planned_lf change requires review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- planned wall_height change requires review
savepoint planned_freshness_case;
update public.walls_production_assignments set wall_height=9 where wall_record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'planned wall_height change requires review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- move out of requested week requires review
savepoint planned_freshness_case;
update public.walls_production_assignments set setup_start_at=setup_start_at+interval '7 days',pour_at=pour_at+interval '7 days',strip_at=strip_at+interval '7 days' where wall_record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'move out of requested week requires review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- new explicit production review hold requires review
savepoint planned_freshness_case;
update public.walls_production_assignments set needs_review=true,review_reason='TEST changed planned context' where wall_record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'new explicit production review hold requires review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- already-approved hold is not newly stale
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(jsonb_set(source_data,'{walls_production,0,needs_review}','true'),'{walls_production,0,review_reason}','"TEST approved hold"') where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
update public.walls_production_assignments set needs_review=true,review_reason='TEST approved hold' where wall_record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=1,'already-approved hold is not newly stale');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- changed reason on an approved hold requires review
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(jsonb_set(source_data,'{walls_production,0,needs_review}','true'),'{walls_production,0,review_reason}','"TEST approved hold"') where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
update public.walls_production_assignments set needs_review=true,review_reason='TEST new hold' where wall_record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'changed reason on an approved hold requires review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- cleared approved hold does not rewrite the frozen plan
savepoint planned_freshness_case;
update public.weekly_planner_source_snapshots set source_data=jsonb_set(jsonb_set(source_data,'{walls_production,0,needs_review}','true'),'{walls_production,0,review_reason}','"TEST approved hold"') where week_start='2027-01-04' and source_fingerprint=(select source_fingerprint from public.weekly_planner_packs where week_start='2027-01-04' and is_active);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=1,'cleared approved hold does not rewrite the frozen plan');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- current wrong-division baseline target fails closed
savepoint planned_freshness_case;
update public.schedule_records set division='boxes' where record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'current wrong-division baseline target fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- current null-division baseline target fails closed
savepoint planned_freshness_case;
update public.schedule_records set division=null where record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'current null-division baseline target fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- job reassignment requires review
savepoint planned_freshness_case;
insert into public.schedule_records(collection,record_id,division,data) values ('walls','TEST-NEW-PLAN','walls','{"job":"TEST new","lf":40,"lfByHeight":{"h8":40}}');
update public.walls_production_assignments set wall_record_id='TEST-NEW-PLAN' where wall_record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'job reassignment requires review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- new production assignment requires review
savepoint planned_freshness_case;
insert into public.schedule_records(collection,record_id,division,data) values ('walls','TEST-NEW-PLAN','walls','{"job":"TEST new","lf":40,"lfByHeight":{"h8":40}}');
insert into public.walls_production_assignments(wall_record_id,table_id,wall_height,planned_lf,setup_start_at,pour_at,strip_at,created_by,updated_by) values ('TEST-NEW-PLAN','9001',8,40,'2027-01-06 07:00','2027-01-06 15:00','2027-01-07 07:00','synthetic','synthetic');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'new production assignment requires review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- new wrong-division production target fails closed
savepoint planned_freshness_case;
insert into public.schedule_records(collection,record_id,division,data) values ('walls','TEST-NEW-PLAN','boxes','{"job":"TEST new","lf":40,"lfByHeight":{"h8":40}}');
insert into public.walls_production_assignments(wall_record_id,table_id,wall_height,planned_lf,setup_start_at,pour_at,strip_at,created_by,updated_by) values ('TEST-NEW-PLAN','9001',8,40,'2027-01-06 07:00','2027-01-06 15:00','2027-01-07 07:00','synthetic','synthetic');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'new wrong-division production target fails closed');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- outside-week production does not hide this plan
savepoint planned_freshness_case;
insert into public.schedule_records(collection,record_id,division,data) values ('walls','TEST-NEW-PLAN','walls','{"job":"TEST new","lf":40,"lfByHeight":{"h8":40}}');
insert into public.walls_production_assignments(wall_record_id,table_id,wall_height,planned_lf,setup_start_at,pour_at,strip_at,created_by,updated_by) values ('TEST-NEW-PLAN','9001',8,40,'2027-01-13 07:00','2027-01-13 15:00','2027-01-14 07:00','synthetic','synthetic');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=1,'outside-week production does not hide this plan');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- deleted planned assignment requires review
savepoint planned_freshness_case;
delete from public.walls_production_events where assignment_id in (select assignment_id from public.walls_production_assignments where wall_record_id='TEST-CREW-SOURCE-001');
delete from public.walls_production_assignments where wall_record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'deleted planned assignment requires review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- real manager cancellation requires renewed review
savepoint planned_freshness_case;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.cancel_walls_production_assignment((select assignment_id from public.walls_production_assignments where wall_record_id='TEST-CREW-SOURCE-001'),'TEST cancelled planned work');reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'real manager cancellation requires renewed review');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- existing installation invalidation remains authoritative
savepoint planned_freshness_case;
set local role authenticated;select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.save_walls_installation_activity(null,'TEST-CREW-SOURCE-001','site_preparation','2027-01-04','07:00','09:00','planned',null,'TEST separate approved management invalidation');reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=0,'existing installation invalidation remains authoritative');
reset role;
rollback to planned_freshness_case;
release planned_freshness_case;

-- Real manager progress updates all execution fields and versions, but must not
-- silently withdraw the already-approved work plan. Cancellation after starting
-- remains forbidden by the existing writer, not reinterpreted as completion.
savepoint planned_progress;
update public.schedule_records set data=data||'{"planReview":{"stages":{"approvedProduction":{"status":"Complete"}}}}'::jsonb where record_id='TEST-CREW-SOURCE-001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare a uuid; stage text; begin
 select assignment_id into a from public.walls_production_assignments where wall_record_id='TEST-CREW-SOURCE-001';
 foreach stage in array array['setup_in_progress','setup_complete','ready_for_pour','poured','curing','stripped'] loop
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  perform public.advance_walls_production_stage(a,stage,25,39,true,'TEST normal execution');
  if stage='setup_in_progress' then perform public.update_walls_production_setup_progress(a,50,'TEST halfway'); end if;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
  perform test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=1,'real progress preserves approved plan: '||stage);
 end loop;
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform test_workflow.rejects(format('select public.cancel_walls_production_assignment(%L,%L)',a,'TEST not allowed'),'Started production history','completed production cannot be cancelled as planned work');
end $$;
reset role;
rollback to planned_progress;
release planned_progress;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000061","role":"authenticated"}',true);
do $$ declare started timestamptz:=clock_timestamp(); i integer; begin
 for i in 1..25 loop perform public.get_employee_approved_crew_packs('2027-01-04'); end loop;
 raise notice 'PERF: 25 authorized reads with scoped planned comparison, synthetic fixture total ms=%',round(extract(epoch from clock_timestamp()-started)*1000,2);
end $$;
reset role;
-- Revision-only drift is irrelevant to an unchanged approved production plan.
update public.schedule_meta set revision=revision+1 where id=1;
set local role authenticated;
select test_workflow.assert(jsonb_array_length(public.get_employee_approved_crew_packs('2027-01-04')->'packs')=1,'global master revision alone leaves approved production pack visible');
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
