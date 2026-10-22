-- Reject NULL concurrency tokens wherever an existing row already requires a matching version.
-- Definition-only repair: authorization, optional-token APIs, data, and ACLs are unchanged.
begin;

-- The assignment definition below builds on the separately reviewed allocation mutex.
-- Refuse out-of-order application rather than installing that prerequisite implicitly.
do $allocation_prerequisite$
declare v_signature text;v_definition text;
begin
  foreach v_signature in array array[
    'public.validate_walls_production_assignment()',
    'public.upsert_walls_production_assignment(uuid,text,text,numeric,numeric,timestamp without time zone,timestamp without time zone,timestamp without time zone,text,bigint)'
  ] loop
    v_definition:=pg_catalog.pg_get_functiondef(v_signature::regprocedure);
    if position('pg_advisory_xact_lock' in v_definition)=0
      or position('superior_walls_production_allocation:' in v_definition)=0 then
      raise exception 'Apply serialize_production_allocation before mandatory_version_tokens_fail_closed';
    end if;
  end loop;
end;
$allocation_prerequisite$;

-- Existing definition from 20261021215458_serialize_production_allocation.sql; only the mandatory version comparison changes.
create or replace function public.upsert_walls_production_assignment(
  p_assignment_id uuid,p_wall_record_id text,p_table_id text,p_wall_height numeric,p_planned_lf numeric,
  p_setup_start_at timestamp,p_pour_at timestamp,p_strip_at timestamp,p_notes text default '',p_expected_version bigint default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_production_assignments%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.walls_production_permission('assign') then raise exception 'Table-assignment permission required'; end if;
  -- Acquire the target-job allocation mutex before an existing assignment row.
  -- Reparenting locks only its target job; no source/target parent-row cycle.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('superior_walls_production_allocation:'||p_wall_record_id,0));
  if p_assignment_id is null then
    insert into public.walls_production_assignments(wall_record_id,table_id,wall_height,planned_lf,setup_start_at,pour_at,strip_at,notes,created_by,updated_by)
    values(p_wall_record_id,p_table_id,p_wall_height,p_planned_lf,p_setup_start_at,p_pour_at,p_strip_at,coalesce(p_notes,''),v_actor,v_actor) returning * into v_row;
    insert into public.walls_production_events(assignment_id,event_type,new_stage,detail,actor_email) values(v_row.assignment_id,'assignment_created','planned',jsonb_build_object('planned_lf',p_planned_lf,'table_id',p_table_id),v_actor);
  else
    select * into v_row from public.walls_production_assignments where assignment_id=p_assignment_id for update;
    if not found then raise exception 'Production assignment not found'; end if;
    if v_row.version is distinct from p_expected_version then raise exception 'Production assignment version conflict'; end if;
    if v_row.stage<>'planned' then raise exception 'Started production must be preserved; only planned assignments can be rescheduled'; end if;
    update public.walls_production_assignments set wall_record_id=p_wall_record_id,table_id=p_table_id,wall_height=p_wall_height,planned_lf=p_planned_lf,
      setup_start_at=p_setup_start_at,pour_at=p_pour_at,strip_at=p_strip_at,notes=coalesce(p_notes,''),needs_review=false,review_reason=''
      where assignment_id=p_assignment_id returning * into v_row;
    insert into public.walls_production_events(assignment_id,event_type,previous_stage,new_stage,detail,actor_email) values(v_row.assignment_id,'assignment_updated','planned','planned',jsonb_build_object('planned_lf',p_planned_lf,'table_id',p_table_id),v_actor);
  end if;
  return to_jsonb(v_row);
end;
$$;

-- Existing definition from 20261014_008_inventory_scope_restructure.sql; only the mandatory version comparison changes.
create or replace function public.set_inventory_item(p_item_id bigint,p_expected_version bigint,p_quantity integer,p_reorder_threshold integer,p_unit text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.inventory_items%rowtype;v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_item_access(p_item_id,'manage') then raise exception 'Inventory management access required'; end if;
  if p_quantity is not null and p_quantity<0 then raise exception 'Quantity cannot be negative'; end if;
  if p_reorder_threshold is not null and p_reorder_threshold<0 then raise exception 'Reorder threshold cannot be negative'; end if;
  if p_unit not in ('units','boxes','bags','rolls','bundles','pallets','pieces','boards','lengths','sticks') then raise exception 'Unsupported inventory unit'; end if;
  select * into v_old from public.inventory_items where item_id=p_item_id for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if v_old.version is distinct from p_expected_version then raise exception 'Inventory version conflict'; end if;
  update public.inventory_items set quantity=p_quantity,reorder_threshold=p_reorder_threshold,unit=p_unit,
    ordered=case when p_quantity is not null and p_reorder_threshold is not null and p_quantity>p_reorder_threshold then false else ordered end,
    updated_by=v_actor where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email)
  values(p_item_id,'corrected',v_old.quantity,v_item.quantity,jsonb_build_object('threshold_before',v_old.reorder_threshold,'threshold_after',v_item.reorder_threshold,'unit_before',v_old.unit,'unit_after',v_item.unit),v_actor);
  return to_jsonb(v_item);
end;
$$;

-- Existing definition from 20261013_004_employee_access_inventory_automation.sql; only the mandatory version comparison changes.
create or replace function public.set_inventory_count(p_item_id bigint,p_expected_version bigint,p_quantity integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.inventory_items%rowtype; v_item public.inventory_items%rowtype; v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_item_access(p_item_id,'adjust') then raise exception 'Inventory count access required'; end if;
  if p_quantity is null or p_quantity<0 then raise exception 'Quantity must be zero or a positive whole number'; end if;
  select * into v_old from public.inventory_items where item_id=p_item_id for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if v_old.version is distinct from p_expected_version then raise exception 'Inventory version conflict'; end if;
  update public.inventory_items set quantity=p_quantity,updated_by=v_actor
    where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email)
  values(p_item_id,'corrected',v_old.quantity,v_item.quantity,jsonb_build_object('count_only',true),v_actor);
  return to_jsonb(v_item);
end;
$$;

-- Existing definition from 20261016_015_weekly_crew_planner.sql; only the mandatory version comparison changes.
create or replace function public.save_weekly_planner_section(p_section_id uuid,p_expected_version bigint,p_crew_leader text,p_people jsonb,p_assignments jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_section public.weekly_planner_sections%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_item jsonb;
begin
  select * into v_section from public.weekly_planner_sections where section_id=p_section_id for update;
  if not found then raise exception 'Weekly Planner section not found'; end if;
  if not public.weekly_planner_permission('edit',v_section.section_key) then raise exception 'Weekly Planner edit access required'; end if;
  if v_section.schedule_version is distinct from p_expected_version then raise exception 'Weekly Planner version conflict; refresh before saving'; end if;
  if jsonb_typeof(coalesce(p_people,'[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_assignments,'[]'::jsonb))<>'array' then raise exception 'People and assignments must be arrays'; end if;

  update public.weekly_planner_sections set crew_leader=btrim(coalesce(p_crew_leader,'')),schedule_version=schedule_version+1,
    status=case when status='approved' then 'reapproval_required' else 'needs_review' end,approved_by_user_id=null,approved_by_email=null,approved_at=null,
    updated_at=now(),updated_by=v_actor where section_id=p_section_id returning * into v_section;
  delete from public.weekly_planner_section_people where section_id=p_section_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_people,'[]'::jsonb)) loop
    if btrim(coalesce(v_item->>'name',''))<>'' then
      insert into public.weekly_planner_section_people(section_id,employee_name,role_name,is_leader)
      values(p_section_id,btrim(v_item->>'name'),btrim(coalesce(v_item->>'role','')),coalesce((v_item->>'is_leader')::boolean,false)) on conflict do nothing;
    end if;
  end loop;
  delete from public.weekly_planner_assignments where section_id=p_section_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_assignments,'[]'::jsonb)) loop
    if coalesce(v_item->>'work_date','') ~ '^\d{4}-\d{2}-\d{2}$' and (v_item->>'work_date')::date between v_section.week_start and v_section.week_start+4 then
      insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
      values(p_section_id,(v_item->>'work_date')::date,btrim(coalesce(v_item->>'project_location','')),btrim(coalesce(v_item->>'assignment_text','')),
        btrim(coalesce(v_item->>'start_time','')),btrim(coalesce(v_item->>'status_hold','')),btrim(coalesce(v_item->>'backup_instructions','')),
        case when v_item->>'source_authority' in ('linked','manual','manual_required') then v_item->>'source_authority' else 'manual' end,
        btrim(coalesce(v_item->>'source_type','')),btrim(coalesce(v_item->>'source_id','')),
        case when v_item->>'readiness_status' in ('unconfirmed','confirmed','hold','not_applicable') then v_item->>'readiness_status' else 'unconfirmed' end,
        coalesce((v_item->>'sort_order')::integer,0),v_actor);
    end if;
  end loop;
  update public.weekly_planner_packs set is_active=false where week_start=v_section.week_start and is_active;
  insert into public.weekly_planner_audit(week_start,section_key,event_type,detail,actor_user_id,actor_email)
  values(v_section.week_start,v_section.section_key,'section_saved',jsonb_build_object('schedule_version',v_section.schedule_version),auth.uid(),v_actor);
  perform public.rebuild_weekly_planner_conflicts(v_section.week_start);
  return to_jsonb(v_section);
end;
$$;

-- Existing definition from 20261021111232_weekly_planner_stability_and_advisory_gates.sql; only the mandatory version comparison changes.
CREATE OR REPLACE FUNCTION public.approve_weekly_planner_section(p_section_id uuid, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_section public.weekly_planner_sections%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_current text;v_snapshot jsonb;
begin
  select * into v_section from public.weekly_planner_sections where section_id=p_section_id for update;
  if not found then raise exception 'Weekly Planner section not found'; end if;
  if not public.weekly_planner_permission('approve',v_section.section_key) then raise exception 'Weekly Planner approval access required'; end if;
  if v_section.schedule_version is distinct from p_expected_version then raise exception 'Weekly Planner version conflict; refresh before approving'; end if;
  v_current:=public.weekly_planner_source_fingerprint(v_section.week_start);
  if v_section.source_fingerprint<>v_current then raise exception 'Live operations changed; refresh the weekly plan before approval'; end if;
  if btrim(v_section.crew_leader)='' or not exists(select 1 from public.weekly_planner_section_people where section_id=p_section_id) then raise exception 'Confirm the crew leader and assigned employees before approval'; end if;
  perform public.rebuild_weekly_planner_conflicts(v_section.week_start);
  if exists(select 1 from public.weekly_planner_conflicts c where c.week_start=v_section.week_start and c.status='open' and c.severity='block' and (cardinality(c.affected_sections)=0 or v_section.section_key=any(c.affected_sections))) then raise exception 'Resolve or acknowledge the section planning conflicts before approval'; end if;
  v_snapshot:=jsonb_build_object('section',to_jsonb(v_section),'people',coalesce((select jsonb_agg(to_jsonb(p) order by p.is_leader desc,p.employee_name) from public.weekly_planner_section_people p where p.section_id=p_section_id),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.work_date,a.sort_order,a.assignment_id) from public.weekly_planner_assignments a where a.section_id=p_section_id),'[]'::jsonb));
  insert into public.weekly_planner_section_revisions(section_id,week_start,section_key,schedule_version,source_fingerprint,snapshot,approved_by_user_id,approved_by_email)
  values(p_section_id,v_section.week_start,v_section.section_key,v_section.schedule_version,v_current,v_snapshot,auth.uid(),v_actor) on conflict(section_id,schedule_version) do nothing;
  update public.weekly_planner_sections set status='approved',approved_source_fingerprint=v_current,approved_by_user_id=auth.uid(),approved_by_email=v_actor,approved_at=now(),updated_at=now(),updated_by=v_actor
  where section_id=p_section_id returning * into v_section;
  insert into public.weekly_planner_audit(week_start,section_key,event_type,detail,actor_user_id,actor_email)
  values(v_section.week_start,v_section.section_key,'section_approved',jsonb_build_object('schedule_version',v_section.schedule_version,'source_fingerprint',v_current),auth.uid(),v_actor);
  return to_jsonb(v_section);
end;
$function$;

-- Existing definition from 20261018_027_walls_installation_scope_revalidation.sql; only the mandatory version comparison changes.
create or replace function public.set_walls_installation_activity_assignments(
  p_activity_id uuid,
  p_expected_version bigint,
  p_scopes jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_activity public.walls_installation_activities%rowtype;
  v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
  v_item jsonb;
  v_assignment uuid;
  v_load text;
  v_count integer;
  v_before jsonb;
  v_after jsonb;
begin
  if not public.walls_installation_permission('manage') then
    raise exception 'Superior Walls Installation management access required';
  end if;
  if jsonb_typeof(coalesce(p_scopes,'[]'::jsonb))<>'array' then
    raise exception 'Production scope must be an array of assignment/load pairs';
  end if;
  select * into v_activity from public.walls_installation_activities
    where activity_id=p_activity_id for update;
  if not found then raise exception 'Installation activity not found'; end if;
  if v_activity.version is distinct from p_expected_version then
    raise exception 'Installation activity changed; refresh before updating production scope';
  end if;
  if v_activity.status not in ('planned','on_hold') then
    raise exception 'Production scope is locked after field work starts; create a follow-up activity for additional runs';
  end if;
  if v_activity.activity_type not in ('loading_hauling','wall_installation') then
    raise exception 'Production assignment scope is only applicable to loading/hauling and wall installation activities';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('assignment_id',assignment_id,'load_record_id',load_record_id)
    order by assignment_id),'[]'::jsonb) into v_before
    from public.walls_installation_activity_assignments where activity_id=p_activity_id;
  delete from public.walls_installation_activity_assignments where activity_id=p_activity_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_scopes,'[]'::jsonb)) loop
    begin v_assignment:=(v_item->>'assignment_id')::uuid;
    exception when others then raise exception 'Each production scope row requires a valid assignment ID'; end;
    v_load:=nullif(btrim(v_item->>'load_record_id'),'');
    if v_load is null then raise exception 'Each selected production assignment must be linked to a delivery load'; end if;
    if not exists(
      select 1 from public.walls_production_assignments a
      join public.walls_installation_load_assignments lm on lm.assignment_id=a.assignment_id
        and lm.load_record_id=v_load
      join public.schedule_records l on l.collection='loads' and l.record_id=lm.load_record_id
        and l.division='walls' and l.data->>'linkType'='wall' and l.data->>'linkId'=v_activity.wall_record_id
      left join public.walls_installation_qc_releases q on q.assignment_id=a.assignment_id
      where a.assignment_id=v_assignment and a.wall_record_id=v_activity.wall_record_id
        and a.stage='stripped' and q.status='released'
        and not exists(select 1 from public.walls_production_issues i
          where i.wall_record_id=v_activity.wall_record_id and i.status='open'
            and (i.assignment_id=a.assignment_id or i.assignment_id is null))
        and (v_activity.activity_type='loading_hauling' or l.data->>'status'='Delivered')
    ) then
      if v_activity.activity_type='wall_installation' then
        raise exception 'Installation scope must contain only this job’s stripped, finally QC-released assignments that belong to a Delivered load';
      else
        raise exception 'Hauling scope must contain only this job’s stripped, finally QC-released assignments with no open assignment hold, linked to the selected load';
      end if;
    end if;
    insert into public.walls_installation_activity_assignments(activity_id,assignment_id,load_record_id,linked_by_user_id,linked_by_email)
      values(p_activity_id,v_assignment,v_load,auth.uid(),v_actor);
  end loop;

  select count(*) into v_count from public.walls_installation_activity_assignments where activity_id=p_activity_id;
  if v_count=0 then raise exception 'Select at least one released production assignment for loading/hauling or installation'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('assignment_id',assignment_id,'load_record_id',load_record_id)
    order by assignment_id),'[]'::jsonb) into v_after
    from public.walls_installation_activity_assignments where activity_id=p_activity_id;
  update public.walls_installation_activities set version=version+1,updated_at=now(),updated_by=v_actor
    where activity_id=p_activity_id returning * into v_activity;
  insert into public.walls_installation_events(wall_record_id,activity_id,event_type,detail,actor_user_id,actor_email)
    values(v_activity.wall_record_id,p_activity_id,'production_assignment_scope_changed',
      jsonb_build_object('before',v_before,'after',v_after,'version',v_activity.version),auth.uid(),v_actor);
  return jsonb_build_object('activity_id',p_activity_id,'version',v_activity.version,'scopes',v_after);
end;
$$;

-- Existing definition from 20261019152227_normalize_installation_resource_status_defaults.sql; only the mandatory version comparison changes.
create or replace function public.save_walls_installation_activity(
  p_activity_id uuid,p_wall_record_id text,p_activity_type text,p_activity_date date,
  p_start_time time,p_end_time time,p_status text,p_resources jsonb default null,
  p_notes text default '',p_expected_version bigint default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_row public.walls_installation_activities%rowtype;
  v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
  v_old_status text;
  v_before jsonb;
  v_item jsonb;
  v_scope_count integer;
  v_old_resources jsonb;
  v_new_resources jsonb;
begin
  if not public.walls_installation_permission('manage') then raise exception 'Superior Walls Installation management access required'; end if;
  if not exists(select 1 from public.schedule_records where collection='walls' and record_id=p_wall_record_id) then raise exception 'Linked Superior Walls job not found'; end if;
  if p_resources is not null and jsonb_typeof(p_resources)<>'array' then raise exception 'Resources must be an array'; end if;
  if coalesce(p_status,'planned') in ('in_progress','completed') and p_activity_type in ('loading_hauling','wall_installation') then
    select count(*) into v_scope_count from public.walls_installation_activity_assignments m
      join public.walls_production_assignments a on a.assignment_id=m.assignment_id
      join public.walls_installation_qc_releases q on q.assignment_id=a.assignment_id and q.status='released'
      join public.walls_installation_load_assignments lm on lm.load_record_id=m.load_record_id and lm.assignment_id=m.assignment_id
      join public.schedule_records l on l.collection='loads' and l.record_id=m.load_record_id and l.division='walls'
        and l.data->>'linkType'='wall' and l.data->>'linkId'=p_wall_record_id
      where m.activity_id=p_activity_id and a.wall_record_id=p_wall_record_id and a.stage='stripped'
        and not exists(select 1 from public.walls_production_issues i where i.wall_record_id=p_wall_record_id and i.status='open'
          and (i.assignment_id=a.assignment_id or i.assignment_id is null))
        and (p_activity_type='loading_hauling' or l.data->>'status'='Delivered');
    if v_scope_count=0 then
      if p_activity_type='wall_installation' then
        raise exception 'Select explicitly released production assignments linked to a Delivered load before starting or completing wall installation';
      else
        raise exception 'Select explicitly released production assignments for this hauling activity';
      end if;
    end if;
    if v_scope_count<>(
      select count(*) from public.walls_installation_activity_assignments where activity_id=p_activity_id
    ) then raise exception 'One or more scoped production runs no longer meet the activity release requirements; refresh the scope and retry'; end if;
    if exists(select 1 from public.walls_installation_issues i where i.wall_record_id=p_wall_record_id and i.status='open' and i.severity='hold') then
      raise exception 'Resolve the open installation hold before field execution';
    end if;
  end if;
  if coalesce(p_status,'planned')='completed' and p_activity_type='wall_installation' then
    if p_activity_id is null then raise exception 'Create and scope the installation activity before completing it'; end if;
    if exists(select 1 from public.walls_installation_activity_assignments m
      where m.activity_id=p_activity_id and exists(select 1 from public.walls_installation_activities a
        join public.walls_installation_activity_assignments prior on prior.activity_id=a.activity_id
        where a.wall_record_id=p_wall_record_id and a.activity_type='wall_installation'
          and a.status='completed' and prior.assignment_id=m.assignment_id and a.activity_id<>p_activity_id)) then
      raise exception 'One or more selected production assignments are already recorded as installed';
    end if;
  end if;

  insert into public.walls_installation_jobs(wall_record_id,created_by,updated_by)
    values(p_wall_record_id,v_actor,v_actor) on conflict(wall_record_id) do nothing;
  if p_activity_id is null then
    insert into public.walls_installation_activities(wall_record_id,activity_type,activity_date,start_time,end_time,status,notes,created_by,updated_by)
      values(p_wall_record_id,p_activity_type,p_activity_date,p_start_time,p_end_time,coalesce(p_status,'planned'),coalesce(p_notes,''),v_actor,v_actor)
      returning * into v_row;
    insert into public.walls_installation_events(wall_record_id,activity_id,event_type,detail,actor_user_id,actor_email)
      values(p_wall_record_id,v_row.activity_id,'activity_created',to_jsonb(v_row),auth.uid(),v_actor);
  else
    select * into v_row from public.walls_installation_activities where activity_id=p_activity_id for update;
    if not found then raise exception 'Installation activity not found'; end if;
    if v_row.wall_record_id<>p_wall_record_id then raise exception 'Activity must remain attached to its original master job'; end if;
    if v_row.version is distinct from p_expected_version then raise exception 'Installation activity changed; refresh and retry'; end if;
    v_old_status:=v_row.status; v_before:=to_jsonb(v_row);
    if v_old_status='completed' and p_status<>'completed' then raise exception 'Completed field activity is preserved; record follow-up work as a new activity'; end if;
    update public.walls_installation_activities set activity_type=p_activity_type,activity_date=p_activity_date,start_time=p_start_time,
      end_time=p_end_time,status=p_status,notes=coalesce(p_notes,''),version=version+1,updated_at=now(),updated_by=v_actor
      where activity_id=p_activity_id returning * into v_row;
    insert into public.walls_installation_events(wall_record_id,activity_id,event_type,detail,actor_user_id,actor_email)
      values(p_wall_record_id,p_activity_id,'activity_updated',jsonb_build_object('before',v_before,'after',to_jsonb(v_row),'from',v_old_status,'to',p_status),auth.uid(),v_actor);
  end if;
  if p_resources is not null then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.resource_type,x.resource_name),'[]'::jsonb) into v_old_resources
      from public.walls_installation_resources x where x.activity_id=v_row.activity_id;
    delete from public.walls_installation_resources where activity_id=v_row.activity_id;
    for v_item in select value from jsonb_array_elements(p_resources) loop
      if coalesce(v_item->>'resource_type','') not in ('crew','employee','equipment','truck','trailer','crane','stone_slinger','other')
        or length(btrim(coalesce(v_item->>'resource_name','')))=0 then raise exception 'Each resource requires a supported type and a name'; end if;
      insert into public.walls_installation_resources(activity_id,resource_type,resource_name,role_name,availability_status,readiness_status,problem_notes,updated_by)
        values(v_row.activity_id,v_item->>'resource_type',btrim(v_item->>'resource_name'),coalesce(v_item->>'role_name',''),
          coalesce(nullif(btrim(v_item->>'availability_status'),''),'unconfirmed'),
          coalesce(nullif(btrim(v_item->>'readiness_status'),''),'unconfirmed'),coalesce(v_item->>'problem_notes',''),v_actor);
    end loop;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.resource_type,x.resource_name),'[]'::jsonb) into v_new_resources
      from public.walls_installation_resources x where x.activity_id=v_row.activity_id;
    insert into public.walls_installation_events(wall_record_id,activity_id,event_type,detail,actor_user_id,actor_email)
      values(p_wall_record_id,v_row.activity_id,'resource_assignments_changed',jsonb_build_object('before',v_old_resources,'after',v_new_resources),auth.uid(),v_actor);
  end if;
  update public.walls_installation_jobs j set
    status=case
      when p_status='on_hold' then 'on_hold'
      when p_status='in_progress' then 'in_progress'
      when p_status='completed' and p_activity_type='wall_installation'
        and not exists(select 1 from public.walls_production_assignments a where a.wall_record_id=p_wall_record_id and a.stage<>'cancelled'
          and not exists(select 1 from public.walls_installation_activity_assignments m
            join public.walls_installation_activities x on x.activity_id=m.activity_id
            where m.assignment_id=a.assignment_id and x.wall_record_id=p_wall_record_id
              and x.activity_type='wall_installation' and x.status='completed')) then 'completed'
      when p_status='completed' and p_activity_type='wall_installation' then 'in_progress'
      else j.status end,
    version=version+1,updated_at=now(),updated_by=v_actor where j.wall_record_id=p_wall_record_id;
  return to_jsonb(v_row);
end;
$$;

-- Existing definition from 20261016_017_walls_installation_execution.sql; only the mandatory version comparison changes.
create or replace function public.update_walls_installation_resource(p_resource_assignment_id uuid,p_expected_version bigint,p_availability_status text,p_readiness_status text,p_role_name text,p_problem_notes text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_installation_resources%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_before jsonb;
begin
  if not public.walls_installation_permission('resources') then raise exception 'Superior Walls Installation resource-management access required';end if;
  select * into v_row from public.walls_installation_resources where resource_assignment_id=p_resource_assignment_id for update;
  if not found then raise exception 'Installation resource assignment not found';end if;
  if v_row.version is distinct from p_expected_version then raise exception 'Resource assignment changed; refresh before saving';end if;
  if p_readiness_status in ('hold','needs_service') and length(btrim(coalesce(p_problem_notes,'')))<3 then raise exception 'Describe the equipment/resource issue before placing it on hold';end if;
  v_before:=to_jsonb(v_row);
  update public.walls_installation_resources set availability_status=p_availability_status,readiness_status=p_readiness_status,role_name=coalesce(p_role_name,''),problem_notes=coalesce(p_problem_notes,''),version=version+1,updated_at=now(),updated_by=v_actor where resource_assignment_id=p_resource_assignment_id returning * into v_row;
  insert into public.walls_installation_events(wall_record_id,activity_id,event_type,detail,actor_user_id,actor_email) select a.wall_record_id,a.activity_id,'resource_readiness_updated',jsonb_build_object('before',v_before,'after',to_jsonb(v_row)),auth.uid(),v_actor from public.walls_installation_activities a where a.activity_id=v_row.activity_id;
  return to_jsonb(v_row);
end;
$$;

commit;
