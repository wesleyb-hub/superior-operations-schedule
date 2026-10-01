-- Superior Operations structured schedule, evidence gates, backups, and exception queue.
-- Prepared by Scout for Wes Borgen

begin;

create table if not exists public.schedule_meta (
  id bigint primary key default 1 check (id = 1),
  revision bigint not null default 0,
  schema_version integer not null default 35,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

create table if not exists public.schedule_records (
  collection text not null check (collection in ('walls','jobs','billing','loads','historyArchive','deliveryHistory','qcHistory')),
  record_id text not null,
  ordinal integer not null default 0,
  division text,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration',
  primary key (collection, record_id)
);

create index if not exists schedule_records_collection_ordinal_idx on public.schedule_records (collection, ordinal);
create index if not exists schedule_records_division_idx on public.schedule_records (division) where division is not null;

create table if not exists public.schedule_milestones (
  parent_type text not null check (parent_type in ('wall','job')),
  parent_id text not null,
  milestone_key text not null,
  status text not null default 'Not Started',
  evidence_date date,
  owner_role text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration',
  primary key (parent_type, parent_id, milestone_key)
);

create table if not exists public.schedule_settings (
  setting_key text primary key,
  value jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

create table if not exists public.schedule_change_log (
  event_id bigint generated always as identity primary key,
  fingerprint text not null unique,
  occurred_at timestamptz not null,
  week_key text,
  event_type text not null,
  actor text,
  detail text not null,
  source_data jsonb not null,
  recorded_at timestamptz not null default now()
);

create index if not exists schedule_change_log_occurred_idx on public.schedule_change_log (occurred_at desc);

create table if not exists public.schedule_revision_backups (
  revision bigint primary key,
  schema_version integer not null,
  payload jsonb not null,
  payload_fingerprint text not null,
  created_at timestamptz not null default now(),
  created_by text not null,
  reason text not null default 'Automated revision backup'
);

alter table public.schedule_meta enable row level security;
alter table public.schedule_records enable row level security;
alter table public.schedule_milestones enable row level security;
alter table public.schedule_settings enable row level security;
alter table public.schedule_change_log enable row level security;
alter table public.schedule_revision_backups enable row level security;

drop policy if exists "Company users can view schedule meta" on public.schedule_meta;
create policy "Company users can view schedule meta" on public.schedule_meta for select to authenticated using (public.can_access_schedule());
drop policy if exists "Company users can view schedule records" on public.schedule_records;
create policy "Company users can view schedule records" on public.schedule_records for select to authenticated using (public.can_access_schedule());
drop policy if exists "Company users can view schedule milestones" on public.schedule_milestones;
create policy "Company users can view schedule milestones" on public.schedule_milestones for select to authenticated using (public.can_access_schedule());
drop policy if exists "Company users can view schedule settings" on public.schedule_settings;
create policy "Company users can view schedule settings" on public.schedule_settings for select to authenticated using (public.can_access_schedule());
drop policy if exists "Company users can view schedule history" on public.schedule_change_log;
create policy "Company users can view schedule history" on public.schedule_change_log for select to authenticated using (public.can_access_schedule());
drop policy if exists "Approved editors can view revision backups" on public.schedule_revision_backups;
create policy "Approved editors can view revision backups" on public.schedule_revision_backups for select to authenticated using (public.can_edit_schedule());

revoke all on public.schedule_meta, public.schedule_records, public.schedule_milestones, public.schedule_settings, public.schedule_change_log, public.schedule_revision_backups from anon;
revoke insert, update, delete on public.schedule_meta, public.schedule_records, public.schedule_milestones, public.schedule_settings, public.schedule_change_log, public.schedule_revision_backups from authenticated;
grant select on public.schedule_meta, public.schedule_records, public.schedule_milestones, public.schedule_settings, public.schedule_change_log to authenticated;
grant select on public.schedule_revision_backups to authenticated;

create or replace function public.compose_schedule_data()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'walls', coalesce((select jsonb_agg(data order by ordinal) from public.schedule_records where collection='walls'),'[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(data order by ordinal) from public.schedule_records where collection='jobs'),'[]'::jsonb),
    'billing', coalesce((select jsonb_agg(data order by ordinal) from public.schedule_records where collection='billing'),'[]'::jsonb),
    'audit', coalesce((select jsonb_agg(source_data order by occurred_at,event_id) from public.schedule_change_log),'[]'::jsonb),
    'historyArchive', coalesce((select jsonb_agg(data order by ordinal) from public.schedule_records where collection='historyArchive'),'[]'::jsonb),
    'deliveryHistory', coalesce((select jsonb_agg(data order by ordinal) from public.schedule_records where collection='deliveryHistory'),'[]'::jsonb),
    'qcHistory', coalesce((select jsonb_agg(data order by ordinal) from public.schedule_records where collection='qcHistory'),'[]'::jsonb),
    'loads', coalesce((select jsonb_agg(data order by ordinal) from public.schedule_records where collection='loads'),'[]'::jsonb),
    'migrationBackup', (select value from public.schedule_settings where setting_key='migrationBackup'),
    'systemFlags', coalesce((select value from public.schedule_settings where setting_key='systemFlags'),'{}'::jsonb)
  );
$$;

create or replace function public.replace_schedule_records(p_snapshot jsonb, p_actor text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_collection text;
begin
  foreach v_collection in array array['walls','jobs','billing','loads','historyArchive','deliveryHistory','qcHistory'] loop
    delete from public.schedule_records r where r.collection=v_collection and not exists (
      select 1 from jsonb_array_elements(coalesce(p_snapshot->v_collection,'[]'::jsonb)) with ordinality as x(item,ord)
      where coalesce(nullif(x.item->>'id',''),nullif(x.item->>'key',''),md5(x.item::text||':'||x.ord::text))=r.record_id
    );
    insert into public.schedule_records(collection,record_id,ordinal,division,data,updated_at,updated_by)
    select v_collection,coalesce(nullif(x.item->>'id',''),nullif(x.item->>'key',''),md5(x.item::text||':'||x.ord::text)),x.ord::integer,
      nullif(coalesce(x.item->>'division',case when v_collection='walls' then 'walls' else null end),''),x.item,now(),p_actor
    from jsonb_array_elements(coalesce(p_snapshot->v_collection,'[]'::jsonb)) with ordinality as x(item,ord)
    on conflict (collection,record_id) do update set ordinal=excluded.ordinal,division=excluded.division,data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  end loop;

  insert into public.schedule_change_log(fingerprint,occurred_at,week_key,event_type,actor,detail,source_data)
  select md5(x.item::text),coalesce(nullif(x.item->>'timestamp','')::timestamptz,nullif(x.item->>'date','')::timestamptz,now()),
    x.item->>'weekKey',coalesce(nullif(x.item->>'type',''),'Schedule Change'),coalesce(nullif(x.item->>'user',''),p_actor),coalesce(x.item->>'detail',''),x.item
  from jsonb_array_elements(coalesce(p_snapshot->'audit','[]'::jsonb)) as x(item)
  where coalesce(x.item->>'detail','')<>'' on conflict (fingerprint) do nothing;

  delete from public.schedule_milestones where parent_type='wall' and not exists (
    select 1 from jsonb_array_elements(coalesce(p_snapshot->'walls','[]'::jsonb)) x(item) where x.item->>'id'=schedule_milestones.parent_id
  );
  insert into public.schedule_milestones(parent_type,parent_id,milestone_key,status,evidence_date,owner_role,data,updated_at,updated_by)
  select 'wall',w.item->>'id',stage.key,coalesce(nullif(stage.value->>'status',''),'Not Started'),
    case when coalesce(stage.value->>'date','') ~ '^\d{4}-\d{2}-\d{2}$' then (stage.value->>'date')::date else null end,
    case stage.key when 'structuralReview' then 'Engineering / Drafting' when 'approvedProduction' then 'Superior Walls Manager / Management' else 'Drafting / Project Coordination' end,
    stage.value,now(),p_actor
  from jsonb_array_elements(coalesce(p_snapshot->'walls','[]'::jsonb)) w(item)
  cross join lateral jsonb_each(coalesce(w.item#>'{planReview,stages}','{}'::jsonb)) stage
  where coalesce(w.item->>'id','')<>''
  on conflict (parent_type,parent_id,milestone_key) do update set status=excluded.status,evidence_date=excluded.evidence_date,owner_role=excluded.owner_role,data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by;

  insert into public.schedule_settings(setting_key,value,updated_at,updated_by)
  values ('migrationBackup',p_snapshot->'migrationBackup',now(),p_actor),('systemFlags',coalesce(p_snapshot->'systemFlags','{}'::jsonb),now(),p_actor)
  on conflict (setting_key) do update set value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
end;
$$;

create or replace function public.enforce_schedule_gates(p_snapshot jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_snapshot->'walls','[]'::jsonb)) n(item)
    left join public.schedule_records o on o.collection='walls' and o.record_id=n.item->>'id'
    where coalesce(n.item->>'productionDate','')<>coalesce(o.data->>'productionDate','') and coalesce(n.item->>'productionDate','')<>''
      and coalesce(n.item#>>'{planReview,stages,approvedProduction,status}','')<>'Complete'
  ) then raise exception 'Production Date requires a completed Approved for Production milestone.'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_snapshot->'walls','[]'::jsonb)) n(item)
    left join public.schedule_records o on o.collection='walls' and o.record_id=n.item->>'id'
    where (coalesce(n.item->>'completedDate','')<>coalesce(o.data->>'completedDate','') or coalesce(n.item->>'completedMonth','')<>coalesce(o.data->>'completedMonth',''))
      and (coalesce(n.item->>'completedDate','')<>'' or coalesce(n.item->>'completedMonth','')<>'')
      and coalesce(n.item#>>'{planReview,stages,approvedProduction,status}','')<>'Complete'
  ) then raise exception 'Operational completion requires a completed Approved for Production milestone.'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_snapshot->'jobs','[]'::jsonb)) n(item)
    left join public.schedule_records o on o.collection='jobs' and o.record_id=n.item->>'id'
    where coalesce(n.item->>'completedDate','')<>coalesce(o.data->>'completedDate','') and coalesce(n.item->>'completedDate','')<>''
      and jsonb_array_length(coalesce(n.item->'products','[]'::jsonb))>0
      and exists (select 1 from jsonb_array_elements(coalesce(n.item->'products','[]'::jsonb)) p(item) where coalesce(p.item->>'status','')<>'released')
  ) then raise exception 'Project completion requires every listed product to be QC released.'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_snapshot->'billing','[]'::jsonb)) n(item)
    left join public.schedule_records o on o.collection='billing' and o.record_id=n.item->>'key'
    where coalesce(n.item->>'status','')='Billed' and coalesce(o.data->>'status','')<>'Billed'
      and (coalesce(n.item->>'invoice','')='' or coalesce(n.item->>'invoiceDate','')='')
  ) then raise exception 'Billed status requires an invoice number and invoice date.'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_snapshot->'loads','[]'::jsonb)) n(item)
    join public.schedule_records o on o.collection='loads' and o.record_id=n.item->>'id'
    where coalesce(n.item->>'status','')='Delivered' and coalesce(o.data->>'status','') not in ('Loaded','Delivered')
  ) then raise exception 'Delivery must pass through Loaded before it can be marked Delivered.'; end if;
end;
$$;

create or replace function public.get_schedule_snapshot()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_meta public.schedule_meta%rowtype;
begin
  if not public.can_access_schedule() then raise exception 'Not authorized'; end if;
  select * into v_meta from public.schedule_meta where id=1;
  return jsonb_build_object('id',1,'revision',v_meta.revision,'updated_at',v_meta.updated_at,'updated_by',v_meta.updated_by,
    'payload',jsonb_build_object('schemaVersion',v_meta.schema_version,'data',public.compose_schedule_data()));
end;
$$;

create or replace function public.save_schedule_snapshot(p_expected_revision bigint,p_snapshot jsonb,p_reason text default 'Saved')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_meta public.schedule_meta%rowtype; v_next bigint; v_actor text:=coalesce(auth.jwt()->>'email','authorized editor'); v_data jsonb;
begin
  if not public.can_edit_schedule() then raise exception 'Read-only account'; end if;
  select * into v_meta from public.schedule_meta where id=1 for update;
  if v_meta.revision<>p_expected_revision then raise exception 'Revision conflict'; end if;
  perform public.enforce_schedule_gates(p_snapshot);
  perform public.replace_schedule_records(p_snapshot,v_actor);
  v_next:=v_meta.revision+1;
  update public.schedule_meta set revision=v_next,schema_version=35,updated_at=now(),updated_by=v_actor where id=1 returning * into v_meta;
  v_data:=public.compose_schedule_data();
  insert into public.schedule_revision_backups(revision,schema_version,payload,payload_fingerprint,created_by,reason)
  values(v_next,35,jsonb_build_object('schemaVersion',35,'data',v_data),md5(v_data::text),v_actor,coalesce(nullif(p_reason,''),'Saved')) on conflict (revision) do nothing;
  return jsonb_build_object('id',1,'revision',v_next,'updated_at',v_meta.updated_at,'updated_by',v_actor,'payload',jsonb_build_object('schemaVersion',35,'data',v_data));
end;
$$;

create or replace function public.list_schedule_backups()
returns table(revision bigint,schema_version integer,created_at timestamptz,created_by text,reason text,payload_fingerprint text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.can_edit_schedule() then raise exception 'Not authorized'; end if;
  return query select b.revision,b.schema_version,b.created_at,b.created_by,b.reason,b.payload_fingerprint from public.schedule_revision_backups b order by b.revision desc;
end;
$$;

create or replace function public.restore_schedule_revision(p_revision bigint,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_payload jsonb;
begin
  if not public.can_edit_schedule() then raise exception 'Not authorized'; end if;
  select payload into v_payload from public.schedule_revision_backups where revision=p_revision;
  if v_payload is null then raise exception 'Backup revision not found'; end if;
  return public.save_schedule_snapshot(p_expected_revision,v_payload->'data','Restore backup revision '||p_revision);
end;
$$;

revoke all on function public.compose_schedule_data() from public,anon,authenticated;
revoke all on function public.replace_schedule_records(jsonb,text) from public,anon,authenticated;
revoke all on function public.enforce_schedule_gates(jsonb) from public,anon,authenticated;
grant execute on function public.get_schedule_snapshot() to authenticated;
grant execute on function public.save_schedule_snapshot(bigint,jsonb,text) to authenticated;
grant execute on function public.list_schedule_backups() to authenticated;
grant execute on function public.restore_schedule_revision(bigint,bigint) to authenticated;

insert into public.schedule_meta(id,revision,schema_version,updated_at,updated_by)
select 1,revision,35,updated_at,updated_by from public.schedule_state where id=1 on conflict (id) do nothing;

select public.replace_schedule_records(
  case when (select payload ? 'data' from public.schedule_state where id=1) then (select payload->'data' from public.schedule_state where id=1)
  else (select payload from public.schedule_state where id=1) end,
  'structured migration'
);

insert into public.schedule_revision_backups(revision,schema_version,payload,payload_fingerprint,created_by,reason)
select m.revision,35,jsonb_build_object('schemaVersion',35,'data',public.compose_schedule_data()),md5(public.compose_schedule_data()::text),
  'structured migration','Initial structured-data migration' from public.schedule_meta m where m.id=1 on conflict (revision) do nothing;

create or replace view public.operations_exception_queue with (security_invoker=true) as
select r.record_id,'walls'::text division,'Critical'::text severity,'Production scheduled without release'::text exception_type,
  'Superior Walls Manager / Management'::text owner_role,'Complete and evidence the Approved for Production milestone'::text next_action,
  nullif(r.data->>'productionDate','')::date due_date,'Approved for Production is not Complete'::text blocker,r.updated_at source_last_verified
from public.schedule_records r where r.collection='walls' and coalesce(r.data->>'productionDate','')<>'' and coalesce(r.data#>>'{planReview,stages,approvedProduction,status}','')<>'Complete'
union all
select r.record_id,'walls','High','Active job missing Production Date','Project Coordination','Confirm release evidence and assign a supported Production Date',
  null,'Production Date is missing',r.updated_at
from public.schedule_records r where r.collection='walls' and coalesce(r.data->>'completedDate','')='' and coalesce(r.data->>'completedMonth','')='' and coalesce(r.data->>'productionDate','')=''
union all
select r.record_id,coalesce(r.division,'precast'),'High','Project status '||coalesce(r.data->>'status','At Risk'),'Operations',
  'Resolve the recorded constraint and verify the controlling schedule',null,coalesce(nullif(r.data->>'constraint',''),'Project is marked at risk or hold'),r.updated_at
from public.schedule_records r where r.collection='jobs' and coalesce(r.data->>'completedDate','')='' and coalesce(r.data->>'status','') in ('At Risk','Hold')
union all
select r.record_id,coalesce(r.division,'delivery'),'High','Past-due delivery','Field Operations / Logistics','Verify readiness and reschedule or complete the delivery',
  nullif(r.data->>'date','')::date,'Delivery date has passed without Delivered status',r.updated_at
from public.schedule_records r where r.collection='loads' and coalesce(r.data->>'status','')<>'Delivered' and coalesce(r.data->>'date','') ~ '^\d{4}-\d{2}-\d{2}$' and (r.data->>'date')::date<current_date
union all
select r.record_id,coalesce(r.division,'billing'),'Medium','Billing hold','Accounting','Verify the hold evidence and define the next billing action',
  null,'Billing status is Hold',r.updated_at
from public.schedule_records r where r.collection='billing' and coalesce(r.data->>'status','')='Hold';

grant select on public.operations_exception_queue to authenticated;

do $$ begin alter publication supabase_realtime add table public.schedule_meta; exception when duplicate_object then null; end $$;

commit;
