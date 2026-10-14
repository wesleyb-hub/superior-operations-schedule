-- Superior Walls shop-floor production execution linked to authoritative wall jobs.
-- Additive only: no schedule, inventory, QC, delivery, billing, or employee record is rewritten.
-- Prepared by Scout for Wes Borgen

create extension if not exists btree_gist with schema extensions;

create table if not exists public.walls_production_tables (
  table_id text primary key,
  label text not null,
  capacity_lf numeric check (capacity_lf is null or capacity_lf > 0),
  sort_order integer not null default 0,
  enabled boolean not null default true,
  notes text not null default '',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

create table if not exists public.walls_production_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  can_view boolean not null default true,
  can_update_setup boolean not null default false,
  can_record_pour boolean not null default false,
  can_record_strip boolean not null default false,
  can_report_issue boolean not null default false,
  can_manage_assignments boolean not null default false,
  can_manage_plan boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

create table if not exists public.walls_production_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  schedule_collection text not null default 'walls' check (schedule_collection='walls'),
  wall_record_id text not null,
  table_id text not null references public.walls_production_tables(table_id),
  wall_height numeric not null check (wall_height in (4,5,8,9,10,12)),
  planned_lf numeric not null check (planned_lf > 0),
  setup_start_at timestamp not null,
  pour_at timestamp not null,
  strip_at timestamp not null,
  stage text not null default 'planned' check (stage in ('planned','setup_in_progress','setup_complete','ready_for_pour','poured','curing','stripped','cancelled')),
  setup_progress integer not null default 0 check (setup_progress between 0 and 100),
  pre_pour_ready boolean not null default false,
  actual_poured_lf numeric check (actual_poured_lf is null or actual_poured_lf >= 0),
  schedule_production_date date,
  schedule_total_lf numeric not null default 0,
  needs_review boolean not null default false,
  review_reason text not null default '',
  notes text not null default '',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null,
  foreign key (schedule_collection,wall_record_id) references public.schedule_records(collection,record_id) on update cascade on delete restrict,
  check (setup_start_at <= pour_at and pour_at <= strip_at),
  check (actual_poured_lf is null or actual_poured_lf <= planned_lf)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='walls_production_no_table_overlap') then
    alter table public.walls_production_assignments
      add constraint walls_production_no_table_overlap
      exclude using gist (table_id with =, tsrange(setup_start_at,strip_at,'[)') with &&)
      where (stage <> 'cancelled');
  end if;
end $$;

create index if not exists walls_production_assignments_job_idx on public.walls_production_assignments(wall_record_id);
create index if not exists walls_production_assignments_dates_idx on public.walls_production_assignments(setup_start_at,pour_at,strip_at);
create index if not exists walls_production_assignments_table_idx on public.walls_production_assignments(table_id,setup_start_at);

create table if not exists public.walls_production_events (
  event_id bigint generated always as identity primary key,
  assignment_id uuid not null references public.walls_production_assignments(assignment_id) on delete restrict,
  event_type text not null,
  previous_stage text,
  new_stage text,
  actual_lf numeric,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid default auth.uid(),
  actor_email text not null default lower(coalesce(auth.jwt()->>'email',''))
);

create index if not exists walls_production_events_assignment_idx on public.walls_production_events(assignment_id,occurred_at desc);

create table if not exists public.walls_production_issues (
  issue_id bigint generated always as identity primary key,
  assignment_id uuid references public.walls_production_assignments(assignment_id) on delete restrict,
  schedule_collection text not null default 'walls' check (schedule_collection='walls'),
  wall_record_id text not null,
  table_id text references public.walls_production_tables(table_id),
  category text not null check (category in ('Missing materials','Equipment problems','Drawing questions','Production delays','Other production restrictions')),
  description text not null check (length(trim(description)) between 3 and 2000),
  status text not null default 'open' check (status in ('open','resolved')),
  reported_at timestamptz not null default now(),
  reported_by_user_id uuid default auth.uid(),
  reported_by_email text not null default lower(coalesce(auth.jwt()->>'email','')),
  resolved_at timestamptz,
  resolved_by_user_id uuid,
  resolved_by_email text,
  resolution_note text not null default '',
  foreign key (schedule_collection,wall_record_id) references public.schedule_records(collection,record_id) on update cascade on delete restrict
);

create index if not exists walls_production_issues_open_idx on public.walls_production_issues(status,reported_at desc);

create or replace function public.walls_production_permission(p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_operations_admin() or exists (
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
    select 1 from public.app_employee_access a where a.user_id=auth.uid() and a.enabled and a.division_key='walls'
  ));
$$;

create or replace function public.walls_job_total_lf(p_wall_record_id text)
returns numeric language sql stable security definer set search_path=public,pg_temp as $$
  select greatest(0,
    coalesce(nullif(data->>'lf','')::numeric,0),
    coalesce(nullif(data#>>'{lfByHeight,h4}','')::numeric,0)+coalesce(nullif(data#>>'{lfByHeight,h5}','')::numeric,0)+
    coalesce(nullif(data#>>'{lfByHeight,h8}','')::numeric,0)+coalesce(nullif(data#>>'{lfByHeight,h9}','')::numeric,0)+
    coalesce(nullif(data#>>'{lfByHeight,h10}','')::numeric,0)+coalesce(nullif(data#>>'{lfByHeight,h12}','')::numeric,0)+
    coalesce(nullif(data->>'lfUnassigned','')::numeric,0)
  ) from public.schedule_records where collection='walls' and record_id=p_wall_record_id;
$$;

create or replace function public.validate_walls_production_assignment()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_total numeric;v_height_total numeric;v_assigned numeric;v_height_assigned numeric;v_capacity numeric;v_job jsonb;
begin
  select data into v_job from public.schedule_records where collection='walls' and record_id=new.wall_record_id;
  if v_job is null then raise exception 'Authoritative Superior Walls job not found'; end if;
  if tg_op='UPDATE' and new.wall_record_id=old.wall_record_id and new.table_id=old.table_id and new.wall_height=old.wall_height and new.planned_lf=old.planned_lf and new.setup_start_at=old.setup_start_at and new.pour_at=old.pour_at and new.strip_at=old.strip_at then
    new.updated_at:=now();new.updated_by:=lower(coalesce(auth.jwt()->>'email','migration'));new.version:=old.version+1;return new;
  end if;
  v_total:=public.walls_job_total_lf(new.wall_record_id);
  if v_total<=0 then raise exception 'Enter the job linear footage before assigning production tables'; end if;
  select capacity_lf into v_capacity from public.walls_production_tables where table_id=new.table_id and enabled;
  if not found then raise exception 'Production table is not active'; end if;
  if v_capacity is not null and new.planned_lf>v_capacity then raise exception 'Assignment exceeds the configured table capacity'; end if;
  select coalesce(sum(planned_lf),0) into v_assigned from public.walls_production_assignments
    where wall_record_id=new.wall_record_id and stage<>'cancelled' and assignment_id<>coalesce(new.assignment_id,'00000000-0000-0000-0000-000000000000'::uuid);
  if v_assigned+new.planned_lf>v_total then raise exception 'Assignment would exceed the authoritative job linear footage'; end if;
  v_height_total:=coalesce(nullif(v_job#>>array['lfByHeight','h'||trim(to_char(new.wall_height,'FM99'))],'')::numeric,0);
  if v_height_total>0 then
    select coalesce(sum(planned_lf),0) into v_height_assigned from public.walls_production_assignments
      where wall_record_id=new.wall_record_id and wall_height=new.wall_height and stage<>'cancelled' and assignment_id<>coalesce(new.assignment_id,'00000000-0000-0000-0000-000000000000'::uuid);
    if v_height_assigned+new.planned_lf>v_height_total then raise exception 'Assignment would exceed the job footage for this wall height'; end if;
  end if;
  new.schedule_production_date:=case when coalesce(v_job->>'productionDate','')~'^\d{4}-\d{2}-\d{2}$' then (v_job->>'productionDate')::date else null end;
  new.schedule_total_lf:=v_total;
  new.updated_at:=now();new.updated_by:=lower(coalesce(auth.jwt()->>'email','migration'));
  if tg_op='UPDATE' then new.version:=old.version+1; end if;
  return new;
end;
$$;

drop trigger if exists walls_production_assignment_validate on public.walls_production_assignments;
create trigger walls_production_assignment_validate before insert or update on public.walls_production_assignments
for each row execute function public.validate_walls_production_assignment();

create or replace function public.flag_walls_production_schedule_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old_total numeric;v_new_total numeric;v_reason text;
begin
  if new.collection<>'walls' then return new; end if;
  v_old_total:=greatest(coalesce(nullif(old.data->>'lf','')::numeric,0),coalesce(nullif(old.data#>>'{lfByHeight,h4}','')::numeric,0)+coalesce(nullif(old.data#>>'{lfByHeight,h5}','')::numeric,0)+coalesce(nullif(old.data#>>'{lfByHeight,h8}','')::numeric,0)+coalesce(nullif(old.data#>>'{lfByHeight,h9}','')::numeric,0)+coalesce(nullif(old.data#>>'{lfByHeight,h10}','')::numeric,0)+coalesce(nullif(old.data#>>'{lfByHeight,h12}','')::numeric,0)+coalesce(nullif(old.data->>'lfUnassigned','')::numeric,0));
  v_new_total:=greatest(coalesce(nullif(new.data->>'lf','')::numeric,0),coalesce(nullif(new.data#>>'{lfByHeight,h4}','')::numeric,0)+coalesce(nullif(new.data#>>'{lfByHeight,h5}','')::numeric,0)+coalesce(nullif(new.data#>>'{lfByHeight,h8}','')::numeric,0)+coalesce(nullif(new.data#>>'{lfByHeight,h9}','')::numeric,0)+coalesce(nullif(new.data#>>'{lfByHeight,h10}','')::numeric,0)+coalesce(nullif(new.data#>>'{lfByHeight,h12}','')::numeric,0)+coalesce(nullif(new.data->>'lfUnassigned','')::numeric,0));
  if coalesce(old.data->>'productionDate','')<>coalesce(new.data->>'productionDate','') or v_old_total<>v_new_total then
    v_reason:=concat_ws('; ',case when coalesce(old.data->>'productionDate','')<>coalesce(new.data->>'productionDate','') then 'Management production date changed' end,case when v_old_total<>v_new_total then 'Management LF changed' end);
    update public.walls_production_assignments set needs_review=true,review_reason=v_reason,updated_at=now(),updated_by=new.updated_by where wall_record_id=new.record_id and stage<>'cancelled';
  end if;
  return new;
end;
$$;

drop trigger if exists walls_production_schedule_change on public.schedule_records;
create trigger walls_production_schedule_change after update of data on public.schedule_records
for each row when (new.collection='walls') execute function public.flag_walls_production_schedule_change();

alter table public.walls_production_tables enable row level security;
alter table public.walls_production_access enable row level security;
alter table public.walls_production_assignments enable row level security;
alter table public.walls_production_events enable row level security;
alter table public.walls_production_issues enable row level security;

drop policy if exists "Authorized users view production tables" on public.walls_production_tables;
drop policy if exists "Administrators view production access" on public.walls_production_access;
drop policy if exists "Authorized users view production assignments" on public.walls_production_assignments;
drop policy if exists "Authorized users view production events" on public.walls_production_events;
drop policy if exists "Authorized users view production issues" on public.walls_production_issues;
create policy "Authorized users view production tables" on public.walls_production_tables for select to authenticated using (public.walls_production_permission('view'));
create policy "Administrators view production access" on public.walls_production_access for select to authenticated using (public.is_operations_admin() or user_id=auth.uid());
create policy "Authorized users view production assignments" on public.walls_production_assignments for select to authenticated using (public.walls_production_permission('view'));
create policy "Authorized users view production events" on public.walls_production_events for select to authenticated using (public.walls_production_permission('view'));
create policy "Authorized users view production issues" on public.walls_production_issues for select to authenticated using (public.walls_production_permission('view'));

revoke all on public.walls_production_tables,public.walls_production_access,public.walls_production_assignments,public.walls_production_events,public.walls_production_issues from anon;
revoke insert,update,delete on public.walls_production_tables,public.walls_production_access,public.walls_production_assignments,public.walls_production_events,public.walls_production_issues from authenticated;
grant select on public.walls_production_tables,public.walls_production_assignments,public.walls_production_events,public.walls_production_issues to authenticated;
grant select on public.walls_production_access to authenticated;

create or replace function public.get_walls_production_snapshot(p_from date default current_date-7,p_to date default current_date+45)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.walls_production_permission('view') then raise exception 'Superior Walls production access required'; end if;
  return jsonb_build_object(
    'permissions',jsonb_build_object(
      'view',true,'setup',public.walls_production_permission('setup'),'pour',public.walls_production_permission('pour'),
      'strip',public.walls_production_permission('strip'),'issue',public.walls_production_permission('issue'),
      'assign',public.walls_production_permission('assign'),'plan',public.walls_production_permission('plan')
    ),
    'tables',coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order,t.label) from public.walls_production_tables t where t.enabled),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.record_id,'job',r.data->>'job','model',r.data->>'type','project',r.data->>'project','development',r.data->>'development',
      'customer',r.data->>'customer','address',r.data->>'address','productionDate',r.data->>'productionDate',
      'totalLf',public.walls_job_total_lf(r.record_id),'lfByHeight',coalesce(r.data->'lfByHeight','{}'::jsonb),
      'releaseStatus',case when r.data#>>'{planReview,stages,approvedProduction,status}'='Complete' then 'Released for Production' else 'Not Released for Production' end,
      'documentLinks',case when r.data#>>'{planReview,stages,approvedProduction,status}'='Complete' then coalesce(r.data->'links','[]'::jsonb) else '[]'::jsonb end,
      'assignedLf',coalesce((select sum(a.planned_lf) from public.walls_production_assignments a where a.wall_record_id=r.record_id and a.stage<>'cancelled'),0),
      'actualPouredLf',coalesce((select sum(a.actual_poured_lf) from public.walls_production_assignments a where a.wall_record_id=r.record_id and a.stage not in ('cancelled','planned','setup_in_progress','setup_complete','ready_for_pour')),0)
    ) order by nullif(r.data->>'productionDate','') nulls last,r.ordinal) from public.schedule_records r where r.collection='walls' and coalesce(r.data->>'completedDate','')='' and coalesce(r.data->>'completedMonth','')=''),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.setup_start_at,a.table_id) from public.walls_production_assignments a where a.stage<>'cancelled' and a.setup_start_at::date<=p_to+45 and a.strip_at::date>=p_from-7),'[]'::jsonb),
    'issues',coalesce((select jsonb_agg(to_jsonb(i) order by (i.status='open') desc,i.reported_at desc) from public.walls_production_issues i where i.status='open' or i.reported_at::date>=p_from-30),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(x.data order by x.occurred_at desc) from (select to_jsonb(e) data,e.occurred_at from public.walls_production_events e order by e.occurred_at desc limit 200) x),'[]'::jsonb),
    'generatedAt',now()
  );
end;
$$;

create or replace function public.upsert_walls_production_assignment(
  p_assignment_id uuid,p_wall_record_id text,p_table_id text,p_wall_height numeric,p_planned_lf numeric,
  p_setup_start_at timestamp,p_pour_at timestamp,p_strip_at timestamp,p_notes text default '',p_expected_version bigint default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_production_assignments%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.walls_production_permission('assign') then raise exception 'Table-assignment permission required'; end if;
  if p_assignment_id is null then
    insert into public.walls_production_assignments(wall_record_id,table_id,wall_height,planned_lf,setup_start_at,pour_at,strip_at,notes,created_by,updated_by)
    values(p_wall_record_id,p_table_id,p_wall_height,p_planned_lf,p_setup_start_at,p_pour_at,p_strip_at,coalesce(p_notes,''),v_actor,v_actor) returning * into v_row;
    insert into public.walls_production_events(assignment_id,event_type,new_stage,detail,actor_email) values(v_row.assignment_id,'assignment_created','planned',jsonb_build_object('planned_lf',p_planned_lf,'table_id',p_table_id),v_actor);
  else
    select * into v_row from public.walls_production_assignments where assignment_id=p_assignment_id for update;
    if not found then raise exception 'Production assignment not found'; end if;
    if v_row.version<>p_expected_version then raise exception 'Production assignment version conflict'; end if;
    if v_row.stage<>'planned' then raise exception 'Started production must be preserved; only planned assignments can be rescheduled'; end if;
    update public.walls_production_assignments set wall_record_id=p_wall_record_id,table_id=p_table_id,wall_height=p_wall_height,planned_lf=p_planned_lf,
      setup_start_at=p_setup_start_at,pour_at=p_pour_at,strip_at=p_strip_at,notes=coalesce(p_notes,''),needs_review=false,review_reason=''
      where assignment_id=p_assignment_id returning * into v_row;
    insert into public.walls_production_events(assignment_id,event_type,previous_stage,new_stage,detail,actor_email) values(v_row.assignment_id,'assignment_updated','planned','planned',jsonb_build_object('planned_lf',p_planned_lf,'table_id',p_table_id),v_actor);
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.advance_walls_production_stage(p_assignment_id uuid,p_new_stage text,p_setup_progress integer default null,p_actual_lf numeric default null,p_pre_pour_ready boolean default null,p_note text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.walls_production_assignments%rowtype;v_row public.walls_production_assignments%rowtype;v_release text;v_required text;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  select * into v_old from public.walls_production_assignments where assignment_id=p_assignment_id for update;
  if not found then raise exception 'Production assignment not found'; end if;
  v_required:=case when p_new_stage in ('setup_in_progress','setup_complete','ready_for_pour') then 'setup' when p_new_stage in ('poured','curing') then 'pour' when p_new_stage='stripped' then 'strip' else 'plan' end;
  if not public.walls_production_permission(v_required) then raise exception 'Production stage permission required'; end if;
  if not ((v_old.stage='planned' and p_new_stage='setup_in_progress') or (v_old.stage='setup_in_progress' and p_new_stage='setup_complete') or (v_old.stage='setup_complete' and p_new_stage='ready_for_pour') or (v_old.stage='ready_for_pour' and p_new_stage='poured') or (v_old.stage='poured' and p_new_stage='curing') or (v_old.stage='curing' and p_new_stage='stripped')) then raise exception 'Production stages must advance in order'; end if;
  if exists (select 1 from public.walls_production_issues where assignment_id=p_assignment_id and status='open') then raise exception 'Resolve the production hold before advancing this assignment'; end if;
  select data#>>'{planReview,stages,approvedProduction,status}' into v_release from public.schedule_records where collection='walls' and record_id=v_old.wall_record_id;
  if p_new_stage in ('setup_in_progress','setup_complete','ready_for_pour','poured','curing','stripped') and v_release<>'Complete' then raise exception 'Job is not released for production'; end if;
  if p_new_stage='ready_for_pour' and coalesce(p_pre_pour_ready,false) is not true then raise exception 'Required pre-pour readiness must be recorded'; end if;
  if p_new_stage='poured' and (p_actual_lf is null or p_actual_lf<=0 or p_actual_lf>v_old.planned_lf) then raise exception 'Actual poured LF must be positive and cannot exceed planned LF'; end if;
  update public.walls_production_assignments set stage=p_new_stage,
    setup_progress=case when p_new_stage='setup_in_progress' then greatest(setup_progress,coalesce(p_setup_progress,1)) when p_new_stage in ('setup_complete','ready_for_pour','poured','curing','stripped') then 100 else setup_progress end,
    pre_pour_ready=case when p_new_stage in ('ready_for_pour','poured','curing','stripped') then true else coalesce(p_pre_pour_ready,pre_pour_ready) end,
    actual_poured_lf=case when p_new_stage='poured' then p_actual_lf else actual_poured_lf end,
    notes=case when trim(coalesce(p_note,''))<>'' then concat_ws(E'\n',nullif(notes,''),trim(p_note)) else notes end
    where assignment_id=p_assignment_id returning * into v_row;
  insert into public.walls_production_events(assignment_id,event_type,previous_stage,new_stage,actual_lf,detail,actor_email)
    values(p_assignment_id,'stage_changed',v_old.stage,p_new_stage,v_row.actual_poured_lf,jsonb_build_object('note',coalesce(p_note,''),'setup_progress',v_row.setup_progress,'pre_pour_ready',v_row.pre_pour_ready),v_actor);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.update_walls_production_setup_progress(p_assignment_id uuid,p_setup_progress integer,p_note text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_production_assignments%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.walls_production_permission('setup') then raise exception 'Setup permission required'; end if;
  if p_setup_progress is null or p_setup_progress<1 or p_setup_progress>99 then raise exception 'Setup progress must be between 1 and 99 percent'; end if;
  update public.walls_production_assignments set setup_progress=p_setup_progress,
    notes=case when trim(coalesce(p_note,''))<>'' then concat_ws(E'\n',nullif(notes,''),trim(p_note)) else notes end
    where assignment_id=p_assignment_id and stage='setup_in_progress' returning * into v_row;
  if not found then raise exception 'Only setup in progress can receive a progress update'; end if;
  insert into public.walls_production_events(assignment_id,event_type,previous_stage,new_stage,detail,actor_email)
    values(p_assignment_id,'setup_progress','setup_in_progress','setup_in_progress',jsonb_build_object('setup_progress',p_setup_progress,'note',coalesce(p_note,'')),v_actor);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.report_walls_production_issue(p_assignment_id uuid,p_category text,p_description text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_assignment public.walls_production_assignments%rowtype;v_issue public.walls_production_issues%rowtype;
begin
  if not public.walls_production_permission('issue') then raise exception 'Issue-reporting permission required'; end if;
  select * into v_assignment from public.walls_production_assignments where assignment_id=p_assignment_id;
  if not found then raise exception 'Production assignment not found'; end if;
  insert into public.walls_production_issues(assignment_id,wall_record_id,table_id,category,description)
    values(p_assignment_id,v_assignment.wall_record_id,v_assignment.table_id,p_category,trim(p_description)) returning * into v_issue;
  insert into public.walls_production_events(assignment_id,event_type,previous_stage,new_stage,detail)
    values(p_assignment_id,'issue_reported',v_assignment.stage,v_assignment.stage,jsonb_build_object('issue_id',v_issue.issue_id,'category',p_category));
  return to_jsonb(v_issue);
end;
$$;

create or replace function public.resolve_walls_production_issue(p_issue_id bigint,p_resolution_note text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_issue public.walls_production_issues%rowtype;
begin
  if not public.walls_production_permission('plan') then raise exception 'Production-plan permission required'; end if;
  update public.walls_production_issues set status='resolved',resolved_at=now(),resolved_by_user_id=auth.uid(),resolved_by_email=lower(coalesce(auth.jwt()->>'email','')),resolution_note=coalesce(p_resolution_note,'') where issue_id=p_issue_id and status='open' returning * into v_issue;
  if not found then raise exception 'Open production issue not found'; end if;
  return to_jsonb(v_issue);
end;
$$;

create or replace function public.upsert_walls_production_table(p_table_id text,p_label text,p_capacity_lf numeric,p_enabled boolean,p_notes text default '',p_expected_version bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_production_tables%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.walls_production_permission('plan') then raise exception 'Production-plan permission required'; end if;
  insert into public.walls_production_tables(table_id,label,capacity_lf,sort_order,enabled,notes,updated_by)
  values(trim(p_table_id),trim(p_label),p_capacity_lf,coalesce((select max(sort_order)+1 from public.walls_production_tables),1),coalesce(p_enabled,true),coalesce(p_notes,''),v_actor)
  on conflict(table_id) do update set label=excluded.label,capacity_lf=excluded.capacity_lf,enabled=excluded.enabled,notes=excluded.notes,updated_at=now(),updated_by=v_actor,version=public.walls_production_tables.version+1
    where p_expected_version is null or public.walls_production_tables.version=p_expected_version
  returning * into v_row;
  if not found then raise exception 'Production table version conflict'; end if;
  return to_jsonb(v_row);
end;
$$;

insert into public.walls_production_tables(table_id,label,capacity_lf,sort_order,enabled,notes,updated_by)
select n::text,'Table '||n,null,n,true,'Capacity not yet configured','2026-10-14 production migration' from generate_series(1,6) n
on conflict(table_id) do nothing;

-- Today's Production is visible first for every authorized Walls user; editing rights remain separate.
create or replace function public.get_app_access()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_role public.app_user_roles%rowtype;v_employee public.app_employee_access%rowtype;
begin
  select * into v_role from public.app_user_roles where user_id=auth.uid();
  if found then return jsonb_build_object('authorized',true,'profile_key',coalesce(v_role.role,'viewer'),'can_write',v_role.can_write,'is_admin',v_role.can_write,
    'allowed_views',to_jsonb(array['overview','walls','boxes','manholes','fence','block','qc','delivery','inventory','billing','exceptions','import','audit','history']::text[]),
    'allowed_wall_subviews',to_jsonb(array['production','current','overall','active','plans','monthly','year']::text[])); end if;
  select * into v_employee from public.app_employee_access where user_id=auth.uid() and enabled;
  if found then return jsonb_build_object('authorized',true,'profile_key',v_employee.profile_key,'can_write',false,'is_admin',false,
    'allowed_views',to_jsonb(v_employee.allowed_views),
    'allowed_wall_subviews',to_jsonb(array_prepend('production'::text,array_remove(v_employee.allowed_wall_subviews,'production'::text))),
    'division_key',v_employee.division_key,'inventory_area',v_employee.inventory_area); end if;
  return jsonb_build_object('authorized',false,'profile_key','none','can_write',false,'is_admin',false,'allowed_views','[]'::jsonb,'allowed_wall_subviews','[]'::jsonb);
end;
$$;

do $$ begin
  alter publication supabase_realtime add table public.walls_production_tables;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.walls_production_assignments;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.walls_production_events;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.walls_production_issues;
exception when duplicate_object then null; end $$;

revoke all on function public.walls_production_permission(text),public.walls_job_total_lf(text),public.get_walls_production_snapshot(date,date),public.upsert_walls_production_assignment(uuid,text,text,numeric,numeric,timestamp,timestamp,timestamp,text,bigint),public.advance_walls_production_stage(uuid,text,integer,numeric,boolean,text),public.update_walls_production_setup_progress(uuid,integer,text),public.report_walls_production_issue(uuid,text,text),public.resolve_walls_production_issue(bigint,text),public.upsert_walls_production_table(text,text,numeric,boolean,text,bigint) from public,anon;
grant execute on function public.walls_production_permission(text),public.get_walls_production_snapshot(date,date),public.upsert_walls_production_assignment(uuid,text,text,numeric,numeric,timestamp,timestamp,timestamp,text,bigint),public.advance_walls_production_stage(uuid,text,integer,numeric,boolean,text),public.update_walls_production_setup_progress(uuid,integer,text),public.report_walls_production_issue(uuid,text,text),public.resolve_walls_production_issue(bigint,text),public.upsert_walls_production_table(text,text,numeric,boolean,text,bigint) to authenticated;
