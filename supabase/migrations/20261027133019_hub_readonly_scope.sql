-- Local reviewed candidate only; no identities or business records are enrolled.
begin;
alter table public.app_employee_access drop constraint app_employee_access_profile_key_check;
alter table public.app_employee_access add constraint app_employee_access_profile_key_check check(profile_key in ('walls_inventory_counter','plant_manager_readonly','walls_production_inventory_qc_v1','hub_readonly_v1'));
alter table public.app_employee_access add constraint app_employee_hub_readonly_shape check(profile_key<>'hub_readonly_v1' or (division_key='walls' and inventory_area='production' and legal_entity='Superior Walls of North Dakota, LLC' and inventory_can_view and not inventory_can_adjust and not inventory_can_manage and cardinality(allowed_views)=17 and allowed_views @> array['today','overview','walls','boxes','manholes','fence','block','qc','delivery','inventory','weekly-planner','billing','exceptions','import','audit','history','search']::text[] and cardinality(allowed_wall_subviews)=8 and allowed_wall_subviews @> array['production','installation','current','overall','active','plans','monthly','year']::text[]));
create or replace function public.has_hub_readonly_profile()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
select auth.uid() is not null and exists(select 1 from public.app_employee_access where user_id=auth.uid() and profile_key='hub_readonly_v1');
$$;
create or replace function public.is_operations_reader()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
select auth.uid() is not null
 and (select count(*)=1 and bool_and(enabled and profile_key='hub_readonly_v1' and division_key='walls' and inventory_area='production' and legal_entity='Superior Walls of North Dakota, LLC' and inventory_can_view and not inventory_can_adjust and not inventory_can_manage and cardinality(allowed_views)=17 and allowed_views @> array['today','overview','walls','boxes','manholes','fence','block','qc','delivery','inventory','weekly-planner','billing','exceptions','import','audit','history','search']::text[] and cardinality(allowed_wall_subviews)=8 and allowed_wall_subviews @> array['production','installation','current','overall','active','plans','monthly','year']::text[]) from public.app_employee_access where user_id=auth.uid())
 and not exists(select 1 from public.app_user_roles where user_id=auth.uid())
 and not exists(select 1 from public.walls_production_access where user_id=auth.uid())
 and not exists(select 1 from public.walls_installation_access where user_id=auth.uid())
 and not exists(select 1 from public.weekly_planner_access where user_id=auth.uid())
 and not exists(select 1 from public.inventory_user_access where email=lower(coalesce(auth.jwt()->>'email','')))
 and not exists(select 1 from employee_password.owners where user_id=auth.uid());
$$;
create or replace function public.is_operations_admin()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
select not public.has_hub_readonly_profile() and exists(select 1 from public.app_user_roles where user_id=auth.uid() and can_write);
$$;
create or replace function public.operations_can_read_full()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
select public.is_operations_admin() or public.is_operations_reader();
$$;
revoke all on function public.has_hub_readonly_profile(),public.is_operations_reader(),public.operations_can_read_full() from public,anon;
grant execute on function public.has_hub_readonly_profile(),public.is_operations_reader(),public.operations_can_read_full() to authenticated;
create or replace function public.inventory_scope_access(
  p_division_key text,
  p_inventory_area text,
  p_permission text default 'view'
)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when public.has_hub_readonly_profile() then public.is_operations_reader() and (p_permission='view' and ((p_division_key='walls' and p_inventory_area in ('production','install')) or (p_division_key='boxes' and p_inventory_area='production'))) else (select public.is_operations_admin() or ((not public.has_mixed_operations_profile() or (public.mixed_operations_profile_active() and ((p_division_key='walls' and p_inventory_area in ('production','install')) or (p_division_key='boxes' and p_inventory_area='production')))) and (exists (
    select 1 from public.inventory_user_access a
    where a.email=lower(coalesce(auth.jwt()->>'email','')) and a.enabled
      and a.division_key=p_division_key and a.inventory_area=p_inventory_area
      and case p_permission
        when 'manage' then a.can_manage
        when 'adjust' then (a.can_adjust or a.can_manage)
        else (a.can_view or a.can_adjust or a.can_manage)
      end
  ) or exists (
    select 1 from public.app_employee_access a
    where a.user_id=auth.uid() and a.enabled
      and a.division_key=p_division_key and a.inventory_area=p_inventory_area
      and case p_permission
        when 'manage' then a.inventory_can_manage
        when 'adjust' then (a.inventory_can_adjust or a.inventory_can_manage)
        else (a.inventory_can_view or a.inventory_can_adjust or a.inventory_can_manage)
      end
  )))) end;
$$;
create or replace function public.walls_production_permission(p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when public.has_hub_readonly_profile() then public.is_operations_reader() and (p_permission='view') else (select public.is_operations_admin() or ((not public.has_mixed_operations_profile() or public.mixed_operations_profile_active()) and (exists (
    select 1 from public.walls_production_access a where a.user_id=auth.uid() and a.enabled and
      case p_permission
        when 'setup' then a.can_update_setup
        when 'pour' then a.can_record_pour
        when 'strip' then a.can_record_strip
        when 'issue' then a.can_report_issue
        when 'assign' then a.can_manage_assignments
        when 'plan' then a.can_manage_plan
        else a.can_view
      end
  ) or (p_permission='view' and exists (
    select 1 from public.app_employee_access a where a.user_id=auth.uid() and a.enabled and a.division_key='walls' and a.inventory_area='production' and 'walls'=any(a.allowed_views)
  ))))) end;
$$;
create or replace function public.walls_installation_permission(p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when public.has_hub_readonly_profile() then public.is_operations_reader() and (p_permission='view') else (select public.is_operations_admin() or ((not public.has_mixed_operations_profile() or public.mixed_operations_profile_active()) and (not public.has_mixed_operations_profile() or p_permission in ('view','qc')) and exists(select 1 from public.walls_installation_access a where a.user_id=auth.uid() and a.enabled and case p_permission when 'manage' then a.can_manage when 'resources' then a.can_assign_resources when 'qc' then a.can_qc when 'field_progress' then a.can_record_field_progress else a.can_view end))) end;
$$;
create or replace function public.weekly_planner_permission(p_permission text default 'view',p_section_key text default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when public.has_hub_readonly_profile() then public.is_operations_reader() and (p_permission='view') else (select public.is_operations_admin() or exists (
    select 1 from public.weekly_planner_access a
    where a.user_id=auth.uid() and a.enabled
      and (cardinality(a.allowed_sections)=0 or p_section_key is null or p_section_key=any(a.allowed_sections))
      and case p_permission when 'publish' then a.can_publish when 'approve' then a.can_approve
        when 'edit' then a.can_edit else a.can_view end
  )) end;
$$;
create or replace function public.inventory_access(p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when public.has_hub_readonly_profile() then public.is_operations_reader() and (p_permission='view') else (select public.inventory_scope_access('walls','production',p_permission)) end;
$$;
create or replace function public.can_read_full_walls_production()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when public.has_hub_readonly_profile() then public.is_operations_reader() and (true) else (select auth.uid() is not null and (public.is_operations_admin() or (not public.has_mixed_operations_profile() and exists(
    select 1 from public.walls_production_access a where a.user_id=auth.uid() and a.enabled and a.can_view)))) end;
$$;
create or replace function public.can_read_full_inventory(p_division_key text,p_inventory_area text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when public.has_hub_readonly_profile() then public.is_operations_reader() and (((p_division_key='walls' and p_inventory_area in ('production','install')) or (p_division_key='boxes' and p_inventory_area='production'))) else (select auth.uid() is not null and (public.is_operations_admin() or exists(
    select 1 from public.inventory_user_access a where a.email=lower(coalesce(auth.jwt()->>'email','')) and a.enabled
      and a.division_key=p_division_key and a.inventory_area=p_inventory_area and (a.can_view or a.can_adjust or a.can_manage)))) end;
$$;
create or replace function public.get_app_access()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_role public.app_user_roles%rowtype;v_employee public.app_employee_access%rowtype;v_views text[];v_walls boolean;v_field boolean;v_wall_subviews text[];
begin
  if public.has_hub_readonly_profile() then
    if not public.is_operations_reader() then return jsonb_build_object('authorized',false,'profile_key','none','can_write',false,'is_admin',false,'full_read_access',false,'allowed_views','[]'::jsonb,'allowed_wall_subviews','[]'::jsonb); end if;
    return jsonb_build_object('authorized',true,'profile_key','hub_readonly_v1','can_write',false,'is_admin',false,'full_read_access',true,'allowed_views',to_jsonb(array['today','overview','walls','boxes','manholes','fence','block','qc','delivery','inventory','weekly-planner','billing','exceptions','import','audit','history','search']::text[]),'allowed_wall_subviews',to_jsonb(array['production','installation','current','overall','active','plans','monthly','year']::text[]));
  end if;
  select * into v_role from public.app_user_roles where user_id=auth.uid();
  if found then return jsonb_build_object('authorized',true,'profile_key',coalesce(v_role.role,'viewer'),'can_write',v_role.can_write,'is_admin',v_role.can_write,'full_read_access',v_role.can_write,
    'allowed_views',to_jsonb(array['overview','walls','boxes','manholes','fence','block','qc','delivery','inventory','billing','exceptions','import','audit','history']::text[]),
    'allowed_wall_subviews',to_jsonb(array['production','current','overall','active','plans','monthly','year']::text[])); end if;
  if public.has_mixed_operations_profile() then
    if not public.mixed_operations_profile_active() then
      return jsonb_build_object('authorized',false,'profile_key','none','can_write',false,'is_admin',false,'allowed_views','[]'::jsonb,'allowed_wall_subviews','[]'::jsonb);
    end if;
    return jsonb_build_object('authorized',true,'profile_key','walls_production_inventory_qc_v1','can_write',false,'is_admin',false,
      'allowed_views',to_jsonb(array['overview','walls','inventory','boxes','manholes','fence','block','qc','weekly-planner']::text[]),
      'allowed_wall_subviews',to_jsonb(array['production','installation']::text[]),'division_key','walls','inventory_area','production');
  end if;
  select * into v_employee from public.app_employee_access where user_id=auth.uid() and enabled order by division_key,inventory_area limit 1;
  if found then
    v_walls:=public.walls_production_permission('view');
    v_field:=public.walls_installation_permission('view') and exists(select 1 from public.app_employee_access a where a.user_id=auth.uid() and a.enabled and 'installation'=any(a.allowed_wall_subviews));
    v_wall_subviews:=array[]::text[];
    if v_walls then v_wall_subviews:=array_append(v_wall_subviews,'production'); end if;
    if v_field then v_wall_subviews:=array_append(v_wall_subviews,'installation'); end if;
    v_views:=array['overview']::text[];
    if v_walls or v_field then v_views:=array_append(v_views,'walls'); end if;
    if jsonb_array_length(public.get_inventory_scopes())>0 then v_views:=array_append(v_views,'inventory'); end if;
    if exists(select 1 from public.app_employee_access a where a.user_id=auth.uid() and a.enabled and a.division_key='walls' and a.inventory_area='production' and 'weekly-planner'=any(a.allowed_views)) then v_views:=array_append(v_views,'weekly-planner'); end if;
    return jsonb_build_object('authorized',true,'profile_key',v_employee.profile_key,'can_write',false,'is_admin',false,
      'allowed_views',to_jsonb(v_views),'allowed_wall_subviews',to_jsonb(v_wall_subviews),
      'division_key',v_employee.division_key,'inventory_area',v_employee.inventory_area);
  end if;
  return jsonb_build_object('authorized',false,'profile_key','none','can_write',false,'is_admin',false,'allowed_views','[]'::jsonb,'allowed_wall_subviews','[]'::jsonb);
end;
$$;
create or replace function public.get_schedule_snapshot()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_meta public.schedule_meta%rowtype; v_data jsonb; v_access public.app_employee_access%rowtype;
begin
  if public.has_hub_readonly_profile() and not public.is_operations_reader() then raise exception 'Not authorized'; end if;
  select * into v_meta from public.schedule_meta where id=1;
  if public.operations_can_read_full() then
    v_data:=public.compose_schedule_data(); if public.is_operations_reader() then v_data:=v_data-'migrationBackup'-'systemFlags'||jsonb_build_object('migrationBackup',null,'systemFlags','{}'::jsonb); end if;
  else
    select * into v_access from public.app_employee_access where user_id=auth.uid() and enabled;
    if not found then raise exception 'Not authorized'; end if;
    if public.has_mixed_operations_profile() and not public.mixed_operations_profile_active() then raise exception 'Not authorized'; end if;
    v_data:=jsonb_build_object(
      'walls',coalesce((select jsonb_agg(public.employee_wall_projection(r.data) order by r.ordinal) from public.schedule_records r where r.collection='walls' and r.division='walls' and public.walls_production_permission('view')),'[]'::jsonb),
      'jobs',case when public.mixed_operations_profile_active() then coalesce((select jsonb_agg(public.mixed_employee_job_projection(r.data,r.division) order by r.ordinal) from public.schedule_records r where r.collection='jobs' and r.division in ('boxes','manholes','fence','block')),'[]'::jsonb) else '[]'::jsonb end,'billing','[]'::jsonb,'audit','[]'::jsonb,'historyArchive','[]'::jsonb,
      'deliveryHistory','[]'::jsonb,'qcHistory','[]'::jsonb,'loads','[]'::jsonb,
      'migrationBackup',null,'systemFlags','{}'::jsonb
    );
  end if;
  return jsonb_build_object('id',1,'revision',v_meta.revision,'updated_at',v_meta.updated_at,'updated_by',case when public.operations_can_read_full() then v_meta.updated_by else null end,
    'payload',jsonb_build_object('schemaVersion',v_meta.schema_version,'data',v_data));
end;
$$;
create or replace function public.can_edit_schedule()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
select public.is_operations_admin();
$$;
create or replace function public.execute_operations_agent_action(p_action_id uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_action public.operations_agent_actions%rowtype;v_item public.inventory_items%rowtype;v_assignment public.walls_production_assignments%rowtype;
v_result jsonb;v_expected bigint;v_error text;
begin
  if public.has_hub_readonly_profile() then raise exception 'Read-only account'; end if;
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_confirmation is distinct from 'CONFIRM' then raise exception 'Explicit confirmation required'; end if;
  select * into v_action from public.operations_agent_actions where action_id=p_action_id for update;
  if not found or v_action.requested_by_user_id is distinct from auth.uid() then raise exception 'Pending agent action not found'; end if;
  if v_action.status<>'pending' then raise exception 'Agent action is no longer pending'; end if;
  if v_action.expires_at<=now() then
    update public.operations_agent_actions set status='expired',error_message='Confirmation window expired' where action_id=p_action_id;
    return jsonb_build_object('ok',false,'status','expired','message','This action expired. Ask the assistant to prepare it again.');
  end if;
  begin
    v_expected:=(v_action.parameters->>'expected_version')::bigint;
    if v_action.action_type='set_inventory_count' then
      select * into v_item from public.inventory_items where item_id=(v_action.parameters->>'item_id')::bigint for update;
      if not found or v_item.version is distinct from v_expected then raise exception 'Inventory changed after this preview. No action was taken.'; end if;
      v_result:=public.set_inventory_count(v_item.item_id,v_expected,(v_action.parameters->>'quantity')::integer);
    elsif v_action.action_type='advance_production_stage' then
      select * into v_assignment from public.walls_production_assignments where assignment_id=(v_action.parameters->>'assignment_id')::uuid for update;
      if not found or v_assignment.version is distinct from v_expected then raise exception 'Production assignment changed after this preview. No action was taken.'; end if;
      v_result:=public.advance_walls_production_stage(
        v_assignment.assignment_id,v_action.parameters->>'new_stage',nullif(v_action.parameters->>'setup_progress','')::integer,
        nullif(v_action.parameters->>'actual_lf','')::numeric,coalesce((v_action.parameters->>'pre_pour_ready')::boolean,false),coalesce(v_action.parameters->>'note','')
      );
    else
      select * into v_assignment from public.walls_production_assignments where assignment_id=(v_action.parameters->>'assignment_id')::uuid for update;
      if not found or v_assignment.version is distinct from v_expected then raise exception 'Production assignment changed after this preview. No action was taken.'; end if;
      v_result:=public.update_walls_production_setup_progress(v_assignment.assignment_id,(v_action.parameters->>'setup_progress')::integer,coalesce(v_action.parameters->>'note',''));
    end if;
    update public.operations_agent_actions set status='executed',confirmed_at=now(),executed_at=now(),result=v_result,error_message=null where action_id=p_action_id returning * into v_action;
    return jsonb_build_object('ok',true,'status','executed','action',public.employee_agent_action_projection(to_jsonb(v_action)));
  exception when others then
    get stacked diagnostics v_error=message_text;
    update public.operations_agent_actions set status='failed',confirmed_at=now(),error_message=left(v_error,1000) where action_id=p_action_id returning * into v_action;
    return jsonb_build_object('ok',false,'status','failed','message',v_error,'action',public.employee_agent_action_projection(to_jsonb(v_action)));
  end;
end;
$$;
create or replace function public.reject_operations_agent_action(p_action_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_action public.operations_agent_actions%rowtype;
begin
  if public.has_hub_readonly_profile() then raise exception 'Read-only account'; end if;
  update public.operations_agent_actions set status='rejected'
  where action_id=p_action_id and requested_by_user_id=auth.uid() and status='pending'
  returning * into v_action;
  if not found then raise exception 'Pending agent action not found'; end if;
  return jsonb_build_object('ok',true,'status','rejected','action',public.employee_agent_action_projection(to_jsonb(v_action)));
end;
$$;
create policy "Full Hub readonly select" on public.schedule_meta for select to authenticated using ((select public.is_operations_reader()));
create policy "Full Hub readonly select" on public.schedule_records for select to authenticated using ((select public.is_operations_reader()));
create policy "Full Hub readonly select" on public.schedule_milestones for select to authenticated using ((select public.is_operations_reader()));
create policy "Full Hub readonly select" on public.schedule_change_log for select to authenticated using ((select public.is_operations_reader()));
create policy "Full Hub readonly roster" on public.schedule_settings for select to authenticated using((select public.is_operations_reader()) and setting_key='companyEmployeeRoster');
drop policy if exists "Employee projection only" on public.schedule_meta;
create policy "Employee projection only" on public.schedule_meta as restrictive for select to authenticated using((select public.operations_can_read_full()));
commit;
