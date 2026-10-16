-- Companywide Weekly Crew Planner.
-- Additive only: source operations remain authoritative and are never rewritten here.
-- Prepared by Scout for Wes Borgen

begin;

create table if not exists public.weekly_planner_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  can_view boolean not null default true,
  can_edit boolean not null default false,
  can_approve boolean not null default false,
  can_publish boolean not null default false,
  allowed_sections text[] not null default '{}'::text[],
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

create table if not exists public.weekly_planner_weeks (
  week_start date primary key check (extract(isodow from week_start)=1),
  week_end date generated always as (week_start+4) stored,
  status text not null default 'draft' check (status in ('draft','review','approved','reapproval_required')),
  source_revision bigint not null default 0,
  source_fingerprint text not null default '',
  generated_at timestamptz,
  generated_by text,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

create table if not exists public.weekly_planner_sections (
  section_id uuid primary key default gen_random_uuid(),
  week_start date not null references public.weekly_planner_weeks(week_start) on delete cascade,
  section_key text not null check (section_key in ('walls_production','table_flow','walls_stripping_loading','box_precast_support','installation_stone','logistics_cranes','quality_control','maintenance_plant')),
  section_name text not null,
  sort_order integer not null,
  status text not null default 'draft' check (status in ('draft','needs_review','approved','reapproval_required')),
  crew_leader text not null default '',
  schedule_version bigint not null default 1,
  source_fingerprint text not null default '',
  approved_source_fingerprint text,
  approved_by_user_id uuid references auth.users(id) on delete restrict,
  approved_by_email text,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration',
  unique (week_start,section_key)
);

create table if not exists public.weekly_planner_section_people (
  person_id bigint generated always as identity primary key,
  section_id uuid not null references public.weekly_planner_sections(section_id) on delete cascade,
  employee_name text not null check (length(btrim(employee_name)) between 1 and 160),
  role_name text not null default '',
  is_leader boolean not null default false,
  unique (section_id,employee_name)
);

create table if not exists public.weekly_planner_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.weekly_planner_sections(section_id) on delete cascade,
  work_date date not null,
  project_location text not null default '',
  assignment_text text not null default '',
  start_time text not null default '',
  status_hold text not null default '',
  backup_instructions text not null default '',
  source_authority text not null default 'manual' check (source_authority in ('linked','manual','manual_required')),
  source_type text not null default '',
  source_id text not null default '',
  readiness_status text not null default 'unconfirmed' check (readiness_status in ('unconfirmed','confirmed','hold','not_applicable')),
  sort_order integer not null default 0,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

create table if not exists public.weekly_planner_availability (
  availability_id bigint generated always as identity primary key,
  week_start date not null references public.weekly_planner_weeks(week_start) on delete cascade,
  employee_name text not null check (length(btrim(employee_name)) between 1 and 160),
  availability jsonb not null default '{}'::jsonb check (jsonb_typeof(availability)='object'),
  notes text not null default '',
  confirmed boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration',
  unique (week_start,employee_name)
);

create table if not exists public.weekly_planner_resources (
  resource_id uuid primary key default gen_random_uuid(),
  week_start date not null references public.weekly_planner_weeks(week_start) on delete cascade,
  resource_type text not null check (resource_type in ('crane','truck','trailer','forklift','equipment','other')),
  resource_name text not null check (length(btrim(resource_name)) between 1 and 160),
  work_date date not null,
  start_time time,
  end_time time,
  section_key text not null default '',
  project_location text not null default '',
  readiness_status text not null default 'unconfirmed' check (readiness_status in ('unconfirmed','ready','unavailable','hold')),
  notes text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

create table if not exists public.weekly_planner_conflicts (
  conflict_id uuid primary key default gen_random_uuid(),
  week_start date not null references public.weekly_planner_weeks(week_start) on delete cascade,
  conflict_key text not null,
  severity text not null check (severity in ('block','warning')),
  conflict_type text not null,
  message text not null,
  affected_sections text[] not null default '{}'::text[],
  work_date date,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  source_fingerprint text not null default '',
  acknowledged_by text,
  acknowledged_at timestamptz,
  resolution_note text not null default '',
  updated_at timestamptz not null default now(),
  unique (week_start,conflict_key)
);

create table if not exists public.weekly_planner_section_revisions (
  revision_id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.weekly_planner_sections(section_id) on delete restrict,
  week_start date not null,
  section_key text not null,
  schedule_version bigint not null,
  source_fingerprint text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  approved_by_user_id uuid not null references auth.users(id) on delete restrict,
  approved_by_email text not null,
  approved_at timestamptz not null default now(),
  unique (section_id,schedule_version)
);

create table if not exists public.weekly_planner_packs (
  pack_id uuid primary key default gen_random_uuid(),
  week_start date not null references public.weekly_planner_weeks(week_start) on delete restrict,
  pack_version bigint not null,
  source_fingerprint text not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  is_active boolean not null default true,
  published_by_user_id uuid not null references auth.users(id) on delete restrict,
  published_by_email text not null,
  published_at timestamptz not null default now(),
  unique (week_start,pack_version)
);

create table if not exists public.weekly_planner_source_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  week_start date not null references public.weekly_planner_weeks(week_start) on delete cascade,
  source_revision bigint not null,
  source_fingerprint text not null,
  source_data jsonb not null check (jsonb_typeof(source_data)='object'),
  created_at timestamptz not null default now(),
  created_by text not null,
  unique (week_start,source_fingerprint)
);

create table if not exists public.weekly_planner_audit (
  audit_id bigint generated always as identity primary key,
  week_start date not null,
  section_key text,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_email text not null,
  occurred_at timestamptz not null default now()
);

create index if not exists weekly_planner_assignments_section_date_idx on public.weekly_planner_assignments(section_id,work_date,sort_order);
create index if not exists weekly_planner_resources_week_date_idx on public.weekly_planner_resources(week_start,work_date,resource_name);
create index if not exists weekly_planner_conflicts_week_status_idx on public.weekly_planner_conflicts(week_start,status,severity);
create index if not exists weekly_planner_packs_week_idx on public.weekly_planner_packs(week_start,published_at desc);
create index if not exists weekly_planner_audit_week_idx on public.weekly_planner_audit(week_start,occurred_at desc);

create or replace function public.weekly_planner_permission(p_permission text default 'view',p_section_key text default null)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_operations_admin() or exists (
    select 1 from public.weekly_planner_access a
    where a.user_id=auth.uid() and a.enabled
      and (cardinality(a.allowed_sections)=0 or p_section_key is null or p_section_key=any(a.allowed_sections))
      and case p_permission when 'publish' then a.can_publish when 'approve' then a.can_approve
        when 'edit' then a.can_edit else a.can_view end
  );
$$;

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
        or collection='jobs'),'')))
$$;

create or replace function public.ensure_weekly_planner_week(p_week_start date)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_revision bigint:=0;v_fingerprint text;
begin
  if not public.weekly_planner_permission('edit') then raise exception 'Weekly Planner management access required'; end if;
  if extract(isodow from p_week_start)<>1 then raise exception 'Planning week must start on Monday'; end if;
  select revision into v_revision from public.schedule_meta where id=1;
  v_fingerprint:=public.weekly_planner_source_fingerprint(p_week_start);
  insert into public.weekly_planner_weeks(week_start,source_revision,source_fingerprint,updated_by)
  values(p_week_start,coalesce(v_revision,0),v_fingerprint,v_actor) on conflict(week_start) do nothing;
  insert into public.weekly_planner_sections(week_start,section_key,section_name,sort_order,source_fingerprint,updated_by)
  values
    (p_week_start,'walls_production','Walls Production',1,v_fingerprint,v_actor),
    (p_week_start,'table_flow','Five-Day Production Table Flow',2,v_fingerprint,v_actor),
    (p_week_start,'walls_stripping_loading','Walls Stripping and Loading',3,v_fingerprint,v_actor),
    (p_week_start,'box_precast_support','Box / Precast Support',4,v_fingerprint,v_actor),
    (p_week_start,'installation_stone','Installation and Stone',5,v_fingerprint,v_actor),
    (p_week_start,'logistics_cranes','Logistics, Trucking, and Cranes',6,v_fingerprint,v_actor),
    (p_week_start,'quality_control','Quality Control',7,v_fingerprint,v_actor),
    (p_week_start,'maintenance_plant','Maintenance and Plant Support',8,v_fingerprint,v_actor)
  on conflict(week_start,section_key) do nothing;
end;
$$;

create or replace function public.rebuild_weekly_planner_conflicts(p_week_start date)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_fingerprint text:=public.weekly_planner_source_fingerprint(p_week_start);v_row record;
begin
  if not public.weekly_planner_permission('view') then raise exception 'Weekly Planner access required'; end if;

  -- Rebuild the active set from current planning inputs. Acknowledged and
  -- resolved rows remain as history, while obsolete open conflicts disappear.
  delete from public.weekly_planner_conflicts
  where week_start=p_week_start and status='open';

  for v_row in select * from (
    select 'missing-leader-'||s.section_key conflict_key,'block' severity,'missing_crew_leader' conflict_type,
      s.section_name||' needs a confirmed crew leader.' message,array[s.section_key] affected_sections,null::date work_date
    from public.weekly_planner_sections s where s.week_start=p_week_start and btrim(s.crew_leader)=''
    union all
    select 'missing-crew-'||s.section_key,'block','missing_crew_assignment',s.section_name||' needs at least one assigned employee.',array[s.section_key],null::date
    from public.weekly_planner_sections s where s.week_start=p_week_start and not exists(select 1 from public.weekly_planner_section_people p where p.section_id=s.section_id)
    union all
    select 'resource-readiness-'||r.resource_id::text,'warning','equipment_readiness',r.resource_name||' readiness is '||replace(r.readiness_status,'_',' ')||'.',array_remove(array[r.section_key],''),r.work_date
    from public.weekly_planner_resources r where r.week_start=p_week_start and r.readiness_status in ('unconfirmed','unavailable','hold')
    union all
    select 'assignment-readiness-'||a.assignment_id::text,'warning','work_readiness',s.section_name||' has unconfirmed or held work on '||a.work_date::text||': '||coalesce(nullif(a.project_location,''),'Unspecified location')||'.',array[s.section_key],a.work_date
    from public.weekly_planner_assignments a join public.weekly_planner_sections s on s.section_id=a.section_id
    where s.week_start=p_week_start and a.readiness_status in ('unconfirmed','hold') and a.source_authority<>'manual_required'
    union all
    select 'resource-overlap-'||md5(lower(r.resource_name)||r.work_date::text),'block','equipment_conflict',r.resource_name||' is assigned more than once on '||r.work_date::text||'.',array_agg(distinct r.section_key),r.work_date
    from public.weekly_planner_resources r where r.week_start=p_week_start group by lower(r.resource_name),r.resource_name,r.work_date having count(*)>1
    union all
    select 'employee-overlap-'||md5(lower(p.employee_name)||a.work_date::text),'block','employee_conflict',p.employee_name||' is assigned to more than one work area on '||a.work_date::text||'.',array_agg(distinct s.section_key),a.work_date
    from public.weekly_planner_section_people p join public.weekly_planner_sections s on s.section_id=p.section_id
    join (select distinct section_id,work_date from public.weekly_planner_assignments) a on a.section_id=s.section_id
    where s.week_start=p_week_start group by lower(p.employee_name),p.employee_name,a.work_date having count(distinct s.section_key)>1
  ) q loop
    insert into public.weekly_planner_conflicts(week_start,conflict_key,severity,conflict_type,message,affected_sections,work_date,source_fingerprint)
    values(p_week_start,v_row.conflict_key,v_row.severity,v_row.conflict_type,v_row.message,v_row.affected_sections,v_row.work_date,v_fingerprint)
    on conflict(week_start,conflict_key) do update set severity=excluded.severity,conflict_type=excluded.conflict_type,message=excluded.message,
      affected_sections=excluded.affected_sections,work_date=excluded.work_date,source_fingerprint=excluded.source_fingerprint,
      status=case when weekly_planner_conflicts.source_fingerprint<>excluded.source_fingerprint then 'open' else weekly_planner_conflicts.status end,updated_at=now();
  end loop;

end;
$$;

create or replace function public.generate_weekly_planner(p_week_start date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_revision bigint:=0;v_fingerprint text;v_source jsonb;
begin
  if not public.weekly_planner_permission('edit') then raise exception 'Weekly Planner edit access required'; end if;
  perform public.ensure_weekly_planner_week(p_week_start);
  select revision into v_revision from public.schedule_meta where id=1;
  v_fingerprint:=public.weekly_planner_source_fingerprint(p_week_start);

  v_source:=jsonb_build_object(
    'schedule_revision',coalesce(v_revision,0),
    'walls_production',coalesce((select jsonb_agg(to_jsonb(a) order by a.setup_start_at,a.table_id) from public.walls_production_assignments a where a.stage<>'cancelled' and a.setup_start_at::date<=p_week_start+4 and a.strip_at::date>=p_week_start),'[]'::jsonb),
    'schedule_records',coalesce((select jsonb_agg(jsonb_build_object('collection',r.collection,'record_id',r.record_id,'division',r.division,'data',r.data,'updated_at',r.updated_at) order by r.collection,r.ordinal)
      from public.schedule_records r where (r.collection='loads' and (r.data->>'date') between p_week_start::text and (p_week_start+4)::text)
        or (r.collection='walls' and ((r.data->>'installDate') between p_week_start::text and (p_week_start+4)::text or (r.data->>'deliveryDate') between p_week_start::text and (p_week_start+4)::text))
        or r.collection='jobs'),'[]'::jsonb)
  );
  insert into public.weekly_planner_source_snapshots(week_start,source_revision,source_fingerprint,source_data,created_by)
  values(p_week_start,coalesce(v_revision,0),v_fingerprint,v_source,v_actor) on conflict(week_start,source_fingerprint) do nothing;

  delete from public.weekly_planner_assignments a using public.weekly_planner_sections s
  where a.section_id=s.section_id and s.week_start=p_week_start and a.source_authority in ('linked','manual_required');

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,d.work_date,coalesce(nullif(r.data->>'project',''),nullif(r.data->>'development',''),r.data->>'job','Superior Walls plant'),
    concat_ws(' · ',case when a.setup_start_at::date=d.work_date then 'Setup' end,case when a.pour_at::date=d.work_date then 'Pour '||a.planned_lf||' LF' end,case when a.strip_at::date=d.work_date then 'Strip / reset' end)||' — Table '||a.table_id,
    case when a.setup_start_at::date=d.work_date then to_char(a.setup_start_at,'HH24:MI') when a.pour_at::date=d.work_date then to_char(a.pour_at,'HH24:MI') else to_char(a.strip_at,'HH24:MI') end,
    case when a.needs_review then coalesce(nullif(a.review_reason,''),'Source change needs review') else '' end,
    'Follow production release, cure, QC, and table-handoff requirements.','linked','walls_production_assignment',a.assignment_id::text,
    case when a.needs_review then 'hold' else 'unconfirmed' end,a.table_id::integer,v_actor
  from public.walls_production_assignments a
  join public.schedule_records r on r.collection=a.schedule_collection and r.record_id=a.wall_record_id
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='walls_production'
  cross join lateral (select g::date work_date from generate_series(p_week_start,p_week_start+4,interval '1 day') g) d
  where a.stage<>'cancelled' and (a.setup_start_at::date=d.work_date or a.pour_at::date=d.work_date);

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,d.work_date,'Table '||a.table_id,
    concat_ws(' + ',case when a.setup_start_at::date=d.work_date then 'Setup' end,case when a.pour_at::date=d.work_date then 'Pour' end,case when a.strip_at::date=d.work_date then 'Strip / reset' end)||' · '||coalesce(r.data->>'job',a.wall_record_id)||' · '||a.planned_lf||' LF',
    '',case when a.needs_review then coalesce(nullif(a.review_reason,''),'Source change needs review') else '' end,'Table flow mirrors the authoritative production assignment.','linked','walls_production_assignment',a.assignment_id::text,
    case when a.needs_review then 'hold' else 'not_applicable' end,a.table_id::integer,v_actor
  from public.walls_production_assignments a
  join public.schedule_records r on r.collection=a.schedule_collection and r.record_id=a.wall_record_id
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='table_flow'
  cross join lateral (select g::date work_date from generate_series(p_week_start,p_week_start+4,interval '1 day') g) d
  where a.stage<>'cancelled' and (a.setup_start_at::date=d.work_date or a.pour_at::date=d.work_date or a.strip_at::date=d.work_date);

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,a.strip_at::date,coalesce(nullif(r.data->>'project',''),r.data->>'job','Superior Walls plant'),
    'Strip / reset Table '||a.table_id||' · '||coalesce(r.data->>'job',a.wall_record_id)||' · '||a.planned_lf||' LF',to_char(a.strip_at,'HH24:MI'),
    case when a.needs_review then coalesce(nullif(a.review_reason,''),'Source change needs review') else '' end,
    'Stage only released panels; coordinate same-day table handoff.','linked','walls_production_assignment',a.assignment_id::text,
    case when a.needs_review then 'hold' else 'unconfirmed' end,a.table_id::integer,v_actor
  from public.walls_production_assignments a join public.schedule_records r on r.collection=a.schedule_collection and r.record_id=a.wall_record_id
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='walls_stripping_loading'
  where a.stage<>'cancelled' and a.strip_at::date between p_week_start and p_week_start+4;

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,(p.value->>'plannedDate')::date,coalesce(nullif(r.data->>'name',''),r.record_id),
    coalesce(nullif(p.value->>'label',''),nullif(p.value->>'pieceType',''),'Precast piece')||' · '||coalesce(nullif(p.value->>'pieceSize',''),'production support'),'',
    case when coalesce(p.value->>'status','')='hold' then 'QC hold' else '' end,'Coordinate forms, steel, concrete, QC, and handling.','linked','schedule_record_product',r.record_id||':'||coalesce(p.value->>'id',''),
    case when coalesce(p.value->>'status','')='hold' then 'hold' else 'unconfirmed' end,coalesce((p.value->>'sortOrder')::integer,0),v_actor
  from public.schedule_records r cross join lateral jsonb_array_elements(coalesce(r.data->'products','[]'::jsonb)) p(value)
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='box_precast_support'
  where r.collection='jobs' and coalesce(r.division,'') in ('boxes','manholes','fence','block')
    and coalesce(p.value->>'plannedDate','') ~ '^\d{4}-\d{2}-\d{2}$' and (p.value->>'plannedDate')::date between p_week_start and p_week_start+4;

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,(r.data->>'installDate')::date,coalesce(nullif(r.data->>'address',''),nullif(r.data->>'project',''),r.data->>'job'),
    'Install '||coalesce(r.data->>'job',r.record_id)||' · '||coalesce(nullif(r.data->>'type',''),'Superior Walls'),'',coalesce(r.data->>'constraint',''),
    'Confirm site readiness, released panels, crew, crane, trucking, and installation plan.','linked','schedule_record',r.record_id,'unconfirmed',r.ordinal,v_actor
  from public.schedule_records r join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='installation_stone'
  where r.collection='walls' and coalesce(r.data->>'installDate','') ~ '^\d{4}-\d{2}-\d{2}$' and (r.data->>'installDate')::date between p_week_start and p_week_start+4;

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,(r.data->>'date')::date,coalesce(nullif(r.data->>'project',''),'Delivery'),
    coalesce(nullif(r.data->>'load',''),'Scheduled load')||case when coalesce(r.data->>'qty','')<>'' then ' · '||(r.data->>'qty') else '' end,'',
    case when coalesce(r.data->>'status','') in ('Hold','At Risk') then r.data->>'status' else '' end,
    'Confirm released product, truck/trailer, driver, crane, route, and site readiness.','linked','schedule_load',r.record_id,
    case when coalesce(r.data->>'status','')='Loaded' then 'confirmed' when coalesce(r.data->>'status','')='Hold' then 'hold' else 'unconfirmed' end,r.ordinal,v_actor
  from public.schedule_records r join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='logistics_cranes'
  where r.collection='loads' and coalesce(r.data->>'date','') ~ '^\d{4}-\d{2}-\d{2}$' and (r.data->>'date')::date between p_week_start and p_week_start+4;

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,a.pour_at::date,'Table '||a.table_id,'Production inspection coverage · '||coalesce(r.data->>'job',a.wall_record_id)||' · '||a.planned_lf||' LF','',
    case when exists(select 1 from public.walls_production_issues i where i.assignment_id=a.assignment_id and i.status='open') then 'Open production / QC issue' else '' end,
    'Weekly schedule approval is not QC release. Complete and document required inspection separately.','linked','walls_production_assignment',a.assignment_id::text,
    case when exists(select 1 from public.walls_production_issues i where i.assignment_id=a.assignment_id and i.status='open') then 'hold' else 'unconfirmed' end,a.table_id::integer,v_actor
  from public.walls_production_assignments a join public.schedule_records r on r.collection=a.schedule_collection and r.record_id=a.wall_record_id
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='quality_control'
  where a.stage<>'cancelled' and a.pour_at::date between p_week_start and p_week_start+4;

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,g::date,'Plant','Management input required: maintenance priorities and plant-support coverage.','','Missing confirmed maintenance plan','Enter verified equipment, owner, timing, and backup work.','manual_required','',g::date::text,'unconfirmed',extract(isodow from g)::integer,v_actor
  from public.weekly_planner_sections s cross join generate_series(p_week_start,p_week_start+4,interval '1 day') g
  where s.week_start=p_week_start and s.section_key='maintenance_plant';

  update public.weekly_planner_sections set source_fingerprint=v_fingerprint,schedule_version=schedule_version+1,
    status=case when status='approved' then 'reapproval_required' else 'needs_review' end,approved_by_user_id=null,approved_by_email=null,approved_at=null,
    updated_at=now(),updated_by=v_actor where week_start=p_week_start;
  update public.weekly_planner_weeks set status='review',source_revision=coalesce(v_revision,0),source_fingerprint=v_fingerprint,generated_at=now(),generated_by=v_actor,
    version=version+1,updated_at=now(),updated_by=v_actor where week_start=p_week_start;
  update public.weekly_planner_packs set is_active=false where week_start=p_week_start and is_active;
  insert into public.weekly_planner_audit(week_start,event_type,detail,actor_user_id,actor_email)
  values(p_week_start,'generated',jsonb_build_object('source_revision',coalesce(v_revision,0),'source_fingerprint',v_fingerprint),auth.uid(),v_actor);
  perform public.rebuild_weekly_planner_conflicts(p_week_start);
  return jsonb_build_object('ok',true,'week_start',p_week_start,'source_revision',coalesce(v_revision,0),'source_fingerprint',v_fingerprint);
end;
$$;

create or replace function public.save_weekly_planner_section(p_section_id uuid,p_expected_version bigint,p_crew_leader text,p_people jsonb,p_assignments jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_section public.weekly_planner_sections%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_item jsonb;
begin
  select * into v_section from public.weekly_planner_sections where section_id=p_section_id for update;
  if not found then raise exception 'Weekly Planner section not found'; end if;
  if not public.weekly_planner_permission('edit',v_section.section_key) then raise exception 'Weekly Planner edit access required'; end if;
  if v_section.schedule_version<>p_expected_version then raise exception 'Weekly Planner version conflict; refresh before saving'; end if;
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

create or replace function public.save_weekly_planner_inputs(p_week_start date,p_availability jsonb,p_resources jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_item jsonb;
begin
  if not public.weekly_planner_permission('edit') then raise exception 'Weekly Planner edit access required'; end if;
  perform public.ensure_weekly_planner_week(p_week_start);
  if jsonb_typeof(coalesce(p_availability,'[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_resources,'[]'::jsonb))<>'array' then raise exception 'Availability and resources must be arrays'; end if;
  delete from public.weekly_planner_availability where week_start=p_week_start;
  for v_item in select value from jsonb_array_elements(coalesce(p_availability,'[]'::jsonb)) loop
    if btrim(coalesce(v_item->>'employee_name',''))<>'' then
      insert into public.weekly_planner_availability(week_start,employee_name,availability,notes,confirmed,updated_by)
      values(p_week_start,btrim(v_item->>'employee_name'),coalesce(v_item->'availability','{}'::jsonb),btrim(coalesce(v_item->>'notes','')),coalesce((v_item->>'confirmed')::boolean,false),v_actor);
    end if;
  end loop;
  delete from public.weekly_planner_resources where week_start=p_week_start;
  for v_item in select value from jsonb_array_elements(coalesce(p_resources,'[]'::jsonb)) loop
    if btrim(coalesce(v_item->>'resource_name',''))<>'' and coalesce(v_item->>'work_date','') ~ '^\d{4}-\d{2}-\d{2}$' and (v_item->>'work_date')::date between p_week_start and p_week_start+4 then
      insert into public.weekly_planner_resources(week_start,resource_type,resource_name,work_date,start_time,end_time,section_key,project_location,readiness_status,notes,updated_by)
      values(p_week_start,case when v_item->>'resource_type' in ('crane','truck','trailer','forklift','equipment','other') then v_item->>'resource_type' else 'other' end,
        btrim(v_item->>'resource_name'),(v_item->>'work_date')::date,nullif(v_item->>'start_time','')::time,nullif(v_item->>'end_time','')::time,
        btrim(coalesce(v_item->>'section_key','')),btrim(coalesce(v_item->>'project_location','')),
        case when v_item->>'readiness_status' in ('unconfirmed','ready','unavailable','hold') then v_item->>'readiness_status' else 'unconfirmed' end,btrim(coalesce(v_item->>'notes','')),v_actor);
    end if;
  end loop;
  update public.weekly_planner_weeks set status=case when status='approved' then 'reapproval_required' else 'review' end,version=version+1,updated_at=now(),updated_by=v_actor where week_start=p_week_start;
  update public.weekly_planner_packs set is_active=false where week_start=p_week_start and is_active;
  insert into public.weekly_planner_audit(week_start,event_type,detail,actor_user_id,actor_email) values(p_week_start,'planning_inputs_saved','{}',auth.uid(),v_actor);
  perform public.rebuild_weekly_planner_conflicts(p_week_start);
  return jsonb_build_object('ok',true,'week_start',p_week_start);
end;
$$;

create or replace function public.acknowledge_weekly_planner_conflict(p_conflict_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_conflict public.weekly_planner_conflicts%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  select * into v_conflict from public.weekly_planner_conflicts where conflict_id=p_conflict_id for update;
  if not found then raise exception 'Planning conflict not found'; end if;
  if not public.weekly_planner_permission('edit') then raise exception 'Weekly Planner edit access required'; end if;
  if v_conflict.severity='block' then raise exception 'Hard conflicts must be resolved; they cannot be acknowledged'; end if;
  update public.weekly_planner_conflicts set status='acknowledged',acknowledged_by=v_actor,acknowledged_at=now(),resolution_note=btrim(coalesce(p_note,'')),updated_at=now()
  where conflict_id=p_conflict_id returning * into v_conflict;
  insert into public.weekly_planner_audit(week_start,event_type,detail,actor_user_id,actor_email)
  values(v_conflict.week_start,'conflict_acknowledged',jsonb_build_object('conflict_id',p_conflict_id,'note',p_note),auth.uid(),v_actor);
  return to_jsonb(v_conflict);
end;
$$;

create or replace function public.approve_weekly_planner_section(p_section_id uuid,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_section public.weekly_planner_sections%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_current text;v_snapshot jsonb;
begin
  select * into v_section from public.weekly_planner_sections where section_id=p_section_id for update;
  if not found then raise exception 'Weekly Planner section not found'; end if;
  if not public.weekly_planner_permission('approve',v_section.section_key) then raise exception 'Weekly Planner approval access required'; end if;
  if v_section.schedule_version<>p_expected_version then raise exception 'Weekly Planner version conflict; refresh before approving'; end if;
  v_current:=public.weekly_planner_source_fingerprint(v_section.week_start);
  if v_section.source_fingerprint<>v_current then raise exception 'Live operations changed; refresh the weekly plan before approval'; end if;
  if btrim(v_section.crew_leader)='' or not exists(select 1 from public.weekly_planner_section_people where section_id=p_section_id) then raise exception 'Confirm the crew leader and assigned employees before approval'; end if;
  perform public.rebuild_weekly_planner_conflicts(v_section.week_start);
  if exists(select 1 from public.weekly_planner_conflicts c where c.week_start=v_section.week_start and c.status='open' and (cardinality(c.affected_sections)=0 or v_section.section_key=any(c.affected_sections))) then raise exception 'Resolve or acknowledge the section planning conflicts before approval'; end if;
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
$$;

create or replace function public.publish_weekly_planner_pack(p_week_start date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_current text;v_version bigint;v_snapshot jsonb;v_pack public.weekly_planner_packs%rowtype;
begin
  if not public.weekly_planner_permission('publish') then raise exception 'Weekly Planner publication access required'; end if;
  v_current:=public.weekly_planner_source_fingerprint(p_week_start);
  if (select count(*) from public.weekly_planner_sections where week_start=p_week_start and status='approved' and approved_source_fingerprint=v_current)<>8 then raise exception 'All eight sections must be approved and current before publishing'; end if;
  if exists(select 1 from public.weekly_planner_conflicts where week_start=p_week_start and status='open') then raise exception 'Resolve or acknowledge every planning conflict before publishing'; end if;
  select coalesce(max(pack_version),0)+1 into v_version from public.weekly_planner_packs where week_start=p_week_start;
  v_snapshot:=jsonb_build_object('week_start',p_week_start,'week_end',p_week_start+4,'source_fingerprint',v_current,'published_at',now(),'published_by',v_actor,
    'sections',coalesce((select jsonb_agg(jsonb_build_object('section',to_jsonb(s),'people',coalesce((select jsonb_agg(to_jsonb(p) order by p.is_leader desc,p.employee_name) from public.weekly_planner_section_people p where p.section_id=s.section_id),'[]'::jsonb),'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.work_date,a.sort_order,a.assignment_id) from public.weekly_planner_assignments a where a.section_id=s.section_id),'[]'::jsonb)) order by s.sort_order) from public.weekly_planner_sections s where s.week_start=p_week_start),'[]'::jsonb),
    'resources',coalesce((select jsonb_agg(to_jsonb(r) order by r.work_date,r.resource_name) from public.weekly_planner_resources r where r.week_start=p_week_start),'[]'::jsonb),
    'conflicts',coalesce((select jsonb_agg(to_jsonb(c) order by c.severity,c.conflict_type) from public.weekly_planner_conflicts c where c.week_start=p_week_start),'[]'::jsonb));
  update public.weekly_planner_packs set is_active=false where week_start=p_week_start and is_active;
  insert into public.weekly_planner_packs(week_start,pack_version,source_fingerprint,snapshot,published_by_user_id,published_by_email)
  values(p_week_start,v_version,v_current,v_snapshot,auth.uid(),v_actor) returning * into v_pack;
  update public.weekly_planner_weeks set status='approved',version=version+1,updated_at=now(),updated_by=v_actor where week_start=p_week_start;
  insert into public.weekly_planner_audit(week_start,event_type,detail,actor_user_id,actor_email)
  values(p_week_start,'pack_published',jsonb_build_object('pack_id',v_pack.pack_id,'pack_version',v_version,'source_fingerprint',v_current),auth.uid(),v_actor);
  return to_jsonb(v_pack);
end;
$$;

create or replace function public.get_weekly_planner_snapshot(p_week_start date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_current text;
begin
  if not public.weekly_planner_permission('view') then raise exception 'Weekly Planner access required'; end if;
  v_current:=public.weekly_planner_source_fingerprint(p_week_start);
  return jsonb_build_object(
    'permissions',jsonb_build_object('view',true,'edit',public.weekly_planner_permission('edit'),'approve',public.weekly_planner_permission('approve'),'publish',public.weekly_planner_permission('publish')),
    'current_source_fingerprint',v_current,
    'week',(select to_jsonb(w)||jsonb_build_object('source_stale',w.source_fingerprint<>v_current) from public.weekly_planner_weeks w where w.week_start=p_week_start),
    'sections',coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order) from public.weekly_planner_sections s where s.week_start=p_week_start),'[]'::jsonb),
    'people',coalesce((select jsonb_agg(to_jsonb(p) order by p.is_leader desc,p.employee_name) from public.weekly_planner_section_people p join public.weekly_planner_sections s on s.section_id=p.section_id where s.week_start=p_week_start),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.work_date,a.sort_order,a.assignment_id) from public.weekly_planner_assignments a join public.weekly_planner_sections s on s.section_id=a.section_id where s.week_start=p_week_start),'[]'::jsonb),
    'availability',coalesce((select jsonb_agg(to_jsonb(a) order by a.employee_name) from public.weekly_planner_availability a where a.week_start=p_week_start),'[]'::jsonb),
    'resources',coalesce((select jsonb_agg(to_jsonb(r) order by r.work_date,r.resource_name) from public.weekly_planner_resources r where r.week_start=p_week_start),'[]'::jsonb),
    'conflicts',coalesce((select jsonb_agg(to_jsonb(c) order by (c.status='open') desc,c.severity,c.work_date,c.conflict_type) from public.weekly_planner_conflicts c where c.week_start=p_week_start),'[]'::jsonb),
    'packs',coalesce((select jsonb_agg(to_jsonb(p) order by p.published_at desc) from public.weekly_planner_packs p where p.week_start=p_week_start),'[]'::jsonb),
    'recent_packs',coalesce((select jsonb_agg(to_jsonb(p) order by p.published_at desc) from (select * from public.weekly_planner_packs order by published_at desc limit 25) p),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.occurred_at desc) from (select * from public.weekly_planner_audit where week_start=p_week_start order by occurred_at desc limit 100) a),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_weekly_planner_agent_context()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_monday date:=current_date-(extract(isodow from current_date)::integer-1);
begin
  if not public.weekly_planner_permission('view') then return jsonb_build_object('authorized',false,'weeks','[]'::jsonb); end if;
  return jsonb_build_object('authorized',true,'read_only',true,
    'weeks',coalesce((select jsonb_agg(jsonb_build_object(
      'week_start',w.week_start,'week_end',w.week_end,'status',w.status,'source_revision',w.source_revision,
      'source_stale',w.source_fingerprint<>public.weekly_planner_source_fingerprint(w.week_start),'generated_at',w.generated_at,
      'sections',coalesce((select jsonb_agg(jsonb_build_object('section_key',s.section_key,'section_name',s.section_name,'status',s.status,
        'crew_leader',nullif(s.crew_leader,''),'assigned_employees',(select count(*) from public.weekly_planner_section_people p where p.section_id=s.section_id),
        'assignment_count',(select count(*) from public.weekly_planner_assignments a where a.section_id=s.section_id)) order by s.sort_order)
        from public.weekly_planner_sections s where s.week_start=w.week_start),'[]'::jsonb),
      'open_conflicts',coalesce((select jsonb_agg(jsonb_build_object('severity',c.severity,'type',c.conflict_type,'message',c.message,'work_date',c.work_date,'affected_sections',c.affected_sections) order by c.severity,c.work_date)
        from public.weekly_planner_conflicts c where c.week_start=w.week_start and c.status='open'),'[]'::jsonb)
    ) order by w.week_start) from public.weekly_planner_weeks w where w.week_start between v_monday and v_monday+14),'[]'::jsonb),
    'generated_at',now());
end;
$$;

alter table public.weekly_planner_access enable row level security;
alter table public.weekly_planner_weeks enable row level security;
alter table public.weekly_planner_sections enable row level security;
alter table public.weekly_planner_section_people enable row level security;
alter table public.weekly_planner_assignments enable row level security;
alter table public.weekly_planner_availability enable row level security;
alter table public.weekly_planner_resources enable row level security;
alter table public.weekly_planner_conflicts enable row level security;
alter table public.weekly_planner_section_revisions enable row level security;
alter table public.weekly_planner_packs enable row level security;
alter table public.weekly_planner_source_snapshots enable row level security;
alter table public.weekly_planner_audit enable row level security;

revoke all on public.weekly_planner_access,public.weekly_planner_weeks,public.weekly_planner_sections,public.weekly_planner_section_people,public.weekly_planner_assignments,public.weekly_planner_availability,public.weekly_planner_resources,public.weekly_planner_conflicts,public.weekly_planner_section_revisions,public.weekly_planner_packs,public.weekly_planner_source_snapshots,public.weekly_planner_audit from anon;
revoke insert,update,delete on public.weekly_planner_access,public.weekly_planner_weeks,public.weekly_planner_sections,public.weekly_planner_section_people,public.weekly_planner_assignments,public.weekly_planner_availability,public.weekly_planner_resources,public.weekly_planner_conflicts,public.weekly_planner_section_revisions,public.weekly_planner_packs,public.weekly_planner_source_snapshots,public.weekly_planner_audit from authenticated;

do $$ declare t text; begin
  foreach t in array array['weekly_planner_access','weekly_planner_weeks','weekly_planner_sections','weekly_planner_section_people','weekly_planner_assignments','weekly_planner_availability','weekly_planner_resources','weekly_planner_conflicts','weekly_planner_section_revisions','weekly_planner_packs','weekly_planner_source_snapshots','weekly_planner_audit'] loop
    execute format('drop policy if exists "Weekly Planner authorized read" on public.%I',t);
    execute format('create policy "Weekly Planner authorized read" on public.%I for select to authenticated using (public.weekly_planner_permission(''view''))',t);
    execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;

revoke all on function public.weekly_planner_permission(text,text),public.weekly_planner_source_fingerprint(date),public.ensure_weekly_planner_week(date),public.rebuild_weekly_planner_conflicts(date),public.generate_weekly_planner(date),public.save_weekly_planner_section(uuid,bigint,text,jsonb,jsonb),public.save_weekly_planner_inputs(date,jsonb,jsonb),public.acknowledge_weekly_planner_conflict(uuid,text),public.approve_weekly_planner_section(uuid,bigint),public.publish_weekly_planner_pack(date),public.get_weekly_planner_snapshot(date),public.get_weekly_planner_agent_context() from public,anon;
grant execute on function public.get_weekly_planner_snapshot(date),public.get_weekly_planner_agent_context(),public.generate_weekly_planner(date),public.save_weekly_planner_section(uuid,bigint,text,jsonb,jsonb),public.save_weekly_planner_inputs(date,jsonb,jsonb),public.acknowledge_weekly_planner_conflict(uuid,text),public.approve_weekly_planner_section(uuid,bigint),public.publish_weekly_planner_pack(date) to authenticated;

do $$ begin alter publication supabase_realtime add table public.weekly_planner_weeks; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.weekly_planner_sections; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.weekly_planner_conflicts; exception when duplicate_object then null; end $$;

commit;
