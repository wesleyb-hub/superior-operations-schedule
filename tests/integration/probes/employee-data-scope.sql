-- SYNTHETIC DISPOSABLE DATABASE ONLY. No hosted credentials, identities or records.
-- Run after walls-workflow-cases.sql. Every added row/function rolls back.
\set ON_ERROR_STOP on
do $guard$
begin
  if current_database()<>'superior_workflow_test'
    or to_regprocedure('test_workflow.assert(boolean,text)') is null then
    raise exception 'Refusing non-disposable database or missing synthetic helpers';
  end if;
end;
$guard$;

begin;
create function test_workflow.only_keys(value jsonb, allowed text[]) returns boolean
language sql immutable as $$
 select jsonb_typeof(value)='object' and not exists(
   select 1 from jsonb_object_keys(value) k where not k=any(allowed)
 )
$$;
grant execute on function test_workflow.only_keys(jsonb,text[]) to authenticated;

insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000101','scope-employee@example.invalid'),
 ('00000000-0000-4000-8000-000000000102','scope-disabled@example.invalid'),
 ('00000000-0000-4000-8000-000000000103','scope-boxes@example.invalid'),
 ('00000000-0000-4000-8000-000000000104','scope-install@example.invalid'),
 ('00000000-0000-4000-8000-000000000105','scope-outsider@example.invalid'),
 ('00000000-0000-4000-8000-000000000106','scope-production-supervisor@example.invalid'),
 ('00000000-0000-4000-8000-000000000107','scope-inventory-supervisor@example.invalid'),
 ('00000000-0000-4000-8000-000000000108','scope-counter@example.invalid'),
 ('00000000-0000-4000-8000-000000000109','scope-multi@example.invalid'),
 ('00000000-0000-4000-8000-000000000110','scope-inventory-only@example.invalid'),
 ('00000000-0000-4000-8000-000000000111','scope-employee-manager@example.invalid'),
 ('00000000-0000-4000-8000-000000000112','scope-partial-production@example.invalid'),
 ('00000000-0000-4000-8000-000000000113','scope-field-supervisor@example.invalid'),
 ('00000000-0000-4000-8000-000000000114','scope-field-no-grant@example.invalid'),
 ('00000000-0000-4000-8000-000000000115','scope-field-disabled@example.invalid'),
 ('00000000-0000-4000-8000-000000000116','scope-field-no-nav@example.invalid');
insert into public.app_employee_access(user_id,profile_key,legal_entity,division_key,inventory_area,allowed_views,allowed_wall_subviews,enabled,inventory_can_view,inventory_can_adjust,inventory_can_manage)
select id,'plant_manager_readonly',
 case when id::text like '%103' then 'Superior Precast Structures, LLC' else 'Superior Walls of North Dakota, LLC' end,
 case when id::text like '%103' then 'boxes' else 'walls' end,
 case when id::text like '%104' then 'install' else 'production' end,
 array['overview','walls','inventory'],array['current','overall','active'],id::text not like '%102',true,false,false
from auth.users where id::text between '00000000-0000-4000-8000-000000000101' and '00000000-0000-4000-8000-000000000116'
 and id::text not like '%105';
update public.app_employee_access set profile_key='walls_inventory_counter',inventory_can_adjust=true
 where user_id='00000000-0000-4000-8000-000000000108';
insert into public.app_employee_access(user_id,profile_key,legal_entity,division_key,inventory_area,allowed_views,allowed_wall_subviews,inventory_can_view,inventory_can_adjust,inventory_can_manage)
values ('00000000-0000-4000-8000-000000000109','plant_manager_readonly','Superior Precast Structures, LLC','boxes','production','{overview,inventory}','{}',true,false,false);
update public.app_employee_access set allowed_views='{overview,inventory}' where user_id='00000000-0000-4000-8000-000000000110';
insert into public.walls_production_access(user_id,can_view,can_update_setup,can_manage_assignments,can_manage_plan)
values ('00000000-0000-4000-8000-000000000106',true,true,true,true);
update public.app_employee_access set inventory_can_manage=true where user_id='00000000-0000-4000-8000-000000000111';
insert into public.walls_production_access(user_id,can_view,can_update_setup,can_record_pour,can_record_strip,can_report_issue,can_manage_assignments,can_manage_plan) values ('00000000-0000-4000-8000-000000000112',false,true,true,true,true,true,true);
update public.app_employee_access set inventory_area='install',allowed_wall_subviews='{installation}' where user_id::text between '00000000-0000-4000-8000-000000000113' and '00000000-0000-4000-8000-000000000116';
update public.app_employee_access set allowed_wall_subviews='{}' where user_id='00000000-0000-4000-8000-000000000116';
insert into public.walls_installation_access(user_id,can_view,enabled) values ('00000000-0000-4000-8000-000000000113',true,true),('00000000-0000-4000-8000-000000000115',true,false),('00000000-0000-4000-8000-000000000116',true,true);
insert into public.inventory_user_access(email,division_key,inventory_area,can_view,can_adjust,can_manage)
values ('scope-inventory-supervisor@example.invalid','walls','production',true,true,true);

insert into public.schedule_records(collection,record_id,ordinal,division,data,updated_by) values
 ('walls','TEST-SCOPE-WALL',8101,'walls',jsonb_build_object(
  'id','TEST-SCOPE-WALL','job','TEST-SCOPE-101','type','TEST operational model',
  'project','TEST project identification','development','TEST site','address','123 Synthetic Worksite',
  'productionDate',current_date::text,'installDate',(current_date+2)::text,'status','Active','lf',80,
  'lfByHeight','{"h8":80,"privateFinance":"SECRET_NESTED_FINANCE"}'::jsonb,
  'customer','SECRET_CUSTOMER_CONTACT','notes','SECRET_GENERAL_ADMIN_NOTE','privateNotes','SECRET_PRIVATE_NOTE',
  'billing','{"balance":"SECRET_ACCOUNT_BALANCE"}'::jsonb,'invoice','SECRET_INVOICE',
  'links','[{"label":"SECRET_FINANCE_LINK","url":"https://example.invalid/SECRET_FINANCE_LINK"}]'::jsonb,
  'planReview','{"notes":"SECRET_ENGINEERING_NOTE","stages":{"approvedProduction":{"status":"Complete"}}}'::jsonb),
  'SECRET_RECORD_ACTOR'),
 ('walls','TEST-SCOPE-MALFORMED',8102,'walls',jsonb_build_object(
  'id','TEST-SCOPE-MALFORMED','job','TEST-SCOPE-102','type','{"invoice":"SECRET_MODEL_OBJECT"}'::jsonb,
  'project','{"financial":"SECRET_PROJECT_OBJECT"}'::jsonb,'address','{"billing":"SECRET_ADDRESS_OBJECT"}'::jsonb,
  'development','["SECRET_DEVELOPMENT_ARRAY"]'::jsonb,'lf',20,'productionDate',current_date::text,
  'lfByHeight','{"h8":20}'::jsonb,'planReview','{"stages":{"approvedProduction":{"status":"Complete"}}}'::jsonb),
  'SECRET_RECORD_ACTOR'),
 ('walls','TEST-SCOPE-WRONG-DIVISION',8103,'boxes',jsonb_build_object(
  'id','TEST-SCOPE-WRONG-DIVISION','job','SECRET_WRONG_DIVISION_JOB','lf',20,
  'productionDate',current_date::text,'lfByHeight','{"h8":20}'::jsonb,
  'planReview','{"stages":{"approvedProduction":{"status":"Complete"}}}'::jsonb),
  'SECRET_RECORD_ACTOR'),
 ('jobs','TEST-SCOPE-BOX',8104,'boxes','{"id":"TEST-SCOPE-BOX","job":"SECRET_BOX_JOB"}','SECRET_RECORD_ACTOR'),
 ('billing','wall:TEST-SCOPE-WALL',8105,'walls','{"key":"wall:TEST-SCOPE-WALL","invoice":"SECRET_BILLING_COLLECTION"}','SECRET_RECORD_ACTOR');
insert into public.walls_production_tables(table_id,label,capacity_lf,sort_order,notes,updated_by)
values ('TEST-SCOPE-TABLE','TEST scope table',100,8101,'SECRET_TABLE_ADMIN_NOTE','SECRET_TABLE_ACTOR'),
 ('TEST-SCOPE-WRONG-TABLE','TEST wrong division table',100,8102,'SECRET_TABLE_ADMIN_NOTE','SECRET_TABLE_ACTOR');
insert into public.walls_production_assignments(assignment_id,wall_record_id,table_id,wall_height,planned_lf,setup_start_at,pour_at,strip_at,notes,created_by,updated_by)
values
 ('00000000-0000-4000-8100-000000000101','TEST-SCOPE-WALL','TEST-SCOPE-TABLE',8,80,current_date+time '07:00',current_date+time '13:00',current_date+1+time '07:00','WORK_INSTRUCTION: verify inserts before setup','SECRET_ASSIGNMENT_CREATOR','SECRET_ASSIGNMENT_ACTOR'),
 ('00000000-0000-4000-8100-000000000102','TEST-SCOPE-WRONG-DIVISION','TEST-SCOPE-WRONG-TABLE',8,20,current_date+time '07:00',current_date+time '13:00',current_date+1+time '07:00','SECRET_WRONG_DIVISION_INSTRUCTION','SECRET_ASSIGNMENT_CREATOR','SECRET_ASSIGNMENT_ACTOR');
insert into public.walls_production_issues(assignment_id,wall_record_id,table_id,category,description,reported_by_email,resolution_note)
values ('00000000-0000-4000-8100-000000000101','TEST-SCOPE-WALL','TEST-SCOPE-TABLE','Drawing questions','WORK_SAFETY: verify insert dimensions before advancing','SECRET_REPORTER_EMAIL','SECRET_RESOLUTION_NOTE');
insert into public.walls_production_events(assignment_id,event_type,detail,actor_email)
values ('00000000-0000-4000-8100-000000000101','assignment_created','{"private":"SECRET_EVENT_JSON"}','SECRET_EVENT_EMAIL');
insert into public.walls_production_weekly_forecasts(week_start,baseline_planned_lf,baseline_assignment_count,baseline_detail,frozen_by,source)
values (date_trunc('week',current_date::timestamp)::date,80,1,'[{"assignmentId":"00000000-0000-4000-8100-000000000101","wallRecordId":"TEST-SCOPE-WALL","job":"TEST-SCOPE-101","plannedLf":80,"model":"{\"invoice\":\"SECRET_FORECAST_ENCODED_MODEL\"}","private":"SECRET_FORECAST_DETAIL"},{"assignmentId":"00000000-0000-4000-8100-000000000102","wallRecordId":"TEST-SCOPE-WRONG-DIVISION","job":"SECRET_WRONG_DIVISION_JOB","plannedLf":20}]','SECRET_FORECAST_ACTOR','SECRET_FORECAST_SOURCE')
on conflict(week_start) do update set baseline_detail=excluded.baseline_detail,frozen_by=excluded.frozen_by,source=excluded.source;

insert into public.inventory_categories(division_key,inventory_area,category,legal_entity,created_by) values
 ('walls','production','TEST scope materials','Superior Walls of North Dakota, LLC','SECRET_CATEGORY_ACTOR'),
 ('walls','install','TEST scope materials','Superior Walls of North Dakota, LLC','SECRET_CATEGORY_ACTOR'),
 ('boxes','production','TEST scope materials','Superior Precast Structures, LLC','SECRET_CATEGORY_ACTOR');
insert into public.inventory_items(division_key,inventory_area,legal_entity,titan_code,description,category,unit,quantity,reorder_threshold,ordered,ordered_by,updated_by) values
 ('walls','production','Superior Walls of North Dakota, LLC','TEST-SCOPE-WP','TEST production material','TEST scope materials','pieces',10,2,true,'SECRET_INVENTORY_ORDER_ACTOR','SECRET_INVENTORY_ACTOR'),
 ('walls','install','Superior Walls of North Dakota, LLC','TEST-SCOPE-WI','SECRET_INSTALL_MATERIAL','TEST scope materials','pieces',10,2,false,null,'SECRET_INVENTORY_ACTOR'),
 ('boxes','production','Superior Precast Structures, LLC','TEST-SCOPE-BP','SECRET_BOXES_MATERIAL','TEST scope materials','pieces',10,2,false,null,'SECRET_INVENTORY_ACTOR');
insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email)
select item_id,'corrected',9,10,'{"private":"SECRET_INVENTORY_EVENT_JSON"}','SECRET_INVENTORY_EVENT_ACTOR'
from public.inventory_items where titan_code like 'TEST-SCOPE-%';

insert into public.inventory_alert_outbox(item_id,payload) select item_id,'{"private":"SECRET_ALERT_PAYLOAD"}'::jsonb from public.inventory_items where titan_code='TEST-SCOPE-WP';
insert into public.operations_agent_actions(action_id,requested_by_user_id,requested_by_email,request_text,action_type,parameters,summary,status,idempotency_key,result)
select ('00000000-0000-4000-8200-000000000'||n)::uuid,('00000000-0000-4000-8000-000000000'||n)::uuid,'SECRET_HISTORICAL_ACTOR','SECRET_HISTORICAL_REQUEST',case when n='106' then 'update_setup_progress' else 'set_inventory_count' end,jsonb_build_object('private','SECRET_HISTORICAL_PARAMS','item_id',(select item_id from public.inventory_items where titan_code='TEST-SCOPE-WP'),'assignment_id','00000000-0000-4000-8100-000000000101'),'TEST historical action','pending','TEST-SCOPE-HISTORY-'||n,'{"private":"SECRET_HISTORICAL_RESULT"}'
from unnest(array['101','102','106','107','108']) n;

insert into public.operations_agent_actions(action_id,requested_by_user_id,requested_by_email,request_text,action_type,parameters,summary,status,idempotency_key,result)
select '00000000-0000-4000-8200-000000000207','00000000-0000-4000-8000-000000000107','SECRET_HISTORICAL_ACTOR','SECRET_HISTORICAL_REQUEST','set_inventory_count',jsonb_build_object('item_id',item_id),'SECRET_OTHER_SCOPE_SUMMARY','pending','TEST-SCOPE-OTHER-HISTORY','{"private":"SECRET_OTHER_SCOPE_RESULT"}'::jsonb from public.inventory_items where titan_code='TEST-SCOPE-BP';


insert into public.operations_agent_actions(action_id,requested_by_user_id,requested_by_email,request_text,action_type,parameters,summary,status,idempotency_key,result)
values ('00000000-0000-4000-8200-000000000212','00000000-0000-4000-8000-000000000112','SECRET_WRONG_DIVISION_ACTOR','SECRET_WRONG_DIVISION_REQUEST','update_setup_progress','{"assignment_id":"00000000-0000-4000-8100-000000000102","setup_progress":50,"note":"SECRET_WRONG_DIVISION_NOTE"}','SECRET_WRONG_DIVISION_SUMMARY','pending','TEST-SCOPE-WRONG-DIVISION-HISTORY','{"private":"SECRET_WRONG_DIVISION_RESULT"}');

select set_config('test.scope_walls_item_id',(select item_id::text from public.inventory_items where titan_code='TEST-SCOPE-WP'),true);
select set_config('test.scope_boxes_item_id',(select item_id::text from public.inventory_items where titan_code='TEST-SCOPE-BP'),true);

-- Test authentic PostgreSQL role/RLS behavior; JWT claims are synthetic Auth stubs.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000101","email":"scope-employee@example.invalid","role":"authenticated"}',true);
do $employee$
declare app jsonb; master jsonb; production jsonb; forecast jsonb; context jsonb; row jsonb; name text; ok boolean;
begin
 app:=public.get_app_access();
 perform test_workflow.assert((app->>'authorized')::boolean and not (app->>'is_admin')::boolean,'employee stays authorized but never becomes admin');
 perform test_workflow.assert(app->'allowed_wall_subviews'='["production"]'::jsonb,'employee Walls navigation exposes production only');
 perform test_workflow.assert(not exists(select 1 from jsonb_array_elements_text(app->'allowed_views') v where v not in ('overview','walls','inventory')),'employee has no unrelated app navigation');
 master:=public.get_schedule_snapshot();
 perform test_workflow.assert(not exists(select 1 from jsonb_array_elements(master#>'{payload,data,walls}') w where not test_workflow.only_keys(w,array['id','job','type','project','development','address','productionDate','lf','lfUnassigned','completedDate','completedMonth','lfByHeight'])),'master Walls object keys are strictly allowlisted');
 perform test_workflow.assert(master::text not like '%SECRET_%','master employee JSON excludes every private, customer, financial, actor and other-division sentinel');
 perform test_workflow.assert((select count(*)=1 from jsonb_array_elements(master#>'{payload,data,walls}') w where w->>'id'='TEST-SCOPE-WALL' and w->>'job'='TEST-SCOPE-101' and w->>'address'='123 Synthetic Worksite'),'master retains necessary job identification and worksite address');
 foreach name in array array['jobs','billing','audit','historyArchive','deliveryHistory','qcHistory','loads'] loop
  perform test_workflow.assert(master#>array['payload','data',name]='[]'::jsonb,'employee master excludes '||name);
 end loop;
 production:=public.get_walls_production_snapshot(current_date-1,current_date+2);
 perform test_workflow.assert(production->>'full_read_access'='false','employee production metadata identifies safe projection');
 perform test_workflow.assert(not exists(select 1 from jsonb_array_elements(production->'assignments') a where not test_workflow.only_keys(a,array['assignment_id','wall_record_id','table_id','wall_height','planned_lf','setup_start_at','pour_at','strip_at','stage','setup_progress','pre_pour_ready','actual_poured_lf','schedule_production_date','schedule_total_lf','needs_review','review_reason','notes','version'])),'production assignment keys are strictly allowlisted');
 perform test_workflow.assert(not exists(select 1 from jsonb_array_elements(production->'tables') t where not test_workflow.only_keys(t,array['table_id','label','capacity_lf','sort_order','enabled','version'])),'production table keys are strictly allowlisted');
 perform test_workflow.assert(not exists(select 1 from jsonb_array_elements(production->'issues') i where not test_workflow.only_keys(i,array['issue_id','assignment_id','wall_record_id','table_id','category','description','status','reported_at','resolved_at'])),'production issue keys are strictly allowlisted');
 perform test_workflow.assert(production::text not like '%SECRET_%','production employee JSON rejects raw rows, arbitrary nested JSON and unrelated division');
 perform test_workflow.assert((select count(*)=1 from jsonb_array_elements(production->'jobs') j where j->>'id'='TEST-SCOPE-WALL' and j->>'job'='TEST-SCOPE-101' and j->>'address'='123 Synthetic Worksite'),'production retains job/address');
 select a into row from jsonb_array_elements(production->'assignments') a where a->>'assignment_id'='00000000-0000-4000-8100-000000000101';
 perform test_workflow.assert(row->>'notes'='WORK_INSTRUCTION: verify inserts before setup' and row->>'planned_lf'='80' and row->>'stage'='planned','production retains explicit operational instructions, quantity and stage');
 perform test_workflow.assert((select count(*)=1 from jsonb_array_elements(production->'issues') i where i->>'description'='WORK_SAFETY: verify insert dimensions before advancing'),'production retains safety hold description');
 perform test_workflow.assert(not exists(select 1 from jsonb_array_elements(production->'jobs') j where jsonb_array_length(coalesce(j->'documentLinks','[]'))>0),'unclassified master document links never become employee released documents');
 forecast:=public.get_walls_production_weekly_forecast(current_date);
 perform test_workflow.assert(forecast::text not like '%SECRET_%','weekly forecast cannot bypass employee projections');
 perform test_workflow.assert(forecast#>>'{baseline,baseline_planned_lf}'='80' and forecast#>>'{baseline,baseline_assignment_count}'='1' and jsonb_array_length(forecast#>'{baseline,baseline_detail}')=1,'forecast baseline totals and detail exclude unrelated division consistently');
 context:=public.get_operations_agent_context();
 perform test_workflow.assert(context::text not like '%SECRET_%','assistant context cannot bypass employee projections or division boundaries');
 foreach name in array array['schedule_records','schedule_settings','schedule_state','schedule_change_log','schedule_milestones','schedule_revision_backups','walls_production_tables','walls_production_assignments','walls_production_events','walls_production_issues','walls_production_weekly_forecasts','inventory_items','inventory_events','inventory_categories','schedule_meta','inventory_alert_outbox','operations_agent_actions'] loop
  execute format('select count(*)=0 from public.%I',name) into ok;
  perform test_workflow.assert(ok,'direct raw table denied to employee: '||name);
 end loop;
 perform test_workflow.rejects('select public.get_weekly_planner_snapshot(current_date)','access required','employee cannot read broad planner');
 perform test_workflow.rejects('select public.get_walls_installation_snapshot(current_date,current_date+2)','access required','employee cannot read broad installation');
 perform test_workflow.assert(public.get_weekly_planner_agent_context()->>'authorized'='false' and public.get_walls_installation_agent_context()->>'authorized'='false','alternate planner/installation assistant APIs deny employee');
 perform test_workflow.rejects('select public.list_schedule_backups()','Not authorized','employee cannot read full schedule backups');
 perform test_workflow.rejects($q$select public.save_schedule_snapshot(0,'{}')$q$,'Read-only','employee cannot overwrite schedule');
end;
$employee$;

-- Inventory-specific and independent-grant assertions follow below.

do $inventory_read$
declare snap jsonb; item jsonb; before_state jsonb;
begin
 snap:=public.get_inventory_snapshot('walls','production');
 perform test_workflow.assert(snap->>'full_read_access'='false','employee inventory metadata identifies safe projection');
 perform test_workflow.assert(snap::text not like '%SECRET_%' and snap->'events'='[]'::jsonb,'inventory snapshot excludes raw actor/history/private details and other scopes');
 perform test_workflow.assert(not exists(select 1 from jsonb_array_elements(snap->'items') i where not test_workflow.only_keys(i,array['item_id','titan_code','description','category','unit','quantity','reorder_threshold','ordered','version','updated_at','division_key','inventory_area'])),'inventory item keys are strictly allowlisted');
 select i into item from jsonb_array_elements(snap->'items') i where i->>'titan_code'='TEST-SCOPE-WP';
 perform test_workflow.assert(item->>'description'='TEST production material' and item->>'quantity'='10','authorized employee inventory read is useful');
 before_state:=snap;
 perform test_workflow.rejects(format('select public.set_inventory_count(%s,%s,12)',item->>'item_id',item->>'version'),'access required','read-only employee cannot submit count');
 perform test_workflow.assert(public.get_inventory_snapshot('walls','production')=before_state,'denied count leaves safe item/version and event state unchanged');
 perform test_workflow.rejects($q$select public.get_inventory_snapshot('walls','install')$q$,'access required','tampered inventory scope cannot read installation');
 perform test_workflow.rejects($q$select public.get_inventory_snapshot('boxes','production')$q$,'access required','tampered inventory division cannot read boxes');
 perform test_workflow.rejects($q$select public.get_inventory_snapshot(null,null)$q$,'access required','null scope fails closed');
 perform test_workflow.rejects($q$select public.employee_wall_projection('{"job":"test"}')$q$,'permission denied','internal projection is not a client RPC');
end;
$inventory_read$;

-- The historical counter capability remains functional without returning raw rows.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000108","email":"scope-counter@example.invalid","role":"authenticated"}',true);
do $counter$
declare snap jsonb; item jsonb; changed jsonb; before_state jsonb; action jsonb; result jsonb; item_id bigint:=current_setting('test.scope_walls_item_id')::bigint;
begin
 snap:=public.get_inventory_snapshot('walls','production');
 select i into item from jsonb_array_elements(snap->'items') i where i->>'item_id'=item_id::text;
 changed:=public.set_inventory_count(item_id,(item->>'version')::bigint,12);
 perform test_workflow.assert(changed->>'quantity'='12' and (changed->>'version')::bigint=(item->>'version')::bigint+1,'existing counter can set inventory count with optimistic version');
 perform test_workflow.assert(changed::text not like '%SECRET_%' and not changed ?| array['updated_by','ordered_by','legal_entity','reorder_alert_open'],'count result does not leak a raw inventory row');
 before_state:=public.get_inventory_snapshot('walls','production');
 perform test_workflow.rejects(format('select public.set_inventory_count(%s,%s,13)',item_id,item->>'version'),'version conflict','repeated stale count is rejected');
 perform test_workflow.rejects(format('select public.set_inventory_count(%s,null,13)',item_id),'version conflict','null count version is rejected');
 perform test_workflow.rejects(format('select public.set_inventory_count(%s,1,13)',current_setting('test.scope_boxes_item_id')),'access required','counter cannot mutate another division by guessed item ID');
 perform test_workflow.rejects(format('select public.mark_inventory_ordered(%s,%s)',item_id,changed->>'version'),'access required','count capability does not imply ordering management');
 perform test_workflow.assert(public.get_inventory_snapshot('walls','production')=before_state,'stale/null/wrong-scope/management denials leave scoped state unchanged');
 changed:=public.adjust_inventory_quantity(item_id,1);
 perform test_workflow.assert(changed->>'quantity'='13' and not changed ?| array['updated_by','ordered_by'],'legacy authorized +/-1 response is also projected');
 perform test_workflow.assert((select count(*)=0 from public.inventory_items),'counter still cannot bypass RPC through raw table');
 action:=public.create_operations_agent_proposal('TEST synthetic count confirmation','set_inventory_count',jsonb_build_object('item_id',item_id,'expected_version',(changed->>'version')::bigint,'quantity',13),'TEST count remains thirteen','TEST-SCOPE-COUNT-CONFIRM');
 result:=public.execute_operations_agent_action((action->>'action_id')::uuid,'CONFIRM');
 perform test_workflow.assert((result->>'ok')::boolean and result#>>'{action,status}'='executed' and (select i->>'quantity'='13' from jsonb_array_elements(public.get_inventory_snapshot('walls','production')->'items') i where i->>'item_id'=item_id::text),'authorized assistant count still executes through sanitized command');
 perform test_workflow.assert(result::text not like '%SECRET_%' and not (result->'action') ?| array['result','requested_by_email','request_text'] and test_workflow.only_keys(result#>'{action,parameters}',array['item_id','quantity','expected_version']),'assistant execution cannot reintroduce raw inventory result');
 perform test_workflow.assert(not exists(select 1 from public.operations_agent_actions a where a.action_id=(action->>'action_id')::uuid),'employee cannot read raw own action history');

end;
$counter$;

do $historical_reject$
declare response jsonb;
begin
 response:=public.reject_operations_agent_action('00000000-0000-4000-8200-000000000108');
 perform test_workflow.assert(response->>'ok'='true' and response::text not like '%SECRET_%' and not (response->'action') ?| array['result','request_text','requested_by_email'] and test_workflow.only_keys(coalesce(response#>'{action,parameters}','{}'),array['item_id','quantity','expected_version']),'rejecting historical own action cannot leak old raw payload');
end;
$historical_reject$;

-- Non-admin independent grants stay additive, including when an employee row exists.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000106","email":"scope-production-supervisor@example.invalid","role":"authenticated"}',true);
do $production_supervisor$
declare snap jsonb; changed jsonb;
begin
 perform test_workflow.assert(not public.is_operations_admin(),'production supervisor remains non-admin');
 snap:=public.get_walls_production_snapshot(current_date-1,current_date+2);
 perform test_workflow.assert(snap->>'full_read_access'='true','independent production grant identifies full projection');
 perform test_workflow.assert(snap::text like '%SECRET_TABLE_ADMIN_NOTE%' and snap::text like '%SECRET_REPORTER_EMAIL%' and snap::text like '%SECRET_FINANCE_LINK%','independently granted production supervisor keeps existing full projection');
 perform test_workflow.assert((select count(*)=1 from public.walls_production_assignments where assignment_id='00000000-0000-4000-8100-000000000101'),'independent production supervisor keeps raw operational row reads');
 changed:=public.advance_walls_production_stage('00000000-0000-4000-8100-000000000102','setup_in_progress',1);
 perform test_workflow.assert(changed->>'stage'='setup_in_progress' and changed ? 'updated_by','independent supervisor stage action and full result remain usable');
 perform test_workflow.assert((select count(*)=1 from public.operations_agent_actions where action_id='00000000-0000-4000-8200-000000000106' and result::text like '%SECRET_HISTORICAL_RESULT%'),'independent production supervisor retains own action history');
 perform test_workflow.assert(public.get_walls_production_weekly_forecast(current_date)::text like '%SECRET_FORECAST_ACTOR%','independent supervisor retains full forecast metadata');
end;
$production_supervisor$;

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000107","email":"scope-inventory-supervisor@example.invalid","role":"authenticated"}',true);
do $inventory_supervisor$
declare snap jsonb; item jsonb; changed jsonb;
begin
 snap:=public.get_inventory_snapshot('walls','production');
 perform test_workflow.assert(snap->>'full_read_access'='true','independent inventory grant identifies full projection');
 perform test_workflow.assert(snap::text like '%SECRET_INVENTORY_EVENT_JSON%' and snap::text like '%SECRET_INVENTORY_EVENT_ACTOR%','independent inventory supervisor retains full scoped event history');
 perform test_workflow.assert((select count(*)=1 from public.inventory_items where titan_code='TEST-SCOPE-WP'),'independent inventory supervisor retains scoped raw item access');
 perform test_workflow.assert(exists(select 1 from public.inventory_alert_outbox where payload::text like '%SECRET_ALERT_PAYLOAD%'),'independent inventory supervisor retains scoped raw outbox');
 perform test_workflow.assert((select count(*)=1 from public.operations_agent_actions where action_id='00000000-0000-4000-8200-000000000107' and result::text like '%SECRET_HISTORICAL_RESULT%'),'independent inventory supervisor retains own action history');
 perform test_workflow.assert((select count(*)=0 from public.inventory_items where titan_code='TEST-SCOPE-BP'),'independent inventory grant does not grant unrelated division');
 perform test_workflow.assert(not exists(select 1 from public.operations_agent_actions where action_id='00000000-0000-4000-8200-000000000207'),'independent scoped inventory grant does not expose other-scope historical result');
 changed:=public.reject_operations_agent_action('00000000-0000-4000-8200-000000000207');
 perform test_workflow.assert(changed::text not like '%SECRET_%' and not (changed->'action') ?| array['summary','parameters','result','error_message'],'out-of-scope own action rejection returns status only');
 select i into item from jsonb_array_elements(snap->'items') i where i->>'titan_code'='TEST-SCOPE-WP';
 changed:=public.receive_inventory_stock((item->>'item_id')::bigint,(item->>'version')::bigint,2);
 perform test_workflow.assert(changed->>'quantity'='15' and changed ? 'updated_by','independent inventory supervisor management action/full response preserved');
end;
$inventory_supervisor$;

-- An employee inventory-management flag is not raw outbox/history authorization.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000111","email":"scope-employee-manager@example.invalid","role":"authenticated"}',true);
do $employee_manager$
declare snap jsonb; item jsonb; changed jsonb;
begin
 perform test_workflow.assert(public.inventory_scope_access('walls','production','manage') and not public.can_read_full_inventory('walls','production'),'employee manager fixture has write authority without independent full-read grant');
 perform test_workflow.assert((select count(*)=0 from public.inventory_alert_outbox),'employee-only manager cannot read private alert payload');
 snap:=public.get_inventory_snapshot('walls','production');
 select i into item from jsonb_array_elements(snap->'items') i where i->>'titan_code'='TEST-SCOPE-WP';
 changed:=public.set_inventory_item((item->>'item_id')::bigint,(item->>'version')::bigint,15,2,'pieces');
 perform test_workflow.assert(changed->>'quantity'='15' and not changed ?| array['updated_by','ordered_by'],'employee management correction result is projected');
 changed:=public.mark_inventory_ordered((changed->>'item_id')::bigint,(changed->>'version')::bigint);
 perform test_workflow.assert(changed->>'ordered'='true' and not changed ?| array['updated_by','ordered_by'],'employee ordering result is projected');
 changed:=public.receive_inventory_stock((changed->>'item_id')::bigint,(changed->>'version')::bigint,1);
 perform test_workflow.assert(changed->>'quantity'='16' and not changed ?| array['updated_by','ordered_by'],'employee receiving result is projected');
end;
$employee_manager$;

-- Independent write flags without can_view must not turn mutation results into raw read APIs.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000112","email":"scope-partial-production@example.invalid","role":"authenticated"}',true);
do $partial_production$
declare t jsonb; a jsonb; issue jsonb; response jsonb; assignment_id uuid; action jsonb;
begin
 perform test_workflow.assert(public.walls_production_permission('setup') and not public.can_read_full_walls_production(),'partial production fixture has setup authority but no full-read grant');
 t:=public.upsert_walls_production_table('TEST-SCOPE-WRITE-TABLE','TEST safe write table',20,true,'SECRET_PRIVATE_TABLE_WRITE');
 perform test_workflow.assert(not t ?| array['notes','updated_by','created_at'] and t->>'table_id'='TEST-SCOPE-WRITE-TABLE','table management return uses employee projection without full view');
 a:=public.upsert_walls_production_assignment(null,'TEST-SCOPE-MALFORMED','TEST-SCOPE-WRITE-TABLE',8,20,current_date+time '07:00',current_date+time '13:00',current_date+1+time '07:00','WORK instruction for test write');
 perform test_workflow.assert(not a ?| array['created_by','updated_by','created_at'] and a->>'stage'='planned','assignment creation result is projected');
 a:=public.upsert_walls_production_assignment((a->>'assignment_id')::uuid,'TEST-SCOPE-MALFORMED','TEST-SCOPE-WRITE-TABLE',8,20,current_date+time '07:00',current_date+time '13:00',current_date+1+time '07:00','WORK revised instruction',(a->>'version')::bigint);
 perform test_workflow.assert(not a ?| array['created_by','updated_by'] and a->>'notes'='WORK revised instruction','assignment reschedule result is projected');
 a:=public.cancel_walls_production_assignment((a->>'assignment_id')::uuid,'WORK cancellation test');
 perform test_workflow.assert(not a ?| array['created_by','updated_by'] and a->>'stage'='cancelled','assignment cancellation result is projected');
 a:=public.upsert_walls_production_assignment(null,'TEST-SCOPE-MALFORMED','TEST-SCOPE-WRITE-TABLE',8,20,current_date+time '07:00',current_date+time '13:00',current_date+1+time '07:00','WORK instruction for stage test');
 assignment_id:=(a->>'assignment_id')::uuid;
 a:=public.advance_walls_production_stage(assignment_id,'setup_in_progress',1);
 perform test_workflow.assert(a->>'stage'='setup_in_progress' and not a ?| array['created_by','updated_by'],'setup stage response is projected');
 a:=public.update_walls_production_setup_progress(assignment_id,25,'WORK progress instruction');
 perform test_workflow.assert(a->>'setup_progress'='25' and not a ?| array['created_by','updated_by'],'setup progress response is projected');
 issue:=public.report_walls_production_issue(assignment_id,'Drawing questions','WORK confirm safe dimension');
 perform test_workflow.assert(issue->>'status'='open' and not issue ?| array['reported_by_email','reported_by_user_id','resolution_note'],'issue report response is projected');
 issue:=public.resolve_walls_production_issue((issue->>'issue_id')::bigint,'SECRET_RESOLUTION_WRITE');
 perform test_workflow.assert(issue->>'status'='resolved' and issue::text not like '%SECRET_%' and not issue ?| array['resolved_by_email','resolution_note'],'issue resolution response does not expose private manager note');
 action:=public.create_operations_agent_proposal('TEST setup progress','update_setup_progress',jsonb_build_object('assignment_id',assignment_id,'expected_version',(a->>'version')::bigint,'setup_progress',50,'private','SECRET_ACTION_PARAMETER'),'TEST progress to50','TEST-SCOPE-PRODUCTION-CONFIRM');
 perform test_workflow.assert(action::text not like '%SECRET_%' and test_workflow.only_keys(coalesce(action->'parameters','{}'),array['assignment_id','expected_version','new_stage','setup_progress','actual_lf','pre_pour_ready','note']),'partial production assistant proposal strips arbitrary parameters');
 response:=public.execute_operations_agent_action((action->>'action_id')::uuid,'CONFIRM');
 perform test_workflow.assert(response->>'ok'='true' and not (response->'action') ?| array['result','requested_by_email'] and test_workflow.only_keys(coalesce(response#>'{action,parameters}','{}'),array['assignment_id','expected_version','new_stage','setup_progress','actual_lf','pre_pour_ready','note']),'partial production assistant execution response remains projected');
 response:=public.capture_walls_production_weekly_forecast(current_date,'TEST employee freeze');
 perform test_workflow.assert(response::text not like '%SECRET_%' and not response ?| array['frozen_by','source'],'forecast capture cannot bypass field/scope projection');
end;
$partial_production$;


-- Response containment does not silently change pre-existing independent write authority.
-- This intentionally corrupt Walls-collection row belongs to Boxes and must never be returned.
do $wrong_division_write_response$
declare response jsonb;
begin
 response:=public.reject_operations_agent_action('00000000-0000-4000-8200-000000000212');
 perform test_workflow.assert(response->>'ok'='true' and response::text not like '%SECRET_%' and test_workflow.only_keys(response->'action',array['action_id','action_type','status','created_at','expires_at','confirmed_at','executed_at']),'historical malformed other-division assistant action returns status metadata only');
 response:=public.update_walls_production_setup_progress('00000000-0000-4000-8100-000000000102',35,'');
 perform test_workflow.assert(response='{}'::jsonb,'partial production writer receives no fields from a malformed other-division assignment');
 response:=public.report_walls_production_issue('00000000-0000-4000-8100-000000000102','Drawing questions','SECRET_WRONG_DIVISION_ISSUE');
 perform test_workflow.assert(response='{}'::jsonb,'partial production writer receives no fields from a malformed other-division issue');
end;
$wrong_division_write_response$;
reset role;
select test_workflow.assert((select setup_progress=35 and notes='SECRET_WRONG_DIVISION_INSTRUCTION' from public.walls_production_assignments where assignment_id='00000000-0000-4000-8100-000000000102'),'response-only guard preserves existing independent production write authority and stored instruction');
select test_workflow.assert(exists(select 1 from public.walls_production_issues where assignment_id='00000000-0000-4000-8100-000000000102' and description='SECRET_WRONG_DIVISION_ISSUE'),'response-only guard preserves existing issue mutation semantics');
set local role authenticated;

-- Field navigation is preserved only for independently authorized, explicitly listed Field access.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000113","email":"scope-field-supervisor@example.invalid","role":"authenticated"}',true);
select test_workflow.assert(public.get_app_access()->'allowed_wall_subviews'='["installation"]'::jsonb and public.get_app_access()->'allowed_views' ? 'walls','independent Field supervisor retains explicitly requested installation navigation only');
select test_workflow.assert(public.get_walls_installation_snapshot(current_date,current_date+2)::text like '%SECRET_GENERAL_ADMIN_NOTE%','independent Field supervisor retains original installation data authority');
select test_workflow.assert(not public.walls_production_permission('view'),'Field authority does not imply production');
do $field_negatives$
declare n text;
begin
 foreach n in array array['114','115'] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-000000000'||n,'email','scope-field-test@example.invalid','role','authenticated')::text,true);
  perform test_workflow.assert(public.get_app_access()->'allowed_wall_subviews'='[]'::jsonb,'listed Field navigation requires enabled independent permission: '||n);
  perform test_workflow.rejects('select public.get_walls_installation_snapshot(current_date,current_date+2)','access required','missing/disabled Field grant denies API: '||n);
 end loop;
end;
$field_negatives$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000116","email":"scope-field-no-nav@example.invalid","role":"authenticated"}',true);
select test_workflow.assert(public.walls_installation_permission('view') and public.get_app_access()->'allowed_wall_subviews'='[]'::jsonb,'independent Field API grant does not invent unlisted app navigation');

-- Correct union of enabled employee scopes; wrong area or allowed view never implies production.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000109","email":"scope-multi@example.invalid","role":"authenticated"}',true);
select test_workflow.assert(public.get_app_access()->'allowed_wall_subviews'='["production"]'::jsonb,'multiple employee grants select the capability union, not arbitrary first scope');
select test_workflow.assert(jsonb_array_length(public.get_inventory_scopes())=2,'multiple employee grants expose exactly two authorized inventory scopes');
select test_workflow.assert(public.get_inventory_snapshot('walls','production')->>'division_key'='walls' and public.get_inventory_snapshot('boxes','production')->>'division_key'='boxes','multi-scope employee can read both independently authorized inventory scopes');
select test_workflow.rejects($q$select public.get_inventory_snapshot('walls','install')$q$,'access required','scope union does not imply ungranted area');

do $wrong_grants$
declare n text; email text; snap jsonb;
begin
 foreach n in array array['103','104','110'] loop
  email:=case n when '103' then 'scope-boxes@example.invalid' when '104' then 'scope-install@example.invalid' else 'scope-inventory-only@example.invalid' end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-000000000'||n,'email',email,'role','authenticated')::text,true);
  perform test_workflow.assert(not public.walls_production_permission('view'),'wrong division/area/view does not grant production: '||n);
  perform test_workflow.assert(public.get_app_access()->'allowed_wall_subviews'='[]'::jsonb,'wrong division/area/view has no Walls production nav: '||n);
  perform test_workflow.assert(public.get_schedule_snapshot()#>'{payload,data,walls}'='[]'::jsonb,'wrong division/area/view cannot read Walls from master: '||n);
  perform test_workflow.rejects('select public.get_walls_production_snapshot(current_date,current_date+1)','access required','wrong division/area/view denied production snapshot: '||n);
  perform test_workflow.rejects('select public.get_walls_production_weekly_forecast(current_date)','access required','wrong division/area/view denied forecast: '||n);
  perform test_workflow.assert(public.get_operations_agent_context()->'production'='[]'::jsonb,'wrong division/area/view denied production assistant context: '||n);
 end loop;
end;
$wrong_grants$;

do $disabled_and_unknown$
declare n text;
begin
 foreach n in array array['102','105'] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-000000000'||n,'email',case n when '102' then 'scope-disabled@example.invalid' else 'scope-outsider@example.invalid' end,'role','authenticated')::text,true);
  perform test_workflow.assert(not (public.get_app_access()->>'authorized')::boolean,'disabled/unassigned employee is not authorized: '||n);
  perform test_workflow.rejects('select public.get_schedule_snapshot()','Not authorized','disabled/unassigned master denied: '||n);
  perform test_workflow.rejects('select public.get_walls_production_snapshot(current_date,current_date+1)','access required','disabled/unassigned production denied: '||n);
  perform test_workflow.rejects($q$select public.get_inventory_snapshot('walls','production')$q$,'access required','disabled/unassigned inventory denied: '||n);
  perform test_workflow.assert((select count(*)=0 from public.inventory_items),'disabled/unassigned raw inventory denied: '||n);
  perform test_workflow.assert((select count(*)=0 from public.operations_agent_actions),'disabled/unassigned historical action rows denied: '||n);
 end loop;
end;
$disabled_and_unknown$;

-- A missing authenticated identity is not equivalent to an employee grant.
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select test_workflow.rejects('select public.get_schedule_snapshot()','Not authorized','missing UID cannot read master');
select test_workflow.rejects($q$select public.get_inventory_snapshot('walls','production')$q$,'access required','missing UID cannot read inventory');
select test_workflow.rejects('select public.get_walls_production_snapshot()','access required','missing UID cannot read production');
select test_workflow.rejects('select public.get_operations_agent_context()','Authentication required','missing UID cannot read assistant context');
select test_workflow.rejects($q$select public.capture_walls_production_weekly_forecast('2098-02-03','TEST missing UID')$q$,'Authentication required','missing UID authenticated caller cannot freeze or read raw baseline');
select test_workflow.rejects('select public.capture_current_walls_production_weekly_forecast()','Authentication required','missing UID authenticated caller cannot bypass through current-week wrapper');

-- Current admin data and lifecycle behavior are unchanged.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"test-admin@superiorwallsnd.com","role":"authenticated"}',true);
select test_workflow.assert(public.get_schedule_snapshot()::text like '%SECRET_BILLING_COLLECTION%' and public.get_schedule_snapshot()::text like '%SECRET_GENERAL_ADMIN_NOTE%','admin keeps financial and private fields');
select test_workflow.assert(public.get_walls_production_snapshot(current_date,current_date+2)::text like '%SECRET_ASSIGNMENT_CREATOR%','admin keeps production audit fields');
select test_workflow.assert(public.get_inventory_snapshot('walls','production')::text like '%SECRET_INVENTORY_EVENT_JSON%','admin keeps scoped inventory event history');
select test_workflow.assert(public.get_app_access()->'allowed_views' ? 'billing' and public.get_app_access()->'allowed_wall_subviews' ? 'plans','admin navigation remains unchanged');

reset role;
select test_workflow.assert(public.get_schedule_snapshot()#>'{payload,data}'=public.compose_schedule_data(),'admin master snapshot remains exact full authoritative payload');
select test_workflow.assert(not has_function_privilege('anon','public.get_inventory_snapshot(text,text)','EXECUTE'),'anonymous cannot execute new inventory API');
select test_workflow.assert(not has_function_privilege('authenticated','public.employee_scalar_fields(jsonb,text[])','EXECUTE'),'scalar projection helper remains internal');
select test_workflow.assert(not has_function_privilege('anon','public.employee_wall_projection(jsonb)','EXECUTE'),'anonymous cannot execute projection helper');
-- Internal automation still uses the original trusted no-UID path; no employee rights added.
select set_config('request.jwt.claims','{}',true);
select test_workflow.assert(public.capture_walls_production_weekly_forecast('2098-02-03','TEST owner internal capture')->>'source'='TEST owner internal capture','owner/cron no-UID capture retains original full internal return');
grant usage on schema test_workflow to service_role;
grant execute on function test_workflow.assert(boolean,text) to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select test_workflow.assert(public.capture_walls_production_weekly_forecast('2098-02-10','TEST service internal capture')->>'source'='TEST service internal capture','service-role no-UID capture retains original full internal return');
reset role;
rollback;
select 'PASS: employee read projections, raw paths, capability union, count workflow and supervisor/admin regressions; all synthetic additions rolled back' as result;
