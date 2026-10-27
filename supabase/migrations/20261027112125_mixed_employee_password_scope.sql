-- No identity, account, grant, owner or reviewed-record writes. Local candidate.
-- Requires separately reviewed activation; every authority change invalidates existing fingerprints.
begin;
create or replace function employee_password.authority_fingerprint() returns text language sql stable security invoker set search_path=pg_catalog as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'functions',(select coalesce(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.proowner::regrole::text,p.prosecdef,p.proconfig,p.proacl::text,md5(pg_get_functiondef(p.oid))) order by p.oid::regprocedure::text),'[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','employee_pack_private','employee_password') and p.prokind='f'),
    'relations',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text) order by n.nspname,c.relname),'[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','employee_password') and c.relkind in ('r','p','v')),
    'policies',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by c.relname,p.polname),'[]'::jsonb)
      from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
    'triggers',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true)) order by n.nspname,c.relname,t.tgname),'[]'::jsonb)
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where not t.tgisinternal and n.nspname in ('public','employee_pack_private','employee_password')),
    'grant_columns',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) order by c.relname,a.attnum),'[]'::jsonb)
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('app_employee_access','app_user_roles','inventory_user_access','walls_production_access','walls_installation_access','weekly_planner_access') and a.attnum>0 and not a.attisdropped)
  )::text,'UTF8')),'hex');
$$;
create function employee_password.pilot_grants_allowed(p_grants jsonb) returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare v_employee jsonb;
begin
  if jsonb_typeof(p_grants) is distinct from 'object' or jsonb_array_length(p_grants->'employee')<>1
    or p_grants->'roles'<>'[]'::jsonb or p_grants->'inventory'<>'[]'::jsonb or p_grants->'production'<>'[]'::jsonb
    or p_grants->'installation'<>'[]'::jsonb or p_grants->'planner'<>'[]'::jsonb then return false; end if;
  v_employee:=p_grants#>'{employee,0}';
  if (select array_agg(k order by k) from jsonb_object_keys(v_employee) k) is distinct from
    array['allowed_views','allowed_wall_subviews','created_at','division_key','enabled','inventory_area','inventory_can_adjust','inventory_can_manage','inventory_can_view','legal_entity','profile_key','updated_at','updated_by','user_id']::text[] then return false; end if;
  return v_employee->>'profile_key'='walls_inventory_counter'
    and v_employee->>'legal_entity'='Superior Walls of North Dakota, LLC'
    and v_employee->>'division_key'='walls' and v_employee->>'inventory_area'='production'
    and v_employee->'enabled'='true'::jsonb and v_employee->'inventory_can_view'='true'::jsonb
    and v_employee->'inventory_can_adjust'='true'::jsonb and v_employee->'inventory_can_manage'='false'::jsonb
    and v_employee->'allowed_wall_subviews'='["production"]'::jsonb
    and (select jsonb_agg(v order by v) from jsonb_array_elements_text(v_employee->'allowed_views') v)='["inventory","overview","walls","weekly-planner"]'::jsonb;
exception when others then return false;
end;
$$;
create function employee_password.mixed_grants_allowed(p_grants jsonb) returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare e jsonb; p jsonb; i jsonb; uid text; seen text[]:='{}'; scope text;
begin
 if jsonb_typeof(p_grants) is distinct from 'object'
  or p_grants->'roles' is distinct from '[]'::jsonb or p_grants->'inventory' is distinct from '[]'::jsonb
  or p_grants->'planner' is distinct from '[]'::jsonb
  or jsonb_array_length(p_grants->'employee') is distinct from 3
  or jsonb_array_length(p_grants->'production') is distinct from 1
  or jsonb_array_length(p_grants->'installation') is distinct from 1 then return false; end if;
 p:=p_grants#>'{production,0}'; i:=p_grants#>'{installation,0}'; uid:=p->>'user_id';
 if uid is null or uid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or p-array['user_id','created_at','updated_at','updated_by'] is distinct from
  '{"can_view":true,"can_update_setup":true,"can_record_pour":true,"can_record_strip":true,"can_report_issue":true,"can_manage_assignments":true,"can_manage_plan":true,"enabled":true}'::jsonb
  or i-array['user_id','updated_at','updated_by'] is distinct from
  '{"can_view":true,"can_manage":false,"can_assign_resources":false,"can_qc":true,"can_record_field_progress":false,"enabled":true}'::jsonb
  or i->>'user_id' is distinct from uid then return false; end if;
 for e in select value from jsonb_array_elements(p_grants->'employee') loop
  scope:=(e->>'division_key')||'/'||(e->>'inventory_area');
  if scope is null or scope<>all(array['walls/production','walls/install','boxes/production']) or scope=any(seen) then return false; end if;
  seen:=array_append(seen,scope);
  if e->>'user_id' is distinct from uid or
   e-array['user_id','created_at','updated_at','updated_by','division_key','inventory_area','legal_entity','allowed_views','allowed_wall_subviews'] is distinct from
   '{"profile_key":"walls_production_inventory_qc_v1","enabled":true,"inventory_can_view":true,"inventory_can_adjust":true,"inventory_can_manage":true}'::jsonb
   or e->>'legal_entity' is distinct from (case when e->>'division_key'='walls' then 'Superior Walls of North Dakota, LLC' else 'Superior Precast Structures, LLC' end)
   or (select jsonb_agg(value order by value) from jsonb_array_elements_text(e->'allowed_views')) is distinct from '["block","boxes","fence","inventory","manholes","overview","qc","walls","weekly-planner"]'::jsonb
   or (select jsonb_agg(value order by value) from jsonb_array_elements_text(e->'allowed_wall_subviews')) is distinct from '["installation","production"]'::jsonb then return false; end if;
 end loop;
 return true;
exception when others then return false;
end;
$$;
create or replace function employee_password.scope_allowed(p_grants jsonb) returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
 if (select array_agg(k order by k) from jsonb_object_keys(p_grants) k) is distinct from
  array['authority_fingerprint','employee','installation','inventory','planner','production','roles']::text[] then return false; end if;
 return coalesce(employee_password.pilot_grants_allowed(p_grants),false) or employee_password.mixed_grants_allowed(p_grants);
exception when others then return false;
end;
$$;
create function employee_password.mixed_scope() returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
 select '{"enabled":true,"preset":"walls_production_inventory_qc_v1","division":"walls","production_views":["today","five_day","table_board","weekly_forecast"],"production_actions":["setup","pour","strip","issue","assign","plan"],"production_write":true,"production_full_read":false,"inventory_scopes":["walls/production","walls/install","boxes/production"],"inventory_counts":true,"inventory_manage":true,"inventory_other_mutations":false,"field_work":"read_only","qc_divisions":["walls"],"approved_walls_packs":true,"unapproved_packs":false,"management":false,"purchasing":false,"approvals":false,"other_divisions":["boxes","manholes","fence","block"],"other_division_write":false,"independent_grants":["walls_production","walls_installation_view_qc"]}'::jsonb;
$$;
create function employee_password.effective_scope(p_grants jsonb) returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
 select case when employee_password.scope_allowed(p_grants) then case when employee_password.mixed_grants_allowed(p_grants) then employee_password.mixed_scope() else employee_password.pilot_scope() end else null end;
$$;
create or replace function employee_password.record_payload(p_record employee_password.approved_records) returns jsonb
language sql immutable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('record_id',p_record.record_id,'version',p_record.version,'auth_uid',p_record.auth_uid,
   'auth_email',p_record.auth_email,'username',p_record.username,'setup_completed',p_record.setup_completed,'effective_scope',employee_password.effective_scope(p_record.reviewed_grants));
$$;
create or replace function public.employee_password_owner_targets() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not employee_password.owner_allowed(auth.uid()) then raise exception using errcode='42501',message='Password administration unavailable'; end if;
 return coalesce((select jsonb_agg(x.row order by x.record_id) from (
   select r.record_id,jsonb_build_object('record_id',r.record_id,'version',r.version,'auth_uid',r.auth_uid,'display_name',r.display_name,
     'username',r.username,'setup_completed',r.setup_completed,'scope_label',case when employee_password.mixed_grants_allowed(r.reviewed_grants) then 'Walls production edit / all three inventory tabs / Walls QC / field, other divisions and approved weekly packs read-only' else 'Walls production / inventory counts / approved Walls crew packs' end,
     'status',coalesce(c.phase,case when s.enabled and employee_password.record_allowed(r,s) then 'ready' else 'unavailable' end)) as row
   from employee_password.approved_records r cross join employee_password.settings s
   left join employee_password.target_locks l on l.auth_uid=r.auth_uid left join employee_password.challenges c on c.challenge_id=l.challenge_id
   where s.singleton order by r.record_id limit 20
 )x),'[]'::jsonb);
end;
$$;
revoke all on function employee_password.pilot_grants_allowed(jsonb) from public,anon,authenticated,service_role;
revoke all on function employee_password.mixed_grants_allowed(jsonb) from public,anon,authenticated,service_role;
revoke all on function employee_password.mixed_scope() from public,anon,authenticated,service_role;
revoke all on function employee_password.effective_scope(jsonb) from public,anon,authenticated,service_role;
commit;
