-- Superior Walls field installation execution, linked to the authoritative walls schedule.
-- This migration is additive. It does not update, backfill, or delete existing operational rows.
-- Prepared by Scout for Wes Borgen

begin;

create table if not exists public.walls_installation_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  can_view boolean not null default true,
  can_manage boolean not null default false,
  can_assign_resources boolean not null default false,
  can_qc boolean not null default false,
  can_record_field_progress boolean not null default false,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);
create or replace function public.walls_installation_permission(p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_operations_admin() or exists(select 1 from public.walls_installation_access a where a.user_id=auth.uid() and a.enabled and case p_permission when 'manage' then a.can_manage when 'resources' then a.can_assign_resources when 'qc' then a.can_qc when 'field_progress' then a.can_record_field_progress else a.can_view end)
$$;

create table if not exists public.walls_installation_jobs (
  wall_record_id text primary key,
  schedule_collection text not null default 'walls' check (schedule_collection='walls'),
  status text not null default 'planned' check (status in ('planned','ready','in_progress','on_hold','completed','cancelled')),
  readiness jsonb not null default '{}'::jsonb check (jsonb_typeof(readiness)='object'),
  closeout jsonb not null default '{}'::jsonb check (jsonb_typeof(closeout)='object'),
  needs_review boolean not null default false,
  review_reason text not null default '',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  foreign key(schedule_collection,wall_record_id) references public.schedule_records(collection,record_id) on delete restrict
);

create table if not exists public.walls_installation_activities (
  activity_id uuid primary key default gen_random_uuid(),
  wall_record_id text not null references public.walls_installation_jobs(wall_record_id) on delete restrict,
  activity_type text not null check (activity_type in ('site_preparation','stone_footing','panel_readiness','loading_hauling','wall_installation','field_closeout','other')),
  activity_date date not null,
  start_time time,
  end_time time,
  status text not null default 'planned' check (status in ('planned','in_progress','completed','on_hold','cancelled')),
  notes text not null default '',
  needs_review boolean not null default false,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  check (end_time is null or start_time is null or end_time>start_time)
);

create table if not exists public.walls_installation_resources (
  resource_assignment_id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.walls_installation_activities(activity_id) on delete cascade,
  resource_type text not null check(resource_type in ('crew','employee','equipment','truck','trailer','crane','stone_slinger','other')),
  resource_name text not null check(length(btrim(resource_name)) between 1 and 160),
  role_name text not null default '',
  availability_status text not null default 'unconfirmed' check(availability_status in ('unconfirmed','confirmed','unavailable')),
  readiness_status text not null default 'unconfirmed' check(readiness_status in ('unconfirmed','ready','needs_service','hold','not_applicable')),
  problem_notes text not null default '',
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  unique(activity_id,resource_type,resource_name)
);

create table if not exists public.walls_installation_issues (
  issue_id bigint generated always as identity primary key,
  wall_record_id text not null references public.walls_installation_jobs(wall_record_id) on delete restrict,
  activity_id uuid references public.walls_installation_activities(activity_id) on delete restrict,
  category text not null check(category in ('site','stone','production','qc','delivery','equipment','crew','weather','schedule','other')),
  severity text not null default 'warning' check(severity in ('warning','hold')),
  description text not null check(length(btrim(description)) between 1 and 2000),
  status text not null default 'open' check(status in ('open','resolved')),
  reported_at timestamptz not null default now(),
  reported_by_user_id uuid references auth.users(id) on delete restrict,
  reported_by_email text not null default '',
  resolved_at timestamptz,
  resolved_by_user_id uuid references auth.users(id) on delete restrict,
  resolved_by_email text,
  resolution_note text not null default ''
);

create table if not exists public.walls_installation_events (
  event_id bigint generated always as identity primary key,
  wall_record_id text not null references public.walls_installation_jobs(wall_record_id) on delete restrict,
  activity_id uuid references public.walls_installation_activities(activity_id) on delete restrict,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_email text not null default '',
  occurred_at timestamptz not null default now()
);

-- A distinct post-production Walls final-QC release. Approved for Production is not final QC.
create table if not exists public.walls_installation_qc_releases (
  assignment_id uuid primary key references public.walls_production_assignments(assignment_id) on delete restrict,
  wall_record_id text not null references public.walls_installation_jobs(wall_record_id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','released','hold')),
  inspection_note text not null default '',
  released_at timestamptz,
  released_by_user_id uuid references auth.users(id) on delete restrict,
  released_by_email text,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

create table if not exists public.walls_installation_load_assignments (
  load_collection text not null default 'loads' check(load_collection='loads'),
  load_record_id text not null,
  assignment_id uuid not null references public.walls_production_assignments(assignment_id) on delete restrict,
  linked_at timestamptz not null default now(),
  linked_by_user_id uuid references auth.users(id) on delete restrict,
  linked_by_email text not null default '',
  primary key(load_record_id,assignment_id),
  foreign key(load_collection,load_record_id) references public.schedule_records(collection,record_id) on delete restrict
);

create index if not exists walls_installation_activities_date_idx on public.walls_installation_activities(activity_date,status);
create index if not exists walls_installation_activities_job_idx on public.walls_installation_activities(wall_record_id,activity_date);
create index if not exists walls_installation_resources_activity_idx on public.walls_installation_resources(activity_id,resource_type);
create index if not exists walls_installation_issues_job_idx on public.walls_installation_issues(wall_record_id,status,reported_at desc);
create index if not exists walls_installation_qc_job_idx on public.walls_installation_qc_releases(wall_record_id,status);

alter table public.walls_installation_jobs enable row level security;
alter table public.walls_installation_access enable row level security;
alter table public.walls_installation_activities enable row level security;
alter table public.walls_installation_resources enable row level security;
alter table public.walls_installation_issues enable row level security;
alter table public.walls_installation_events enable row level security;
alter table public.walls_installation_qc_releases enable row level security;
alter table public.walls_installation_load_assignments enable row level security;

revoke all on public.walls_installation_access,public.walls_installation_jobs,public.walls_installation_activities,public.walls_installation_resources,public.walls_installation_issues,public.walls_installation_events,public.walls_installation_qc_releases,public.walls_installation_load_assignments from anon,authenticated;
grant select on public.walls_installation_access,public.walls_installation_jobs,public.walls_installation_activities,public.walls_installation_resources,public.walls_installation_issues,public.walls_installation_events,public.walls_installation_qc_releases,public.walls_installation_load_assignments to authenticated;
create policy "Walls installation access self or admin read" on public.walls_installation_access for select to authenticated using (public.is_operations_admin() or user_id=auth.uid());
create policy "Walls installation authorized read" on public.walls_installation_jobs for select to authenticated using (public.walls_installation_permission('view'));
create policy "Walls installation activities authorized read" on public.walls_installation_activities for select to authenticated using (public.walls_installation_permission('view'));
create policy "Walls installation resources authorized read" on public.walls_installation_resources for select to authenticated using (public.walls_installation_permission('view'));
create policy "Walls installation issues authorized read" on public.walls_installation_issues for select to authenticated using (public.walls_installation_permission('view'));
create policy "Walls installation events authorized read" on public.walls_installation_events for select to authenticated using (public.walls_installation_permission('view'));
create policy "Walls installation QC authorized read" on public.walls_installation_qc_releases for select to authenticated using (public.walls_installation_permission('view'));
create policy "Walls installation load links authorized read" on public.walls_installation_load_assignments for select to authenticated using (public.walls_installation_permission('view'));

create or replace function public.get_walls_installation_snapshot(p_from date default current_date-7,p_to date default current_date+45)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.walls_installation_permission('view') then raise exception 'Superior Walls Installation access required'; end if;
  return jsonb_build_object(
    'permissions',jsonb_build_object('view',true,'manage',public.walls_installation_permission('manage'),'resources',public.walls_installation_permission('resources'),'qc',public.walls_installation_permission('qc'),'field_progress',public.walls_installation_permission('field_progress')),
    'jobs',coalesce((select jsonb_agg(jsonb_build_object(
      'job',r.data,'record_id',r.record_id,'installation',to_jsonb(j),
      'activities',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('resources',coalesce((select jsonb_agg(to_jsonb(x) order by x.resource_type,x.resource_name) from public.walls_installation_resources x where x.activity_id=a.activity_id),'[]'::jsonb)) order by a.activity_date,a.start_time,a.activity_id) from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.status<>'cancelled' and a.activity_date between p_from and p_to),'[]'::jsonb),
      'production',coalesce((select jsonb_agg(to_jsonb(a) order by a.strip_at,a.table_id) from public.walls_production_assignments a where a.wall_record_id=r.record_id and a.stage<>'cancelled'),'[]'::jsonb),
      'qc',coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at) from public.walls_installation_qc_releases q where q.wall_record_id=r.record_id),'[]'::jsonb),
      'issues',coalesce((select jsonb_agg(to_jsonb(i) order by i.reported_at desc) from public.walls_installation_issues i where i.wall_record_id=r.record_id),'[]'::jsonb),
      'open_production_issues',(select count(*) from public.walls_production_issues i where i.wall_record_id=r.record_id and i.status='open'),
      'delivery',coalesce((select jsonb_agg(jsonb_build_object('record_id',l.record_id,'assignment_ids',coalesce((select jsonb_agg(m.assignment_id) from public.walls_installation_load_assignments m where m.load_record_id=l.record_id),'[]'::jsonb))||l.data order by l.ordinal) from public.schedule_records l where l.collection='loads' and l.division='walls' and l.data->>'linkId'=r.record_id),'[]'::jsonb),
      'overall_status',case when coalesce(j.status,'planned')='on_hold' or exists(select 1 from public.walls_installation_issues i where i.wall_record_id=r.record_id and i.status='open' and i.severity='hold') then 'On Hold'
        when coalesce(j.closeout->>'field_complete','false')='true' then 'Field Complete'
        when exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_type='field_closeout' and a.status not in ('completed','cancelled')) then 'Closeout Pending'
        when exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_type='wall_installation' and a.status='completed') then 'Installation Complete'
        when exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_type='wall_installation' and a.status='in_progress') then 'Installation In Progress'
        when exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_type='stone_footing' and a.status in ('planned','in_progress')) then 'Site Preparation'
        when exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_type in ('loading_hauling','wall_installation') and a.status='planned') then 'Ready for Installation'
        when nullif(r.data->>'installDate','') is not null then 'Scheduled' else 'Not Scheduled' end
    ) order by nullif(r.data->>'installDate','') nulls last,r.ordinal) from public.schedule_records r left join public.walls_installation_jobs j on j.wall_record_id=r.record_id
      where r.collection='walls' and (
        (coalesce(r.data->>'completedDate','')='' and coalesce(r.data->>'completedMonth','')=''
          and (coalesce(r.data->>'installDate','')='' or (r.data->>'installDate') between p_from::text and p_to::text or exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_date between p_from and p_to)))
        or exists(select 1 from public.walls_production_assignments p left join public.walls_installation_qc_releases q on q.assignment_id=p.assignment_id where p.wall_record_id=r.record_id and p.stage='stripped' and q.status is distinct from 'released')
        or exists(select 1 from public.schedule_records l where l.collection='loads' and l.division='walls' and l.data->>'linkType'='wall' and l.data->>'linkId'=r.record_id and coalesce(l.data->>'status','') not in ('Delivered','Cancelled'))
      )
    ),'[]'::jsonb),
    'resource_conflicts',coalesce((select jsonb_agg(jsonb_build_object('resource',resource_name,'resource_type',resource_type,'date',activity_date,'activities',activity_ids) order by activity_date,resource_type,resource_name) from (
      select resource_name,resource_type,activity_date,array_agg(activity_id::text) activity_ids from (
        select a.activity_id,a.activity_date,x.resource_type,lower(trim(x.resource_name)) resource_name from public.walls_installation_activities a join public.walls_installation_resources x on x.activity_id=a.activity_id
        where a.status in ('planned','in_progress','on_hold') and x.availability_status<>'unavailable' and a.activity_date between p_from and p_to and nullif(trim(x.resource_name),'') is not null
      ) u group by resource_name,resource_type,activity_date having count(distinct activity_id)>1
    ) c),'[]'::jsonb),
    'generated_at',now()
  );
end;
$$;

create or replace function public.save_walls_installation_activity(
  p_activity_id uuid,p_wall_record_id text,p_activity_type text,p_activity_date date,p_start_time time,p_end_time time,
  p_status text,p_resources jsonb default null,p_notes text default '',p_expected_version bigint default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_installation_activities%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_old_status text;v_before jsonb;v_item jsonb;v_assignment_count integer;v_old_resources jsonb;v_new_resources jsonb;
begin
  if not public.walls_installation_permission('manage') then raise exception 'Superior Walls Installation management access required'; end if;
  if not exists(select 1 from public.schedule_records where collection='walls' and record_id=p_wall_record_id) then raise exception 'Linked Superior Walls job not found'; end if;
  if p_resources is not null and jsonb_typeof(p_resources)<>'array' then raise exception 'Resources must be an array'; end if;
  if coalesce(p_status,'planned') in ('in_progress','completed') and p_activity_type in ('loading_hauling','wall_installation','field_closeout') then
    select count(*) into v_assignment_count from public.walls_production_assignments where wall_record_id=p_wall_record_id and stage<>'cancelled';
    if v_assignment_count=0 then raise exception 'Create and complete the required Superior Walls production assignments before field loading or installation';end if;
    if exists(select 1 from public.walls_production_assignments a left join public.walls_installation_qc_releases q on q.assignment_id=a.assignment_id where a.wall_record_id=p_wall_record_id and a.stage<>'cancelled' and (a.stage<>'stripped' or q.status is distinct from 'released')) then raise exception 'All production assignments must be stripped and pass final Walls QC before field execution'; end if;
    if exists(select 1 from public.walls_production_issues i where i.wall_record_id=p_wall_record_id and i.status='open') then raise exception 'Resolve open production holds before field execution'; end if;
    if exists(select 1 from public.walls_installation_issues i where i.wall_record_id=p_wall_record_id and i.status='open' and i.severity='hold') then raise exception 'Resolve the open installation hold before field execution';end if;
  end if;
  insert into public.walls_installation_jobs(wall_record_id,created_by,updated_by)
    values(p_wall_record_id,v_actor,v_actor) on conflict(wall_record_id) do nothing;
  if p_activity_id is null then
    insert into public.walls_installation_activities(wall_record_id,activity_type,activity_date,start_time,end_time,status,notes,created_by,updated_by)
    values(p_wall_record_id,p_activity_type,p_activity_date,p_start_time,p_end_time,coalesce(p_status,'planned'),coalesce(p_notes,''),v_actor,v_actor) returning * into v_row;
    insert into public.walls_installation_events(wall_record_id,activity_id,event_type,detail,actor_user_id,actor_email)
      values(p_wall_record_id,v_row.activity_id,'activity_created',to_jsonb(v_row),auth.uid(),v_actor);
  else
    select * into v_row from public.walls_installation_activities where activity_id=p_activity_id for update;
    if not found then raise exception 'Installation activity not found'; end if;
    if v_row.wall_record_id<>p_wall_record_id then raise exception 'Activity must remain attached to its original master job'; end if;
    if v_row.version<>p_expected_version then raise exception 'Installation activity changed; refresh and retry'; end if;
    v_old_status:=v_row.status;
    v_before:=to_jsonb(v_row);
    if v_old_status='completed' and p_status<>'completed' then raise exception 'Completed field activity is preserved; record follow-up work as a new activity'; end if;
    update public.walls_installation_activities set activity_type=p_activity_type,activity_date=p_activity_date,start_time=p_start_time,end_time=p_end_time,status=p_status,
      notes=coalesce(p_notes,''),version=version+1,updated_at=now(),updated_by=v_actor
      where activity_id=p_activity_id returning * into v_row;
    insert into public.walls_installation_events(wall_record_id,activity_id,event_type,detail,actor_user_id,actor_email)
      values(p_wall_record_id,p_activity_id,'activity_updated',jsonb_build_object('before',v_before,'after',to_jsonb(v_row),'from',v_old_status,'to',p_status),auth.uid(),v_actor);
  end if;
  if p_resources is not null then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.resource_type,x.resource_name),'[]'::jsonb) into v_old_resources from public.walls_installation_resources x where x.activity_id=v_row.activity_id;
    delete from public.walls_installation_resources where activity_id=v_row.activity_id;
    for v_item in select value from jsonb_array_elements(p_resources) loop
      if coalesce(v_item->>'resource_type','') not in ('crew','employee','equipment','truck','trailer','crane','stone_slinger','other') or length(btrim(coalesce(v_item->>'resource_name','')))=0 then raise exception 'Each resource requires a supported type and a name'; end if;
      insert into public.walls_installation_resources(activity_id,resource_type,resource_name,role_name,availability_status,readiness_status,problem_notes,updated_by)
      values(v_row.activity_id,v_item->>'resource_type',btrim(v_item->>'resource_name'),coalesce(v_item->>'role_name',''),coalesce(v_item->>'availability_status','unconfirmed'),coalesce(v_item->>'readiness_status','unconfirmed'),coalesce(v_item->>'problem_notes',''),v_actor);
    end loop;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.resource_type,x.resource_name),'[]'::jsonb) into v_new_resources from public.walls_installation_resources x where x.activity_id=v_row.activity_id;
    insert into public.walls_installation_events(wall_record_id,activity_id,event_type,detail,actor_user_id,actor_email)
      values(p_wall_record_id,v_row.activity_id,'resource_assignments_changed',jsonb_build_object('before',v_old_resources,'after',v_new_resources),auth.uid(),v_actor);
  end if;
  update public.walls_installation_jobs set status=case when p_status='on_hold' then 'on_hold' when p_status='in_progress' then 'in_progress' when p_status='completed' then 'completed' else status end,version=version+1,updated_at=now(),updated_by=v_actor where wall_record_id=p_wall_record_id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.save_walls_installation_job(p_wall_record_id text,p_readiness jsonb,p_closeout jsonb,p_expected_version bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_installation_jobs%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_before jsonb;
begin
  if not public.walls_installation_permission('manage') then raise exception 'Superior Walls Installation management access required';end if;
  if jsonb_typeof(coalesce(p_readiness,'{}'::jsonb))<>'object' or jsonb_typeof(coalesce(p_closeout,'{}'::jsonb))<>'object' then raise exception 'Readiness and closeout must be objects';end if;
  if not exists(select 1 from public.schedule_records where collection='walls' and record_id=p_wall_record_id) then raise exception 'Linked Superior Walls job not found';end if;
  if coalesce((p_closeout->>'field_complete')::boolean,false) and (
    not exists(select 1 from public.walls_installation_activities where wall_record_id=p_wall_record_id and activity_type='wall_installation' and status='completed')
    or exists(select 1 from unnest(array['bolting','foaming','caulking','corrections','other']) k where coalesce(p_closeout->>k,'not_required') not in ('complete','not_required'))
    or exists(select 1 from public.walls_installation_activities where wall_record_id=p_wall_record_id and activity_type='field_closeout' and status not in ('completed','cancelled'))
    or exists(select 1 from public.walls_installation_issues where wall_record_id=p_wall_record_id and status='open' and severity='hold')
  ) then raise exception 'Field completion requires completed wall installation, every applicable closeout item complete, and no open installation hold';end if;
  insert into public.walls_installation_jobs(wall_record_id,created_by,updated_by) values(p_wall_record_id,v_actor,v_actor) on conflict(wall_record_id) do nothing;
  select * into v_row from public.walls_installation_jobs where wall_record_id=p_wall_record_id for update;
  if p_expected_version is not null and v_row.version<>p_expected_version then raise exception 'Installation job changed; refresh before saving';end if;
  v_before:=jsonb_build_object('readiness',v_row.readiness,'closeout',v_row.closeout);
  update public.walls_installation_jobs set readiness=coalesce(p_readiness,'{}'),closeout=coalesce(p_closeout,'{}'),version=version+1,updated_at=now(),updated_by=v_actor where wall_record_id=p_wall_record_id returning * into v_row;
  insert into public.walls_installation_events(wall_record_id,event_type,detail,actor_user_id,actor_email) values(p_wall_record_id,'job_readiness_closeout_updated',jsonb_build_object('before',v_before,'after',jsonb_build_object('readiness',v_row.readiness,'closeout',v_row.closeout),'version',v_row.version),auth.uid(),v_actor);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.update_walls_installation_resource(p_resource_assignment_id uuid,p_expected_version bigint,p_availability_status text,p_readiness_status text,p_role_name text,p_problem_notes text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_installation_resources%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_before jsonb;
begin
  if not public.walls_installation_permission('resources') then raise exception 'Superior Walls Installation resource-management access required';end if;
  select * into v_row from public.walls_installation_resources where resource_assignment_id=p_resource_assignment_id for update;
  if not found then raise exception 'Installation resource assignment not found';end if;
  if v_row.version<>p_expected_version then raise exception 'Resource assignment changed; refresh before saving';end if;
  if p_readiness_status in ('hold','needs_service') and length(btrim(coalesce(p_problem_notes,'')))<3 then raise exception 'Describe the equipment/resource issue before placing it on hold';end if;
  v_before:=to_jsonb(v_row);
  update public.walls_installation_resources set availability_status=p_availability_status,readiness_status=p_readiness_status,role_name=coalesce(p_role_name,''),problem_notes=coalesce(p_problem_notes,''),version=version+1,updated_at=now(),updated_by=v_actor where resource_assignment_id=p_resource_assignment_id returning * into v_row;
  insert into public.walls_installation_events(wall_record_id,activity_id,event_type,detail,actor_user_id,actor_email) select a.wall_record_id,a.activity_id,'resource_readiness_updated',jsonb_build_object('before',v_before,'after',to_jsonb(v_row)),auth.uid(),v_actor from public.walls_installation_activities a where a.activity_id=v_row.activity_id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.report_walls_installation_issue(p_wall_record_id text,p_activity_id uuid,p_category text,p_severity text,p_description text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_installation_issues%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not (public.walls_installation_permission('manage') or public.walls_installation_permission('field_progress')) then raise exception 'Superior Walls Installation issue-reporting access required';end if;
  if not exists(select 1 from public.schedule_records where collection='walls' and record_id=p_wall_record_id) then raise exception 'Linked Superior Walls job not found';end if;
  insert into public.walls_installation_jobs(wall_record_id,created_by,updated_by) values(p_wall_record_id,v_actor,v_actor) on conflict(wall_record_id) do nothing;
  if p_activity_id is not null and not exists(select 1 from public.walls_installation_activities where activity_id=p_activity_id and wall_record_id=p_wall_record_id) then raise exception 'Installation activity does not belong to this master job';end if;
  insert into public.walls_installation_issues(wall_record_id,activity_id,category,severity,description,reported_by_user_id,reported_by_email) values(p_wall_record_id,p_activity_id,p_category,p_severity,btrim(p_description),auth.uid(),v_actor) returning * into v_row;
  if p_severity='hold' then update public.walls_installation_jobs set status='on_hold',version=version+1,updated_at=now(),updated_by=v_actor where wall_record_id=p_wall_record_id;end if;
  insert into public.walls_installation_events(wall_record_id,activity_id,event_type,detail,actor_user_id,actor_email) values(p_wall_record_id,p_activity_id,'issue_reported',to_jsonb(v_row),auth.uid(),v_actor);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.link_walls_installation_load_assignments(p_load_record_id text,p_assignment_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_wall_id text;v_count integer;v_load_status text;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_old_assignments jsonb;
begin
  if not public.walls_installation_permission('manage') then raise exception 'Superior Walls Installation management access required';end if;
  select l.data->>'linkId',coalesce(l.data->>'status','') into v_wall_id,v_load_status from public.schedule_records l where l.collection='loads' and l.record_id=p_load_record_id and l.division='walls' and l.data->>'linkType'='wall';
  if v_wall_id is null then raise exception 'Select an existing Delivery load linked to a Superior Walls job';end if;
  if v_load_status in ('Loaded','Delivered') then raise exception 'Production-batch mapping cannot be changed after a delivery load has shipped';end if;
  p_assignment_ids:=coalesce(p_assignment_ids,'{}'::uuid[]);
  select count(distinct a.assignment_id) into v_count from public.walls_production_assignments a where a.assignment_id=any(p_assignment_ids) and a.wall_record_id=v_wall_id and a.stage<>'cancelled';
  if v_count<>cardinality(p_assignment_ids) then raise exception 'Every selected production assignment must belong to the linked master job';end if;
  insert into public.walls_installation_jobs(wall_record_id,created_by,updated_by) values(v_wall_id,v_actor,v_actor) on conflict(wall_record_id) do nothing;
  select coalesce(jsonb_agg(assignment_id order by assignment_id),'[]'::jsonb) into v_old_assignments from public.walls_installation_load_assignments where load_record_id=p_load_record_id;
  delete from public.walls_installation_load_assignments where load_record_id=p_load_record_id;
  insert into public.walls_installation_load_assignments(load_record_id,assignment_id,linked_by_user_id,linked_by_email)
    select p_load_record_id,x,auth.uid(),v_actor from unnest(p_assignment_ids) x;
  insert into public.walls_installation_events(wall_record_id,event_type,detail,actor_user_id,actor_email)
    values(v_wall_id,'delivery_load_assignments_linked',jsonb_build_object('load_record_id',p_load_record_id,'before',v_old_assignments,'after',to_jsonb(p_assignment_ids)),auth.uid(),v_actor);
  return jsonb_build_object('ok',true,'load_record_id',p_load_record_id,'assignment_ids',to_jsonb(p_assignment_ids));
end;
$$;

create or replace function public.resolve_walls_installation_issue(p_issue_id bigint,p_resolution_note text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_installation_issues%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.walls_installation_permission('manage') then raise exception 'Superior Walls Installation management access required';end if;
  update public.walls_installation_issues set status='resolved',resolved_at=now(),resolved_by_user_id=auth.uid(),resolved_by_email=v_actor,resolution_note=btrim(coalesce(p_resolution_note,'')) where issue_id=p_issue_id and status='open' returning * into v_row;
  if not found then raise exception 'Open installation issue not found';end if;
  insert into public.walls_installation_events(wall_record_id,activity_id,event_type,detail,actor_user_id,actor_email) values(v_row.wall_record_id,v_row.activity_id,'issue_resolved',to_jsonb(v_row),auth.uid(),v_actor);
  update public.walls_installation_jobs j set status=case when exists(select 1 from public.walls_installation_issues i where i.wall_record_id=j.wall_record_id and i.status='open' and i.severity='hold') then 'on_hold' when exists(select 1 from public.walls_installation_activities a where a.wall_record_id=j.wall_record_id and a.status='in_progress') then 'in_progress' when exists(select 1 from public.walls_installation_activities a where a.wall_record_id=j.wall_record_id and a.activity_type='wall_installation' and a.status='completed') then 'completed' else 'planned' end,version=version+1,updated_at=now(),updated_by=v_actor where j.wall_record_id=v_row.wall_record_id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.set_walls_installation_qc(p_assignment_id uuid,p_status text,p_note text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_assignment public.walls_production_assignments%rowtype;v_row public.walls_installation_qc_releases%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_previous text;
begin
  if not public.walls_installation_permission('qc') then raise exception 'Superior Walls QC release access required'; end if;
  if p_status not in ('released','hold','pending') then raise exception 'Unsupported Walls QC status'; end if;
  if p_status='hold' and length(btrim(coalesce(p_note,'')))<3 then raise exception 'Describe the final-QC issue before placing an assignment on hold';end if;
  select * into v_assignment from public.walls_production_assignments where assignment_id=p_assignment_id;
  if not found then raise exception 'Production assignment not found'; end if;
  select status into v_previous from public.walls_installation_qc_releases where assignment_id=p_assignment_id;
  if p_status='released' and (v_assignment.stage<>'stripped' or exists(select 1 from public.walls_production_issues i where i.assignment_id=p_assignment_id and i.status='open')) then raise exception 'Assignment must be stripped with no open production holds before final QC release'; end if;
  insert into public.walls_installation_jobs(wall_record_id,created_by,updated_by) values(v_assignment.wall_record_id,v_actor,v_actor) on conflict(wall_record_id) do nothing;
  insert into public.walls_installation_qc_releases(assignment_id,wall_record_id,status,inspection_note,released_at,released_by_user_id,released_by_email,updated_by)
  values(p_assignment_id,v_assignment.wall_record_id,p_status,coalesce(p_note,''),case when p_status='released' then now() end,case when p_status='released' then auth.uid() end,case when p_status='released' then v_actor end,v_actor)
  on conflict(assignment_id) do update set status=excluded.status,inspection_note=excluded.inspection_note,released_at=excluded.released_at,released_by_user_id=excluded.released_by_user_id,released_by_email=excluded.released_by_email,updated_at=now(),updated_by=v_actor
  returning * into v_row;
  insert into public.walls_installation_events(wall_record_id,event_type,detail,actor_user_id,actor_email)
    values(v_assignment.wall_record_id,'final_qc_'||p_status,jsonb_build_object('assignment_id',p_assignment_id,'from',v_previous,'to',p_status,'note',p_note),auth.uid(),v_actor);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.flag_walls_installation_schedule_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old_date date;v_new_date date;v_shift integer;v_underway boolean;v_confirmed boolean;v_changed boolean;v_nondate_changed boolean;
begin
  v_old_date:=case when coalesce(old.data->>'installDate','') ~ '^\d{4}-\d{2}-\d{2}$' then (old.data->>'installDate')::date end;
  v_new_date:=case when coalesce(new.data->>'installDate','') ~ '^\d{4}-\d{2}-\d{2}$' then (new.data->>'installDate')::date end;
  v_changed:=coalesce(old.data->>'installDate','')<>coalesce(new.data->>'installDate','') or coalesce(old.data->>'address','')<>coalesce(new.data->>'address','') or coalesce(old.data->>'job','')<>coalesce(new.data->>'job','') or coalesce(old.data->>'project','')<>coalesce(new.data->>'project','') or coalesce(old.data->>'development','')<>coalesce(new.data->>'development','') or coalesce(old.data->>'type','')<>coalesce(new.data->>'type','') or old.data->'lfByHeight' is distinct from new.data->'lfByHeight' or coalesce(old.data->>'lf','')<>coalesce(new.data->>'lf','');
  v_nondate_changed:=coalesce(old.data->>'address','')<>coalesce(new.data->>'address','') or coalesce(old.data->>'job','')<>coalesce(new.data->>'job','') or coalesce(old.data->>'project','')<>coalesce(new.data->>'project','') or coalesce(old.data->>'development','')<>coalesce(new.data->>'development','') or coalesce(old.data->>'type','')<>coalesce(new.data->>'type','') or old.data->'lfByHeight' is distinct from new.data->'lfByHeight' or coalesce(old.data->>'lf','')<>coalesce(new.data->>'lf','');
  if v_changed and exists(select 1 from public.walls_installation_jobs where wall_record_id=new.record_id) then
    select exists(select 1 from public.walls_installation_activities where wall_record_id=new.record_id and status not in ('planned','cancelled')) into v_underway;
    select exists(select 1 from public.walls_installation_activities a join public.walls_installation_resources x on x.activity_id=a.activity_id where a.wall_record_id=new.record_id and a.status in ('planned','on_hold') and x.availability_status='confirmed') into v_confirmed;
    if v_old_date is distinct from v_new_date and v_old_date is not null and v_new_date is not null and not v_underway and not v_confirmed and not v_nondate_changed then
      v_shift:=v_new_date-v_old_date;
      update public.walls_installation_activities set activity_date=activity_date+v_shift,needs_review=false,version=version+1,updated_at=now(),updated_by=new.updated_by where wall_record_id=new.record_id and status='planned';
      update public.walls_installation_jobs set needs_review=false,review_reason='',version=version+1,updated_at=now(),updated_by=new.updated_by where wall_record_id=new.record_id;
    else
      update public.walls_installation_jobs set needs_review=true,review_reason=case when v_underway then 'Management Schedule Changed — Field Plan Needs Review; started/completed work was preserved' when v_confirmed and not v_nondate_changed then 'Management Schedule Changed — confirmed crew/equipment assignments need reconciliation' else 'Master job details changed; review field plan' end,version=version+1,updated_at=now(),updated_by=new.updated_by where wall_record_id=new.record_id;
      update public.walls_installation_activities set needs_review=true,version=version+1,updated_at=now(),updated_by=new.updated_by where wall_record_id=new.record_id and status in ('planned','on_hold');
    end if;
    insert into public.walls_installation_events(wall_record_id,event_type,detail,actor_user_id,actor_email)
      values(new.record_id,'master_schedule_changed',jsonb_build_object(
        'install_date_before',old.data->>'installDate','install_date_after',new.data->>'installDate',
        'job_before',old.data->>'job','job_after',new.data->>'job',
        'project_before',old.data->>'project','project_after',new.data->>'project',
        'address_before',old.data->>'address','address_after',new.data->>'address',
        'type_before',old.data->>'type','type_after',new.data->>'type',
        'lf_before',old.data->>'lf','lf_after',new.data->>'lf',
        'lf_by_height_before',old.data->'lfByHeight','lf_by_height_after',new.data->'lfByHeight'),auth.uid(),coalesce(new.updated_by,''));
  end if;
  return new;
end;
$$;
drop trigger if exists walls_installation_schedule_change on public.schedule_records;
create trigger walls_installation_schedule_change after update of data on public.schedule_records for each row when (new.collection='walls') execute function public.flag_walls_installation_schedule_change();

-- Protect linked Walls shipments at the database boundary, including older clients.
create or replace function public.enforce_walls_delivery_qc_release()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old_status text;v_new_status text;v_assignment_count integer;v_released_count integer;v_open_issues integer;v_link_id text;v_has_mapping boolean;v_link_changed boolean:=false;
begin
  if coalesce(new.division,new.data->>'division')<>'walls' or new.data->>'linkType'<>'wall' then return new;end if;
  v_link_id:=new.data->>'linkId';v_new_status:=coalesce(new.data->>'status','');
  if tg_op='UPDATE' then v_old_status:=coalesce(old.data->>'status','');v_link_changed:=old.data->>'linkType' is distinct from new.data->>'linkType' or old.data->>'linkId' is distinct from new.data->>'linkId';end if;
  if v_new_status in ('Loaded','Delivered') and (tg_op='INSERT' or v_old_status is distinct from v_new_status or v_link_changed) then
    select exists(select 1 from public.walls_installation_load_assignments m where m.load_record_id=new.record_id) into v_has_mapping;
    if v_has_mapping then
      select count(*),count(*) filter(where a.stage='stripped' and q.status='released') into v_assignment_count,v_released_count
      from public.walls_installation_load_assignments m join public.walls_production_assignments a on a.assignment_id=m.assignment_id left join public.walls_installation_qc_releases q on q.assignment_id=a.assignment_id where m.load_record_id=new.record_id;
    else
      select count(*),count(*) filter(where a.stage='stripped' and q.status='released') into v_assignment_count,v_released_count
      from public.walls_production_assignments a left join public.walls_installation_qc_releases q on q.assignment_id=a.assignment_id where a.wall_record_id=v_link_id and a.stage<>'cancelled';
    end if;
    select count(*) into v_open_issues from public.walls_production_issues i where i.wall_record_id=v_link_id and i.status='open';
    if v_assignment_count=0 or v_assignment_count<>v_released_count or v_open_issues>0 then raise exception 'Linked Superior Walls delivery requires every production assignment stripped and finally QC released, with no open production hold';end if;
  end if;
  return new;
end;
$$;
revoke all on function public.get_walls_installation_snapshot(date,date),public.save_walls_installation_activity(uuid,text,text,date,time,time,text,jsonb,text,bigint),public.save_walls_installation_job(text,jsonb,jsonb,bigint),public.update_walls_installation_resource(uuid,bigint,text,text,text,text),public.report_walls_installation_issue(text,uuid,text,text,text),public.link_walls_installation_load_assignments(text,uuid[]),public.resolve_walls_installation_issue(bigint,text),public.set_walls_installation_qc(uuid,text,text),public.flag_walls_installation_schedule_change(),public.enforce_walls_delivery_qc_release() from public,anon;
grant execute on function public.get_walls_installation_snapshot(date,date),public.save_walls_installation_activity(uuid,text,text,date,time,time,text,jsonb,text,bigint),public.save_walls_installation_job(text,jsonb,jsonb,bigint),public.update_walls_installation_resource(uuid,bigint,text,text,text,text),public.report_walls_installation_issue(text,uuid,text,text,text),public.link_walls_installation_load_assignments(text,uuid[]),public.resolve_walls_installation_issue(bigint,text),public.set_walls_installation_qc(uuid,text,text) to authenticated;
grant execute on function public.walls_installation_permission(text) to authenticated;

-- Include installation work in Weekly Planner's frozen-source comparison.
create or replace function public.weekly_planner_source_fingerprint(p_week_start date)
returns text language sql stable security definer set search_path=public,pg_temp as $$
  select md5(concat_ws('|',
    coalesce((select revision::text from public.schedule_meta where id=1),'0'),
    coalesce((select string_agg(concat_ws(':',assignment_id::text,version::text,setup_start_at::text,pour_at::text,strip_at::text,stage),',' order by assignment_id)
      from public.walls_production_assignments where stage<>'cancelled' and setup_start_at::date<=p_week_start+4 and strip_at::date>=p_week_start),''),
    coalesce((select string_agg(concat_ws(':',collection,record_id,updated_at::text,md5(data::text)),',' order by collection,record_id)
      from public.schedule_records where
        (collection='walls' and ((data->>'installDate') between p_week_start::text and (p_week_start+4)::text or (data->>'deliveryDate') between p_week_start::text and (p_week_start+4)::text))
        or (collection='loads' and (data->>'date') between p_week_start::text and (p_week_start+4)::text)
        or collection='jobs'),''),
    coalesce((select string_agg(concat_ws(':',a.activity_id::text,a.version::text,a.wall_record_id,a.activity_type,a.activity_date::text,a.start_time::text,a.end_time::text,a.status,a.needs_review::text,coalesce((select string_agg(concat_ws('/',x.resource_type,x.resource_name,x.role_name,x.availability_status,x.readiness_status),'|' order by x.resource_type,x.resource_name) from public.walls_installation_resources x where x.activity_id=a.activity_id),'')),',' order by a.activity_id)
      from public.walls_installation_activities a where a.status<>'cancelled' and a.activity_date between p_week_start and p_week_start+4),''),
    coalesce((select string_agg(concat_ws(':',j.wall_record_id,j.version::text,j.needs_review::text,j.readiness::text,j.closeout::text),',' order by j.wall_record_id)
      from public.walls_installation_jobs j join public.schedule_records r on r.collection='walls' and r.record_id=j.wall_record_id
      where (r.data->>'installDate') between p_week_start::text and (p_week_start+4)::text or exists(select 1 from public.walls_installation_activities a where a.wall_record_id=j.wall_record_id and a.activity_date between p_week_start and p_week_start+4)),''),
    coalesce((select string_agg(concat_ws(':',i.issue_id::text,i.wall_record_id,i.activity_id::text,i.category,i.severity,i.status,i.reported_at::text,i.resolved_at::text),',' order by i.issue_id)
      from public.walls_installation_issues i where exists(select 1 from public.walls_installation_activities a where a.activity_id=i.activity_id and a.activity_date between p_week_start and p_week_start+4)
        or exists(select 1 from public.schedule_records r where r.collection='walls' and r.record_id=i.wall_record_id and (r.data->>'installDate') between p_week_start::text and (p_week_start+4)::text)),''),
    coalesce((select string_agg(concat_ws(':',q.assignment_id::text,q.status,q.updated_at::text),',' order by q.assignment_id)
      from public.walls_installation_qc_releases q join public.walls_production_assignments a on a.assignment_id=q.assignment_id
      where a.strip_at::date between p_week_start and p_week_start+4 or exists(select 1 from public.walls_installation_activities x where x.wall_record_id=a.wall_record_id and x.activity_date between p_week_start and p_week_start+4)),'')))
$$;

create or replace function public.sync_walls_installation_week(p_week_start date)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_section uuid;v_actor text:=lower(coalesce(auth.jwt()->>'email','system'));
begin
  select section_id into v_section from public.weekly_planner_sections where week_start=p_week_start and section_key='installation_stone';
  if v_section is null then return; end if;
  delete from public.weekly_planner_assignments a using public.weekly_planner_sections s where a.section_id=s.section_id and s.week_start=p_week_start and a.source_type in ('walls_installation_activity','walls_installation_qc');
  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select v_section,a.activity_date,coalesce(nullif(r.data->>'address',''),nullif(r.data->>'project',''),nullif(r.data->>'development',''),r.data->>'job'),
    upper(replace(a.activity_type,'_',' '))||' · '||coalesce(r.data->>'job',a.wall_record_id)||coalesce((select ' · '||string_agg(x.resource_type||': '||x.resource_name||' ('||x.availability_status||')','; ' order by x.resource_type,x.resource_name) from public.walls_installation_resources x where x.activity_id=a.activity_id),' · Crew/equipment unconfirmed')||case when nullif(j.readiness->>'restrictions','') is not null then ' · Site restriction: '||(j.readiness->>'restrictions') else '' end,
    coalesce(to_char(a.start_time,'HH24:MI'),''),case when a.needs_review then 'Master schedule changed — review field plan' when a.status='on_hold' then 'Installation activity on hold' when exists(select 1 from public.walls_installation_issues i where i.wall_record_id=a.wall_record_id and i.status='open' and i.severity='hold') then 'Open field issue hold' else '' end,
    concat_ws(' · ',nullif(a.notes,''),nullif(j.readiness->>'restrictions',''),case when exists(select 1 from public.walls_installation_issues i where i.wall_record_id=a.wall_record_id and i.status='open') then 'Open field issue(s) require review' end,'Confirm site readiness, final QC, crew, equipment, trucking, and access.'),'linked','walls_installation_activity',a.activity_id::text,
    case when a.needs_review or a.status='on_hold' or exists(select 1 from public.walls_installation_issues i where i.wall_record_id=a.wall_record_id and i.status='open' and i.severity='hold') then 'hold' when not exists(select 1 from public.walls_installation_resources x where x.activity_id=a.activity_id and x.availability_status='confirmed') then 'unconfirmed' else 'confirmed' end,
    10000+row_number() over(order by a.start_time,a.activity_id)::integer,v_actor
  from public.walls_installation_activities a join public.schedule_records r on r.collection='walls' and r.record_id=a.wall_record_id left join public.walls_installation_jobs j on j.wall_record_id=a.wall_record_id
  where a.status<>'cancelled' and a.activity_date between p_week_start and p_week_start+4;
  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,a.activity_date,coalesce(nullif(r.data->>'address',''),nullif(r.data->>'project',''),nullif(r.data->>'development',''),r.data->>'job'),
    upper(replace(a.activity_type,'_',' '))||' · '||coalesce(r.data->>'job',a.wall_record_id)||coalesce((select ' · '||string_agg(x.resource_type||': '||x.resource_name||coalesce(' / '||nullif(x.role_name,''),''),' · ' order by x.resource_type,x.resource_name) from public.walls_installation_resources x where x.activity_id=a.activity_id and x.resource_type in ('crane','truck','trailer','stone_slinger','equipment')),' · Truck/crane/equipment unconfirmed'),
    coalesce(to_char(a.start_time,'HH24:MI'),''),case when a.needs_review or a.status='on_hold' then 'Field plan needs review / hold' when exists(select 1 from public.walls_installation_issues i where i.wall_record_id=a.wall_record_id and i.status='open' and i.severity='hold') then 'Open field issue hold' else '' end,
    concat_ws(' · ',nullif(a.notes,''),nullif(j.readiness->>'restrictions',''),case when exists(select 1 from public.walls_installation_issues i where i.wall_record_id=a.wall_record_id and i.status='open') then 'Review open field issue(s)' end,'Coordinate existing Delivery loads; confirm driver, operator, crane, route, and site access.'),'linked','walls_installation_activity',a.activity_id::text,
    case when a.needs_review or a.status='on_hold' then 'hold' when not exists(select 1 from public.walls_installation_resources x where x.activity_id=a.activity_id and x.resource_type in ('crane','truck','trailer','stone_slinger','equipment') and x.availability_status='confirmed' and x.readiness_status in ('ready','not_applicable')) then 'unconfirmed' else 'confirmed' end,
    20000+row_number() over(order by a.start_time,a.activity_id)::integer,v_actor
  from public.walls_installation_activities a join public.schedule_records r on r.collection='walls' and r.record_id=a.wall_record_id left join public.walls_installation_jobs j on j.wall_record_id=a.wall_record_id
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='logistics_cranes'
  where a.status<>'cancelled' and a.activity_type in ('loading_hauling','wall_installation') and a.activity_date between p_week_start and p_week_start+4;
  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,a.strip_at::date,coalesce(nullif(r.data->>'address',''),nullif(r.data->>'project',''),r.data->>'job'),
    'Final Superior Walls QC release · '||coalesce(r.data->>'job',a.wall_record_id)||' · Table '||a.table_id||' · '||a.planned_lf||' LF',
    '',case when a.stage<>'stripped' or q.status is distinct from 'released' then 'Final Walls QC release required' else '' end,
    'Final QC is separate from Approved for Production; do not dispatch unreleased wall panels.','linked','walls_installation_qc',a.assignment_id::text,
    case when a.stage='stripped' and q.status='released' then 'confirmed' else 'hold' end,30000+row_number() over(order by a.strip_at,a.assignment_id)::integer,v_actor
  from public.walls_production_assignments a join public.schedule_records r on r.collection='walls' and r.record_id=a.wall_record_id
  left join public.walls_installation_qc_releases q on q.assignment_id=a.assignment_id
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='quality_control'
  where a.stage<>'cancelled' and (a.strip_at::date between p_week_start and p_week_start+4 or exists(select 1 from public.walls_installation_activities x where x.wall_record_id=a.wall_record_id and x.activity_type in ('loading_hauling','wall_installation') and x.activity_date between p_week_start and p_week_start+4));
  delete from public.weekly_planner_conflicts where week_start=p_week_start and conflict_type='installation_resource_overlap' and status='open';
  insert into public.weekly_planner_conflicts(week_start,conflict_key,severity,conflict_type,message,affected_sections,work_date,source_fingerprint)
  select p_week_start,'install-resource-'||md5(x.resource_type||lower(x.resource_name)||a.activity_date::text),'warning','installation_resource_overlap',x.resource_type||' '||x.resource_name||' has multiple installation assignments on '||a.activity_date||'; verify times and availability.',array['installation_stone','logistics_cranes'],a.activity_date,public.weekly_planner_source_fingerprint(p_week_start)
  from public.walls_installation_activities a join public.walls_installation_resources x on x.activity_id=a.activity_id
  where a.status in ('planned','in_progress','on_hold') and a.activity_date between p_week_start and p_week_start+4 and x.availability_status<>'unavailable'
  group by x.resource_type,x.resource_name,a.activity_date having count(distinct a.activity_id)>1
  on conflict(week_start,conflict_key) do update set severity=excluded.severity,message=excluded.message,affected_sections=excluded.affected_sections,work_date=excluded.work_date,source_fingerprint=excluded.source_fingerprint,status='open',updated_at=now();
  update public.weekly_planner_sections set source_fingerprint=public.weekly_planner_source_fingerprint(p_week_start),schedule_version=schedule_version+1,status=case when status='approved' then 'reapproval_required' else 'needs_review' end,
    approved_source_fingerprint=null,approved_by_user_id=null,approved_by_email=null,approved_at=null,updated_at=now(),updated_by=v_actor
  where week_start=p_week_start and section_key in ('installation_stone','logistics_cranes','quality_control');
end;
$$;

create or replace function public.mark_walls_installation_planner_stale()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_date date;v_week date;v_old_week date;v_fp text;
begin
  if tg_op<>'INSERT' then v_old_week:=date_trunc('week',old.activity_date::timestamp)::date;perform public.sync_walls_installation_week(v_old_week);v_fp:=public.weekly_planner_source_fingerprint(v_old_week);update public.weekly_planner_weeks set source_fingerprint=v_fp,status=case when status='approved' then 'reapproval_required' else 'review' end,updated_at=now(),updated_by=lower(coalesce(auth.jwt()->>'email','system')) where week_start=v_old_week;update public.weekly_planner_packs set is_active=false where week_start=v_old_week and is_active;end if;
  if tg_op<>'DELETE' then v_week:=date_trunc('week',new.activity_date::timestamp)::date;perform public.sync_walls_installation_week(v_week);v_fp:=public.weekly_planner_source_fingerprint(v_week);update public.weekly_planner_weeks set source_fingerprint=v_fp,status=case when status='approved' then 'reapproval_required' else 'review' end,updated_at=now(),updated_by=lower(coalesce(auth.jwt()->>'email','system')) where week_start=v_week;update public.weekly_planner_packs set is_active=false where week_start=v_week and is_active;return new;end if;
  return old;
end;
$$;
drop trigger if exists walls_installation_weekly_planner_change on public.walls_installation_activities;
create trigger walls_installation_weekly_planner_change after insert or update or delete on public.walls_installation_activities for each row execute function public.mark_walls_installation_planner_stale();

create or replace function public.mark_walls_installation_resource_planner_stale()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_activity_id uuid;v_date date;v_week date;v_fp text;
begin
  v_activity_id:=case when tg_op='DELETE' then old.activity_id else new.activity_id end;
  select activity_date into v_date from public.walls_installation_activities where activity_id=v_activity_id;
  if v_date is null then if tg_op='DELETE' then return old;else return new;end if;end if;
  v_week:=date_trunc('week',v_date::timestamp)::date;
  perform public.sync_walls_installation_week(v_week);
  v_fp:=public.weekly_planner_source_fingerprint(v_week);
  update public.weekly_planner_weeks set source_fingerprint=v_fp,status=case when status='approved' then 'reapproval_required' else 'review' end,updated_at=now(),updated_by=lower(coalesce(auth.jwt()->>'email','system')) where week_start=v_week;
  update public.weekly_planner_packs set is_active=false where week_start=v_week and is_active;
  if tg_op='DELETE' then return old;end if;
  return new;
end;
$$;
drop trigger if exists walls_installation_resource_weekly_planner_change on public.walls_installation_resources;
create trigger walls_installation_resource_weekly_planner_change after insert or update or delete on public.walls_installation_resources for each row execute function public.mark_walls_installation_resource_planner_stale();

create or replace function public.mark_walls_installation_related_planner_stale()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_wall_id text;v_week date;v_fp text;v_had_approved boolean;v_actor text:=lower(coalesce(auth.jwt()->>'email','system'));
begin
  if tg_op='DELETE' then v_wall_id:=old.wall_record_id;else v_wall_id:=new.wall_record_id;end if;
  for v_week in
    select distinct date_trunc('week',d.work_date::timestamp)::date from (
      select a.activity_date work_date from public.walls_installation_activities a where a.wall_record_id=v_wall_id and a.status<>'cancelled'
      union all select case when coalesce(r.data->>'installDate','') ~ '^\d{4}-\d{2}-\d{2}$' then (r.data->>'installDate')::date end from public.schedule_records r where r.collection='walls' and r.record_id=v_wall_id
      union all select p.strip_at::date from public.walls_production_assignments p where p.wall_record_id=v_wall_id and p.stage<>'cancelled'
    ) d where d.work_date is not null
  loop
    if exists(select 1 from public.weekly_planner_weeks where week_start=v_week) then
      select exists(select 1 from public.weekly_planner_sections where week_start=v_week and section_key in ('installation_stone','logistics_cranes','quality_control') and status='approved') into v_had_approved;
      perform public.sync_walls_installation_week(v_week);
      v_fp:=public.weekly_planner_source_fingerprint(v_week);
      update public.weekly_planner_weeks set source_fingerprint=v_fp,status=case when v_had_approved or status in ('approved','reapproval_required') then 'reapproval_required' else 'review' end,version=version+1,updated_at=now(),updated_by=v_actor where week_start=v_week;
      update public.weekly_planner_packs set is_active=false where week_start=v_week and is_active;
    end if;
  end loop;
  if tg_op='DELETE' then return old;end if;
  return new;
end;
$$;
drop trigger if exists walls_installation_job_weekly_planner_change on public.walls_installation_jobs;
create trigger walls_installation_job_weekly_planner_change after insert or update on public.walls_installation_jobs for each row execute function public.mark_walls_installation_related_planner_stale();
drop trigger if exists walls_installation_issue_weekly_planner_change on public.walls_installation_issues;
create trigger walls_installation_issue_weekly_planner_change after insert or update or delete on public.walls_installation_issues for each row execute function public.mark_walls_installation_related_planner_stale();
drop trigger if exists walls_installation_qc_weekly_planner_change on public.walls_installation_qc_releases;
create trigger walls_installation_qc_weekly_planner_change after insert or update on public.walls_installation_qc_releases for each row execute function public.mark_walls_installation_related_planner_stale();

create or replace function public.sync_walls_installation_after_planner_generation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.generated_at is distinct from old.generated_at and new.generated_at is not null then perform public.sync_walls_installation_week(new.week_start);end if;
  return new;
end;
$$;
drop trigger if exists weekly_planner_generated_walls_installation_sync on public.weekly_planner_weeks;
create trigger weekly_planner_generated_walls_installation_sync after update of generated_at on public.weekly_planner_weeks for each row execute function public.sync_walls_installation_after_planner_generation();

create or replace function public.sync_walls_installation_after_planner_audit()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.event_type='generated' then perform public.sync_walls_installation_week(new.week_start);end if;
  return new;
end;
$$;
drop trigger if exists weekly_planner_generated_walls_installation_audit_sync on public.weekly_planner_audit;
create trigger weekly_planner_generated_walls_installation_audit_sync after insert on public.weekly_planner_audit for each row execute function public.sync_walls_installation_after_planner_audit();

create or replace function public.get_walls_installation_agent_context()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.walls_installation_permission('view') then return jsonb_build_object('authorized',false,'read_only',true,'jobs','[]'::jsonb);end if;
  return jsonb_build_object('authorized',true,'read_only',true,'jobs',coalesce((select jsonb_agg(jsonb_build_object('job',r.data->>'job','project',coalesce(r.data->>'project',r.data->>'development'),'install_date',r.data->>'installDate','status',j.status,'needs_review',j.needs_review,'activities',(select jsonb_agg(jsonb_build_object('type',a.activity_type,'date',a.activity_date,'status',a.status,'resources',(select jsonb_agg(jsonb_build_object('type',x.resource_type,'name',x.resource_name,'availability',x.availability_status,'readiness',x.readiness_status)) from public.walls_installation_resources x where x.activity_id=a.activity_id)) order by a.activity_date) from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.status<>'cancelled'),'qc_pending',(select count(*) from public.walls_production_assignments p left join public.walls_installation_qc_releases q on q.assignment_id=p.assignment_id where p.wall_record_id=r.record_id and p.stage='stripped' and q.status is distinct from 'released')) order by nullif(r.data->>'installDate','') nulls last) from public.schedule_records r left join public.walls_installation_jobs j on j.wall_record_id=r.record_id where r.collection='walls' and coalesce(r.data->>'completedDate','')='' and coalesce(r.data->>'completedMonth','')=''),'[]'::jsonb),'generated_at',now());
end;
$$;
revoke all on function public.walls_installation_permission(text),public.weekly_planner_source_fingerprint(date),public.sync_walls_installation_week(date),public.mark_walls_installation_planner_stale(),public.mark_walls_installation_resource_planner_stale(),public.sync_walls_installation_after_planner_generation(),public.sync_walls_installation_after_planner_audit(),public.get_walls_installation_agent_context() from public,anon;
grant execute on function public.get_walls_installation_agent_context() to authenticated;

do $$ begin alter publication supabase_realtime add table public.walls_installation_jobs; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.walls_installation_activities; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.walls_installation_resources; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.walls_installation_issues; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.walls_installation_load_assignments; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.walls_installation_qc_releases; exception when duplicate_object then null; end $$;

commit;

