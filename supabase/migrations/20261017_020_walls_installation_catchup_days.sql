-- Standalone Superior Walls field catch-up day cards and tasks.
-- Additive only: preserves existing installation, schedule, planner, and QC records.
-- Prepared by Scout for Wes Borgen

begin;

create table if not exists public.walls_installation_day_cards (
  card_id uuid primary key default gen_random_uuid(),
  work_date date not null,
  title text not null check (length(btrim(title)) between 2 and 120),
  notes text not null default '' check (length(notes)<=2000),
  status text not null default 'planned' check (status in ('planned','cancelled')),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

create table if not exists public.walls_installation_day_tasks (
  task_id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.walls_installation_day_cards(card_id) on delete restrict,
  task_title text not null check (length(btrim(task_title)) between 2 and 160),
  start_time time,
  end_time time,
  status text not null default 'planned' check (status in ('planned','in_progress','completed','on_hold','cancelled')),
  notes text not null default '' check (length(notes)<=2000),
  crew_names text[] not null default '{}',
  equipment_names text[] not null default '{}',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  check (end_time is null or start_time is null or end_time>start_time)
);

create table if not exists public.walls_installation_day_events (
  event_id bigint generated always as identity primary key,
  card_id uuid not null references public.walls_installation_day_cards(card_id) on delete restrict,
  task_id uuid references public.walls_installation_day_tasks(task_id) on delete restrict,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_email text not null default '',
  occurred_at timestamptz not null default now()
);

create index if not exists walls_installation_day_cards_date_idx on public.walls_installation_day_cards(work_date,status);
create unique index if not exists walls_installation_one_active_day_card_idx on public.walls_installation_day_cards(work_date) where status='planned';
create index if not exists walls_installation_day_tasks_card_idx on public.walls_installation_day_tasks(card_id,status,start_time);
alter table public.walls_installation_day_cards enable row level security;
alter table public.walls_installation_day_tasks enable row level security;
alter table public.walls_installation_day_events enable row level security;
revoke all on public.walls_installation_day_cards,public.walls_installation_day_tasks,public.walls_installation_day_events from anon,authenticated;
grant select on public.walls_installation_day_cards,public.walls_installation_day_tasks,public.walls_installation_day_events to authenticated;
create policy "Walls installation day cards authorized read" on public.walls_installation_day_cards for select to authenticated using (public.walls_installation_permission('view'));
create policy "Walls installation day tasks authorized read" on public.walls_installation_day_tasks for select to authenticated using (public.walls_installation_permission('view'));
create policy "Walls installation day events authorized read" on public.walls_installation_day_events for select to authenticated using (public.walls_installation_permission('view'));

create or replace function public.save_walls_installation_day_card(
  p_card_id uuid,p_work_date date,p_title text,p_notes text default '',p_status text default 'planned',p_expected_version bigint default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_installation_day_cards%rowtype;v_before jsonb;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.walls_installation_permission('manage') then raise exception 'Superior Walls Installation management access required';end if;
  if p_work_date is null then raise exception 'Work date is required';end if;
  if length(btrim(coalesce(p_title,''))) not between 2 and 120 then raise exception 'Day card title must be between 2 and 120 characters';end if;
  if length(coalesce(p_notes,''))>2000 then raise exception 'Day card notes are limited to 2000 characters';end if;
  if p_status not in ('planned','cancelled') then raise exception 'Unsupported day card status';end if;
  if p_card_id is null then
    insert into public.walls_installation_day_cards(work_date,title,notes,status,created_by,updated_by)
    values(p_work_date,btrim(p_title),coalesce(p_notes,''),p_status,v_actor,v_actor) returning * into v_row;
    insert into public.walls_installation_day_events(card_id,event_type,detail,actor_user_id,actor_email)
    values(v_row.card_id,'day_card_created',to_jsonb(v_row),auth.uid(),v_actor);
  else
    select * into v_row from public.walls_installation_day_cards where card_id=p_card_id for update;
    if not found then raise exception 'Installation day card not found';end if;
    if p_expected_version is null or v_row.version<>p_expected_version then raise exception 'Installation day card changed; refresh and retry';end if;
    if v_row.status='cancelled' and p_status<>'cancelled' then raise exception 'Cancelled day cards are preserved; create a new card instead';end if;
    if p_status='cancelled' and exists(select 1 from public.walls_installation_day_tasks where card_id=p_card_id and status in ('in_progress','completed')) then raise exception 'A card with work started or completed cannot be cancelled';end if;
    v_before:=to_jsonb(v_row);
    update public.walls_installation_day_cards set work_date=p_work_date,title=btrim(p_title),notes=coalesce(p_notes,''),status=p_status,
      version=version+1,updated_at=now(),updated_by=v_actor where card_id=p_card_id returning * into v_row;
    insert into public.walls_installation_day_events(card_id,event_type,detail,actor_user_id,actor_email)
    values(v_row.card_id,case when p_status='cancelled' then 'day_card_cancelled' else 'day_card_updated' end,jsonb_build_object('before',v_before,'after',to_jsonb(v_row)),auth.uid(),v_actor);
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.save_walls_installation_day_task(
  p_task_id uuid,p_card_id uuid,p_task_title text,p_start_time time default null,p_end_time time default null,p_status text default 'planned',p_notes text default '',
  p_crew_names text[] default '{}',p_equipment_names text[] default '{}',p_expected_version bigint default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_installation_day_tasks%rowtype;v_card public.walls_installation_day_cards%rowtype;v_before jsonb;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_crew text[];v_equipment text[];
begin
  if not public.walls_installation_permission('manage') then raise exception 'Superior Walls Installation management access required';end if;
  if length(btrim(coalesce(p_task_title,''))) not between 2 and 160 then raise exception 'Task title must be between 2 and 160 characters';end if;
  if length(coalesce(p_notes,''))>2000 then raise exception 'Task notes are limited to 2000 characters';end if;
  if p_status not in ('planned','in_progress','completed','on_hold','cancelled') then raise exception 'Unsupported catch-up task status';end if;
  if p_end_time is not null and p_start_time is not null and p_end_time<=p_start_time then raise exception 'End time must be after start time';end if;
  select coalesce(array_agg(btrim(x)),'{}'::text[]) into v_crew from unnest(coalesce(p_crew_names,'{}'::text[])) x where btrim(x)<>'';
  select coalesce(array_agg(btrim(x)),'{}'::text[]) into v_equipment from unnest(coalesce(p_equipment_names,'{}'::text[])) x where btrim(x)<>'';
  if cardinality(v_crew)>20 or cardinality(v_equipment)>20 or exists(select 1 from unnest(v_crew||v_equipment) x where length(x)>100) then raise exception 'Resource names are limited to 20 entries of 100 characters each';end if;
  select * into v_card from public.walls_installation_day_cards where card_id=p_card_id for update;
  if not found or v_card.status<>'planned' then raise exception 'An active installation day card is required';end if;
  if p_task_id is null then
    insert into public.walls_installation_day_tasks(card_id,task_title,start_time,end_time,status,notes,crew_names,equipment_names,created_by,updated_by)
    values(p_card_id,btrim(p_task_title),p_start_time,p_end_time,p_status,coalesce(p_notes,''),v_crew,v_equipment,v_actor,v_actor) returning * into v_row;
    insert into public.walls_installation_day_events(card_id,task_id,event_type,detail,actor_user_id,actor_email)
    values(p_card_id,v_row.task_id,'catchup_task_created',to_jsonb(v_row),auth.uid(),v_actor);
  else
    select * into v_row from public.walls_installation_day_tasks where task_id=p_task_id for update;
    if not found or v_row.card_id<>p_card_id then raise exception 'Catch-up task does not belong to this day card';end if;
    if p_expected_version is null or v_row.version<>p_expected_version then raise exception 'Catch-up task changed; refresh and retry';end if;
    if v_row.status in ('completed','cancelled') and p_status<>v_row.status then raise exception 'Completed or cancelled task history is preserved; create a new task instead';end if;
    v_before:=to_jsonb(v_row);
    update public.walls_installation_day_tasks set task_title=btrim(p_task_title),start_time=p_start_time,end_time=p_end_time,status=p_status,notes=coalesce(p_notes,''),
      crew_names=v_crew,equipment_names=v_equipment,version=version+1,updated_at=now(),updated_by=v_actor where task_id=p_task_id returning * into v_row;
    insert into public.walls_installation_day_events(card_id,task_id,event_type,detail,actor_user_id,actor_email)
    values(p_card_id, v_row.task_id,case when p_status='cancelled' then 'catchup_task_cancelled' else 'catchup_task_updated' end,jsonb_build_object('before',v_before,'after',to_jsonb(v_row)),auth.uid(),v_actor);
  end if;
  update public.walls_installation_day_cards set version=version+1,updated_at=now(),updated_by=v_actor where card_id=p_card_id;
  return jsonb_build_object('task',to_jsonb(v_row),'card',to_jsonb(v_card));
end;
$$;

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
      where r.collection='walls' and ((coalesce(r.data->>'completedDate','')='' and coalesce(r.data->>'completedMonth','')='' and (coalesce(r.data->>'installDate','')='' or (r.data->>'installDate') between p_from::text and p_to::text or exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_date between p_from and p_to)))
        or exists(select 1 from public.walls_production_assignments p left join public.walls_installation_qc_releases q on q.assignment_id=p.assignment_id where p.wall_record_id=r.record_id and p.stage='stripped' and q.status is distinct from 'released')
        or exists(select 1 from public.schedule_records l where l.collection='loads' and l.division='walls' and l.data->>'linkType'='wall' and l.data->>'linkId'=r.record_id and coalesce(l.data->>'status','') not in ('Delivered','Cancelled')))
    ),'[]'::jsonb),
    'day_cards',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.start_time,t.created_at,t.task_id) from public.walls_installation_day_tasks t where t.card_id=c.card_id and t.status<>'cancelled'),'[]'::jsonb)) order by c.work_date,c.created_at,c.card_id)
      from public.walls_installation_day_cards c where c.status='planned' and c.work_date between p_from and p_to),'[]'::jsonb),
    'resource_conflicts',coalesce((select jsonb_agg(jsonb_build_object('resource',resource_name,'resource_type',resource_type,'date',activity_date,'activities',activity_ids) order by activity_date,resource_type,resource_name) from (
      select resource_name,resource_type,activity_date,array_agg(activity_id) activity_ids from (
        select a.activity_id::text activity_id,a.activity_date,x.resource_type,lower(trim(x.resource_name)) resource_name from public.walls_installation_activities a join public.walls_installation_resources x on x.activity_id=a.activity_id where a.status in ('planned','in_progress','on_hold') and x.availability_status<>'unavailable' and a.activity_date between p_from and p_to and nullif(trim(x.resource_name),'') is not null
        union all select t.task_id::text,c.work_date,'employee',lower(trim(x)) from public.walls_installation_day_tasks t join public.walls_installation_day_cards c on c.card_id=t.card_id cross join lateral unnest(t.crew_names) x where t.status in ('planned','in_progress','on_hold') and c.status='planned' and c.work_date between p_from and p_to and nullif(trim(x),'') is not null
        union all select t.task_id::text,c.work_date,'equipment',lower(trim(x)) from public.walls_installation_day_tasks t join public.walls_installation_day_cards c on c.card_id=t.card_id cross join lateral unnest(t.equipment_names) x where t.status in ('planned','in_progress','on_hold') and c.status='planned' and c.work_date between p_from and p_to and nullif(trim(x),'') is not null
      ) u group by resource_name,resource_type,activity_date having count(distinct activity_id)>1
    ) conflicts),'[]'::jsonb),
    'generated_at',now()
  );
end;
$$;

revoke all on function public.save_walls_installation_day_card(uuid,date,text,text,text,bigint),public.save_walls_installation_day_task(uuid,uuid,text,time,time,text,text,text[],text[],bigint) from public,anon;
grant execute on function public.save_walls_installation_day_card(uuid,date,text,text,text,bigint),public.save_walls_installation_day_task(uuid,uuid,text,time,time,text,text,text[],text[],bigint) to authenticated;

do $$ begin alter publication supabase_realtime add table public.walls_installation_day_cards; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.walls_installation_day_tasks; exception when duplicate_object then null; end $$;

commit;

