-- Additive, assignment-scoped release for partial Superior Walls loads and installs.
-- Existing installation activities and delivery history are intentionally not backfilled.

create table if not exists public.walls_installation_activity_assignments (
  activity_id uuid not null references public.walls_installation_activities(activity_id) on delete restrict,
  assignment_id uuid not null references public.walls_production_assignments(assignment_id) on delete restrict,
  load_record_id text not null,
  linked_at timestamptz not null default now(),
  linked_by_user_id uuid references auth.users(id) on delete restrict,
  linked_by_email text not null default '',
  primary key (activity_id, assignment_id),
  foreign key (load_record_id, assignment_id)
    references public.walls_installation_load_assignments(load_record_id, assignment_id) on delete restrict
);

create index if not exists walls_installation_activity_assignments_assignment_idx
  on public.walls_installation_activity_assignments(assignment_id, activity_id);
create index if not exists walls_installation_activity_assignments_load_idx
  on public.walls_installation_activity_assignments(load_record_id, activity_id);

alter table public.walls_installation_activity_assignments enable row level security;
revoke all on public.walls_installation_activity_assignments from public, anon, authenticated;
grant select on public.walls_installation_activity_assignments to authenticated;
create policy "Walls installation activity assignment authorized read"
  on public.walls_installation_activity_assignments for select to authenticated
  using (public.walls_installation_permission('view'));

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
  if v_activity.version<>p_expected_version then
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
          coalesce(v_item->>'availability_status','unconfirmed'),coalesce(v_item->>'readiness_status','unconfirmed'),coalesce(v_item->>'problem_notes',''),v_actor);
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

create or replace function public.enforce_walls_delivery_qc_release()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_old_status text; v_new_status text; v_assignment_count integer; v_released_count integer;
  v_open_issues integer; v_link_id text; v_has_mapping boolean;
begin
  if coalesce(new.division,new.data->>'division')<>'walls' or new.data->>'linkType'<>'wall' then return new; end if;
  v_link_id:=new.data->>'linkId'; v_new_status:=coalesce(new.data->>'status','');
  if tg_op='UPDATE' then v_old_status:=coalesce(old.data->>'status',''); end if;
  if v_new_status in ('Loaded','Delivered') and (tg_op='INSERT' or v_old_status is distinct from v_new_status) then
    select exists(select 1 from public.walls_installation_load_assignments m where m.load_record_id=new.record_id) into v_has_mapping;
    if v_has_mapping then
      select count(*),count(*) filter(where a.stage='stripped' and q.status='released')
        into v_assignment_count,v_released_count
        from public.walls_installation_load_assignments m
        join public.walls_production_assignments a on a.assignment_id=m.assignment_id
        left join public.walls_installation_qc_releases q on q.assignment_id=a.assignment_id
        where m.load_record_id=new.record_id and a.wall_record_id=v_link_id;
      if v_assignment_count<>(select count(*) from public.walls_installation_load_assignments m where m.load_record_id=new.record_id) then
        raise exception 'Every mapped production assignment must remain active and belong to this Superior Walls job';
      end if;
      select count(*) into v_open_issues from public.walls_production_issues i
        where i.status='open' and i.wall_record_id=v_link_id and (
          i.assignment_id is null or exists(select 1 from public.walls_installation_load_assignments m
            where m.load_record_id=new.record_id and m.assignment_id=i.assignment_id));
      if exists(
        select 1 from public.walls_installation_load_assignments m
        join public.schedule_records other_load on other_load.collection='loads' and other_load.record_id=m.load_record_id
        where m.load_record_id<>new.record_id and other_load.division='walls'
          and other_load.data->>'linkType'='wall' and other_load.data->>'linkId'=v_link_id
          and other_load.data->>'status' in ('Loaded','Delivered')
          and exists(select 1 from public.walls_installation_load_assignments this_map
            where this_map.load_record_id=new.record_id and this_map.assignment_id=m.assignment_id)
      ) then raise exception 'One or more selected production assignments are already on a Loaded or Delivered shipment'; end if;
    else
      select count(*),count(*) filter(where a.stage='stripped' and q.status='released')
        into v_assignment_count,v_released_count
        from public.walls_production_assignments a
        left join public.walls_installation_qc_releases q on q.assignment_id=a.assignment_id
        where a.wall_record_id=v_link_id and a.stage<>'cancelled';
      select count(*) into v_open_issues from public.walls_production_issues i
        where i.wall_record_id=v_link_id and i.status='open';
    end if;
    if v_assignment_count=0 or v_assignment_count<>v_released_count or v_open_issues>0 then
      raise exception 'Linked Superior Walls delivery requires every selected production assignment stripped and finally QC released, with no open hold on those assignments';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.save_walls_installation_job(
  p_wall_record_id text,p_readiness jsonb,p_closeout jsonb,p_expected_version bigint default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_row public.walls_installation_jobs%rowtype;
  v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
  v_before jsonb;
begin
  if not public.walls_installation_permission('manage') then raise exception 'Superior Walls Installation management access required'; end if;
  if jsonb_typeof(coalesce(p_readiness,'{}'::jsonb))<>'object' or jsonb_typeof(coalesce(p_closeout,'{}'::jsonb))<>'object' then
    raise exception 'Readiness and closeout must be objects';
  end if;
  if not exists(select 1 from public.schedule_records where collection='walls' and record_id=p_wall_record_id) then raise exception 'Linked Superior Walls job not found'; end if;
  if coalesce((p_closeout->>'field_complete')::boolean,false) and (
    not exists(select 1 from public.walls_production_assignments a where a.wall_record_id=p_wall_record_id and a.stage<>'cancelled')
    or exists(select 1 from public.walls_production_assignments a where a.wall_record_id=p_wall_record_id and a.stage<>'cancelled'
      and not exists(select 1 from public.walls_installation_activity_assignments m
        join public.walls_installation_activities x on x.activity_id=m.activity_id
        where m.assignment_id=a.assignment_id and x.wall_record_id=p_wall_record_id
          and x.activity_type='wall_installation' and x.status='completed'))
    or exists(select 1 from unnest(array['bolting','foaming','caulking','corrections','other']) k
      where coalesce(p_closeout->>k,'not_required') not in ('complete','not_required'))
    or exists(select 1 from public.walls_installation_activities where wall_record_id=p_wall_record_id
      and activity_type='field_closeout' and status not in ('completed','cancelled'))
    or exists(select 1 from public.walls_installation_issues where wall_record_id=p_wall_record_id and status='open' and severity='hold')
  ) then raise exception 'Field completion requires every active production assignment installed, every applicable closeout item complete, no active closeout activity, and no open installation hold'; end if;
  insert into public.walls_installation_jobs(wall_record_id,created_by,updated_by)
    values(p_wall_record_id,v_actor,v_actor) on conflict(wall_record_id) do nothing;
  select * into v_row from public.walls_installation_jobs where wall_record_id=p_wall_record_id for update;
  if p_expected_version is not null and v_row.version<>p_expected_version then raise exception 'Installation job changed; refresh before saving'; end if;
  v_before:=jsonb_build_object('readiness',v_row.readiness,'closeout',v_row.closeout);
  update public.walls_installation_jobs set readiness=coalesce(p_readiness,'{}'),closeout=coalesce(p_closeout,'{}'),
    version=version+1,updated_at=now(),updated_by=v_actor where wall_record_id=p_wall_record_id returning * into v_row;
  insert into public.walls_installation_events(wall_record_id,event_type,detail,actor_user_id,actor_email)
    values(p_wall_record_id,'job_readiness_closeout_updated',jsonb_build_object('before',v_before,
      'after',jsonb_build_object('readiness',v_row.readiness,'closeout',v_row.closeout),'version',v_row.version),auth.uid(),v_actor);
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.set_walls_installation_activity_assignments(uuid,bigint,jsonb) from public,anon;
grant execute on function public.set_walls_installation_activity_assignments(uuid,bigint,jsonb) to authenticated;
revoke all on function public.save_walls_installation_activity(uuid,text,text,date,time,time,text,jsonb,text,bigint) from public,anon;
grant execute on function public.save_walls_installation_activity(uuid,text,text,date,time,time,text,jsonb,text,bigint) to authenticated;
revoke all on function public.save_walls_installation_job(text,jsonb,jsonb,bigint) from public,anon;
grant execute on function public.save_walls_installation_job(text,jsonb,jsonb,bigint) to authenticated;
revoke all on function public.enforce_walls_delivery_qc_release() from public,anon,authenticated;
