-- Strict all-Hub reader password eligibility. No identity, grant or reviewed-record writes.
-- Applying authority changes requires separately reviewed fingerprint refreshes.
begin;
create function employee_password.hub_readonly_grants_allowed(p_grants jsonb) returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare e jsonb; uid text;
begin
 if jsonb_typeof(p_grants) is distinct from 'object' or jsonb_array_length(p_grants->'employee') is distinct from 1
  or p_grants->'roles' is distinct from '[]'::jsonb or p_grants->'inventory' is distinct from '[]'::jsonb
  or p_grants->'production' is distinct from '[]'::jsonb or p_grants->'installation' is distinct from '[]'::jsonb
  or p_grants->'planner' is distinct from '[]'::jsonb then return false; end if;
 e:=p_grants#>'{employee,0}'; uid:=e->>'user_id';
 if uid is null or uid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or (select array_agg(k order by k) from jsonb_object_keys(e) k) is distinct from
   array['allowed_views','allowed_wall_subviews','created_at','division_key','enabled','inventory_area','inventory_can_adjust','inventory_can_manage','inventory_can_view','legal_entity','profile_key','updated_at','updated_by','user_id']::text[]
  or e-array['user_id','created_at','updated_at','updated_by','allowed_views','allowed_wall_subviews'] is distinct from
   '{"profile_key":"hub_readonly_v1","legal_entity":"Superior Walls of North Dakota, LLC","division_key":"walls","inventory_area":"production","enabled":true,"inventory_can_view":true,"inventory_can_adjust":false,"inventory_can_manage":false}'::jsonb
  or (select jsonb_agg(value order by value) from jsonb_array_elements_text(e->'allowed_views')) is distinct from '["audit", "billing", "block", "boxes", "delivery", "exceptions", "fence", "history", "import", "inventory", "manholes", "overview", "qc", "search", "today", "walls", "weekly-planner"]'::jsonb
  or (select jsonb_agg(value order by value) from jsonb_array_elements_text(e->'allowed_wall_subviews')) is distinct from '["active", "current", "installation", "monthly", "overall", "plans", "production", "year"]'::jsonb then return false; end if;
return true;
exception when others then return false;
end;
$$;
create or replace function employee_password.scope_allowed(p_grants jsonb) returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
 if (select array_agg(k order by k) from jsonb_object_keys(p_grants) k) is distinct from
  array['authority_fingerprint','employee','installation','inventory','planner','production','roles']::text[] then return false; end if;
 return coalesce(employee_password.pilot_grants_allowed(p_grants),false) or employee_password.mixed_grants_allowed(p_grants) or employee_password.hub_readonly_grants_allowed(p_grants);
exception when others then return false;
end;
$$;
create function employee_password.hub_readonly_scope() returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$ select '{"enabled": true, "preset": "hub_readonly_v1", "full_read_access": true, "business_views": ["today", "overview", "walls", "boxes", "manholes", "fence", "block", "qc", "delivery", "inventory", "weekly-planner", "billing", "exceptions", "import", "audit", "history", "search"], "wall_subviews": ["production", "installation", "current", "overall", "active", "plans", "monthly", "year"], "inventory_scopes": ["walls/production", "walls/install", "boxes/production"], "qc_divisions": ["walls", "boxes", "manholes", "fence", "block"], "planner_drafts": true, "management_read": true, "can_write": false, "is_admin": false, "inventory_counts": false, "inventory_manage": false, "purchasing": false, "approvals": false, "password_admin": false, "independent_grants": []}'::jsonb; $$;
create or replace function employee_password.effective_scope(p_grants jsonb) returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
 select case when employee_password.scope_allowed(p_grants) then case when employee_password.hub_readonly_grants_allowed(p_grants) then employee_password.hub_readonly_scope() when employee_password.mixed_grants_allowed(p_grants) then employee_password.mixed_scope() else employee_password.pilot_scope() end else null end;
$$;
create or replace function public.employee_password_owner_targets() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not employee_password.owner_allowed(auth.uid()) then raise exception using errcode='42501',message='Password administration unavailable'; end if;
 return coalesce((select jsonb_agg(x.row order by x.record_id) from (
   select r.record_id,jsonb_build_object('record_id',r.record_id,'version',r.version,'auth_uid',r.auth_uid,'display_name',r.display_name,
     'username',r.username,'setup_completed',r.setup_completed,'scope_label',case when employee_password.hub_readonly_grants_allowed(r.reviewed_grants) then 'All Hub business screens read-only / no edits, approvals or password administration' when employee_password.mixed_grants_allowed(r.reviewed_grants) then 'Walls production edit / all three inventory tabs / Walls QC / field, other divisions and approved weekly packs read-only' else 'Walls production / inventory counts / approved Walls crew packs' end,
     'status',coalesce(c.phase,case when s.enabled and employee_password.record_allowed(r,s) then 'ready' else 'unavailable' end)) as row
   from employee_password.approved_records r cross join employee_password.settings s
   left join employee_password.target_locks l on l.auth_uid=r.auth_uid left join employee_password.challenges c on c.challenge_id=l.challenge_id
   where s.singleton order by r.record_id limit 20
 )x),'[]'::jsonb);
end;
$$;
create or replace function employee_password.owner_allowed(p_uid uuid) returns boolean language plpgsql stable security invoker set search_path=pg_catalog as $$
declare v_ok boolean;
begin
  if p_uid is null or exists(select 1 from public.app_employee_access where user_id=p_uid and profile_key='hub_readonly_v1') or not exists(select 1 from employee_password.owners where user_id=p_uid and enabled) then return false; end if;
  -- Explicit nonsecret native fields only. No password/hash/token columns read.
  select not u.is_anonymous and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    into v_ok from auth.users u where u.id=p_uid;
  return coalesce(v_ok,false);
exception when undefined_column or undefined_table then return false;
end;
$$;
create or replace function employee_password.record_allowed(p_record employee_password.approved_records,p_settings employee_password.settings)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog as $$
declare v_actual jsonb;
begin
 if p_record.record_id is null or not p_record.enabled or p_record.reviewed_at>clock_timestamp()
   or p_settings.identifier_domain is null or split_part(p_record.auth_email,'@',2)<>p_settings.identifier_domain then return false; end if;
 if exists(select 1 from public.app_employee_access where user_id=p_record.auth_uid and profile_key='hub_readonly_v1') and exists(select 1 from employee_password.owners where user_id=p_record.auth_uid) then return false; end if;
 v_actual:=employee_password.current_grants(p_record.auth_uid,p_record.auth_email);
 return employee_password.scope_allowed(v_actual) and v_actual=p_record.reviewed_grants
   and employee_password.native_target_allowed(p_record.auth_uid,p_record.auth_email,p_record.setup_completed);
end;
$$;
revoke all on function employee_password.hub_readonly_grants_allowed(jsonb),employee_password.hub_readonly_scope() from public,anon,authenticated,service_role;
commit;
