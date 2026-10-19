-- Empty resource status fields should remain explicitly unconfirmed, matching
-- the table defaults and the Installation UI's safe initial state.
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
    if v_row.version<>p_expected_version then raise exception 'Installation activity changed; refresh and retry'; end if;
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

