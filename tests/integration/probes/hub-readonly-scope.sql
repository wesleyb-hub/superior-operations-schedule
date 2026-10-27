-- SYNTHETIC ONLY. Entire fixture rolls back; never run against hosted data.
do $$ begin if current_database()<>'superior_workflow_test' then raise exception 'Refusing non-test database'; end if; end $$;
begin;
create schema test_reader;
create function test_reader.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
create function test_reader.rejects(q text,label text,authority_only boolean default true) returns void language plpgsql as $$ declare caught text; begin begin execute q; exception when others then caught:=sqlerrm; end; perform test_reader.assert(caught is not null and (not authority_only or caught ~* '(permission|access required|read-only|not authorized|authentication required|Password administration unavailable)'),label||coalesce(' ['||caught||']','')); end $$;
grant usage on schema test_reader to authenticated; grant execute on all functions in schema test_reader to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000901','reader@example.invalid');
insert into public.app_employee_access(user_id,profile_key,legal_entity,division_key,inventory_area,allowed_views,allowed_wall_subviews,inventory_can_view,inventory_can_adjust,inventory_can_manage) values('00000000-0000-4000-8000-000000000901','hub_readonly_v1','Superior Walls of North Dakota, LLC','walls','production','{today,overview,walls,boxes,manholes,fence,block,qc,delivery,inventory,weekly-planner,billing,exceptions,import,audit,history,search}','{production,installation,current,overall,active,plans,monthly,year}',true,false,false);
insert into public.schedule_records(collection,record_id,division,data) select 'jobs','TEST-READER-'||d,d,jsonb_build_object('id','TEST-READER-'||d,'name','Synthetic read verification','products','[]'::jsonb) from unnest(array['boxes','manholes','fence','block']) d;
insert into public.schedule_records(collection,record_id,division,data) values('billing','TEST-READER-BILL','walls','{"id":"TEST-READER-BILL","amount":100}');
insert into public.schedule_settings(setting_key,value) values('TEST-private-secret','"NOT_FOR_READER"'),('companyEmployeeRoster','{"employees":[]}') on conflict(setting_key) do update set value=excluded.value;
insert into public.inventory_categories(category,division_key,inventory_area,legal_entity) values('TEST-READER','walls','production','Superior Walls of North Dakota, LLC');
insert into public.inventory_items(titan_code,description,category,unit,quantity,reorder_threshold,ordered,division_key,inventory_area,legal_entity) values('TEST-READER-ITEM','Synthetic readonly denial material','TEST-READER','pieces',10,2,false,'walls','production','Superior Walls of North Dakota, LLC');
select set_config('test.reader_item',(select item_id::text from public.inventory_items where titan_code='TEST-READER-ITEM'),true);
select set_config('test.reader_item_version',(select version::text from public.inventory_items where titan_code='TEST-READER-ITEM'),true);
select set_config('test.reader_assignment',coalesce((select assignment_id::text from public.walls_production_assignments order by assignment_id limit 1),''),true);
select test_reader.assert(current_setting('test.reader_assignment')<>'','workflow prerequisite provides a real production assignment');
insert into public.schedule_settings(setting_key,value) values ('migrationBackup','{"sentinel":"PRIVATE_LEGACY_NOT_FOR_READER"}'),('systemFlags','{"sentinel":"PRIVATE_FLAGS_NOT_FOR_READER"}') on conflict(setting_key) do update set value=excluded.value;
insert into public.operations_agent_actions(action_id,requested_by_user_id,requested_by_email,request_text,action_type,parameters,summary,idempotency_key,expires_at) values('00000000-0000-4000-8900-000000000901','00000000-0000-4000-8000-000000000901','reader@example.invalid','Synthetic old pending','set_inventory_count','{}','Synthetic only','TEST-READER-PENDING',now()-interval '1 minute');
create function test_reader.state_digest() returns text language plpgsql security definer set search_path=pg_catalog as $$ declare r record; v text; result text:=''; begin for r in select tablename from pg_tables where schemaname='public' order by tablename loop execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text from public.%I t',r.tablename) into v; result:=result||r.tablename||v; end loop; return md5(result); end $$;
revoke all on function test_reader.state_digest() from public; grant execute on function test_reader.state_digest() to authenticated;
select set_config('test.reader_before',test_reader.state_digest(),true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',true);
set local role authenticated;
select public.generate_weekly_planner('2026-11-09');
reset role;
select set_config('test.reader_section',(select section_id::text from public.weekly_planner_sections where week_start='2026-11-09' order by section_key limit 1),true);
select set_config('test.reader_section_version',(select schedule_version::text from public.weekly_planner_sections where section_id=current_setting('test.reader_section')::uuid),true);
select set_config('test.reader_before',test_reader.state_digest(),true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000901","email":"reader@example.invalid","role":"authenticated"}',true);
do $$ declare x jsonb;p text;s record;r record;args text;cnt int:=0; begin
 perform test_reader.assert(public.is_operations_reader() and public.operations_can_read_full(),'strict reader active');
 perform test_reader.assert(not public.is_operations_admin() and not public.can_edit_schedule(),'reader never admin/editor');
 x:=public.get_app_access(); perform test_reader.assert(x->>'full_read_access'='true' and x->>'can_write'='false' and x->>'is_admin'='false' and jsonb_array_length(x->'allowed_views')=17,'all17 navigation read only');
 x:=public.get_schedule_snapshot(); perform test_reader.assert(exists(select 1 from jsonb_array_elements(x#>'{payload,data,billing}') b where b->>'id'='TEST-READER-BILL') and (select count(*)=4 from jsonb_array_elements(x#>'{payload,data,jobs}') j where j->>'id' like 'TEST-READER-%'),'full business snapshot includes billing and all4 divisions');
 perform test_reader.assert(x#>'{payload,data,migrationBackup}'='null'::jsonb and x#>'{payload,data,systemFlags}'='{}'::jsonb,'legacy backup and flags excluded');
 perform test_reader.assert(not exists(select 1 from public.schedule_settings where setting_key='TEST-private-secret'),'unknown settings not exposed');
 perform test_reader.assert(exists(select 1 from public.schedule_settings where setting_key='companyEmployeeRoster'),'roster read supported');
 perform test_reader.assert(not exists(select 1 from public.schedule_revision_backups),'recovery backups not exposed');
 x:=public.get_walls_production_snapshot(); perform test_reader.assert(x->>'full_read_access'='true','full production read');
 perform public.get_walls_installation_snapshot(); perform test_reader.assert(public.walls_installation_permission('view'),'full installation read');
 x:=public.get_weekly_planner_snapshot('2026-10-26'); perform test_reader.assert(x#>>'{permissions,view}'='true' and x#>>'{permissions,edit}'='false','full planner drafts read path');
 perform test_reader.assert(jsonb_array_length(public.get_inventory_scopes())=3,'all3 inventory scopes');
 for s in select * from (values('walls','production'),('walls','install'),('boxes','production')) t(d,a) loop
  x:=public.get_inventory_snapshot(s.d,s.a); perform test_reader.assert(x->>'full_read_access'='true','full inventory read '||s.d||s.a);
  perform test_reader.assert(not public.inventory_scope_access(s.d,s.a,'adjust') and not public.inventory_scope_access(s.d,s.a,'manage'),'inventory no mutations');
 end loop;
 foreach p in array array['setup','pour','strip','issue','assign','plan'] loop perform test_reader.assert(not public.walls_production_permission(p),'production denied '||p); end loop;
 foreach p in array array['manage','resources','qc','field_progress'] loop perform test_reader.assert(not public.walls_installation_permission(p),'installation denied '||p); end loop;
 foreach p in array array['edit','approve','publish'] loop perform test_reader.assert(not public.weekly_planner_permission(p),'planner denied '||p); end loop;
 -- Every exposed business mutation is called under the real authenticated role.
 -- Typed nulls test authority-first denial and cannot touch real data (synthetic DB).
 for r in select p.oid,p.proname,p.proargtypes from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['save_schedule_snapshot','restore_schedule_revision','adjust_inventory_quantity','set_inventory_count','set_inventory_item','receive_inventory_stock','mark_inventory_ordered','claim_inventory_alerts','upsert_walls_production_assignment','cancel_walls_production_assignment','advance_walls_production_stage','update_walls_production_setup_progress','report_walls_production_issue','resolve_walls_production_issue','upsert_walls_production_table','capture_walls_production_weekly_forecast','save_walls_installation_activity','save_walls_installation_job','update_walls_installation_resource','report_walls_installation_issue','resolve_walls_installation_issue','set_walls_installation_qc','link_walls_installation_load_assignments','set_walls_installation_activity_assignments','save_walls_installation_day_card','save_walls_installation_day_task','ensure_weekly_planner_week','generate_weekly_planner','save_weekly_planner_section','save_weekly_planner_inputs','acknowledge_weekly_planner_conflict','approve_weekly_planner_section','publish_weekly_planner_pack','create_operations_agent_proposal','execute_operations_agent_action','reject_operations_agent_action','employee_password_prepare','employee_password_consume','employee_password_finish','employee_password_preflight']) loop
  select string_agg('null::'||format_type(t,null),',') into args from unnest(r.proargtypes::oid[]) t;
  perform test_reader.rejects(format('select public.%I(%s)',r.proname,args),'null-input RPC rejected (entry smoke) '||r.proname,false);cnt:=cnt+1;
 end loop;
 perform test_reader.rejects(format('select public.set_inventory_count(%s,%s,11)',current_setting('test.reader_item'),current_setting('test.reader_item_version')),'known item current version cannot change count');
 perform test_reader.rejects(format('select public.adjust_inventory_quantity(%s,1)',current_setting('test.reader_item')),'known item cannot adjust quantity');
 perform test_reader.rejects(format('select public.mark_inventory_ordered(%s,%s)',current_setting('test.reader_item'),current_setting('test.reader_item_version')),'known item cannot mark ordered');
 perform test_reader.rejects(format('select public.update_walls_production_setup_progress(%L,50,%L)',current_setting('test.reader_assignment'),'TEST forbidden'),'known production assignment cannot edit');
 perform test_reader.rejects(format('select public.set_walls_installation_qc(%L,%L,%L)',current_setting('test.reader_assignment'),'released','TEST forbidden'),'known assignment cannot release QC');
 perform test_reader.rejects(format('select public.save_weekly_planner_section(%L,%s,%L,%L::jsonb,%L::jsonb)',current_setting('test.reader_section'),current_setting('test.reader_section_version'),'TEST forbidden','[]','[]'),'known valid planner section save denied');
 perform test_reader.rejects(format('select public.approve_weekly_planner_section(%L,%s)',current_setting('test.reader_section'),current_setting('test.reader_section_version')),'known valid planner section approval denied');
 perform test_reader.rejects($q$select public.publish_weekly_planner_pack('2026-11-09')$q$,'known existing planner week publication denied');
 perform test_reader.rejects(format('select public.save_schedule_snapshot(%s,%L::jsonb)',(public.get_schedule_snapshot()->>'revision')::bigint,public.get_schedule_snapshot()#>'{payload,data}'),'correct current revision cannot write snapshot');
 perform test_reader.rejects('select public.capture_current_walls_production_weekly_forecast()','reader current-week capture wrapper authority denied');
 perform test_reader.rejects($q$select public.capture_walls_production_weekly_forecast('2026-11-09','TEST reader denied')$q$,'reader valid-week capture authority denied');
 perform test_reader.assert(cnt>=35,'at least35 actual RPC signatures reject null-input smoke');
 foreach p in array array['replace_schedule_records(jsonb,text)','compose_schedule_data()','rebuild_weekly_planner_conflicts(date)','sync_walls_installation_week(date)'] loop
  if to_regprocedure('public.'||p) is not null then perform test_reader.assert(not has_function_privilege('authenticated','public.'||p,'execute'),'internal execute revoked '||p); end if;
 end loop;
 for r in select tablename from pg_tables where schemaname='public' loop
  if r.tablename<>'schedule_state' then
   perform test_reader.rejects(format('delete from public.%I where false',r.tablename),'direct authenticated DELETE denied '||r.tablename);
   perform test_reader.rejects(format('insert into public.%I default values',r.tablename),'direct authenticated INSERT denied '||r.tablename);
   perform test_reader.assert(not has_table_privilege('authenticated','public.'||r.tablename,'insert,update,delete'),'direct DML revoked '||r.tablename); end if;
 end loop;
 perform test_reader.rejects($q$select public.execute_operations_agent_action('00000000-0000-4000-8900-000000000901','CONFIRM')$q$,'existing expired action cannot change status');
 perform test_reader.rejects($q$select public.reject_operations_agent_action('00000000-0000-4000-8900-000000000901')$q$,'existing action cannot be rejected');
 perform test_reader.rejects(format('select public.create_operations_agent_proposal(%L,%L,%L::jsonb,%L,%L)','Synthetic','set_inventory_count',jsonb_build_object('item_id',current_setting('test.reader_item')::bigint,'expected_version',current_setting('test.reader_item_version')::bigint,'quantity',11),'Synthetic','TEST-READER-PENDING'),'known-item idempotent old proposal denied by existing write authority before upsert');
 update public.schedule_state set updated_by='FORBIDDEN'; get diagnostics cnt=row_count; perform test_reader.assert(cnt=0,'legacy state UPDATE RLS denies');
perform test_reader.assert(test_reader.state_digest()=current_setting('test.reader_before'),'ALL public table contents unchanged after read and denial matrix');
end $$;
reset role;
-- Accidental role or owner contamination fails closed, even when marker disabled.
insert into public.app_user_roles(user_id,role,can_write) values('00000000-0000-4000-8000-000000000901','management',true);
set local role authenticated;
select test_reader.assert(not public.is_operations_reader() and not public.is_operations_admin() and not public.can_edit_schedule(),'coexisting writer role cannot elevate');
select test_reader.assert(public.get_app_access()->>'authorized'='false','malformed reader denied app');
select test_reader.rejects('select public.get_schedule_snapshot()','malformed reader denied snapshot');
reset role;
update public.app_employee_access set enabled=false where user_id='00000000-0000-4000-8000-000000000901';
set local role authenticated;
select test_reader.assert(not public.is_operations_admin() and not public.can_edit_schedule(),'disabled marker still denies writer');
reset role;
delete from public.app_user_roles where user_id='00000000-0000-4000-8000-000000000901';
update public.app_employee_access set enabled=true where user_id='00000000-0000-4000-8000-000000000901';
insert into employee_password.owners(user_id,enabled) values('00000000-0000-4000-8000-000000000901',false);
set local role authenticated;
select test_reader.assert(not public.is_operations_reader(),'even disabled owner record invalidates reader');
select test_reader.rejects('select public.employee_password_owner_targets()','reader has no password administration');
reset role;
delete from employee_password.owners where user_id='00000000-0000-4000-8000-000000000901';
-- Every independent authority contaminant blocks full read AND cannot add writes.
do $$ declare q text; begin
 foreach q in array array[
  'insert into public.walls_production_access(user_id,can_view,can_update_setup,can_record_pour,can_record_strip,can_report_issue,can_manage_assignments,can_manage_plan) values(''00000000-0000-4000-8000-000000000901'',true,true,true,true,true,true,true)',
  'insert into public.walls_installation_access(user_id,can_view,can_manage,can_assign_resources,can_qc,can_record_field_progress) values(''00000000-0000-4000-8000-000000000901'',true,true,true,true,true)',
  'insert into public.weekly_planner_access(user_id,can_view,can_edit,can_approve,can_publish) values(''00000000-0000-4000-8000-000000000901'',true,true,true,true)',
  'insert into public.inventory_user_access(email,can_view,can_adjust,can_manage) values(''reader@example.invalid'',true,true,true)'
 ] loop
  execute q;
  perform test_reader.assert(not public.is_operations_reader() and not public.is_operations_admin() and not public.can_edit_schedule() and not public.walls_production_permission('setup') and not public.walls_installation_permission('qc') and not public.weekly_planner_permission('publish') and not public.inventory_scope_access('walls','production','manage'),'independent grant cannot elevate reader');
  delete from public.walls_production_access where user_id='00000000-0000-4000-8000-000000000901'; delete from public.walls_installation_access where user_id='00000000-0000-4000-8000-000000000901';delete from public.weekly_planner_access where user_id='00000000-0000-4000-8000-000000000901';delete from public.inventory_user_access where email='reader@example.invalid';
 end loop;
end $$;
rollback;
