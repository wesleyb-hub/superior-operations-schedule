-- Employee access boundaries and durable inventory automation.
-- Additive to the live Superior Operations Hub; no operational records are rewritten.
-- Prepared by Scout for Wes Borgen

begin;

create table if not exists public.app_employee_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile_key text not null check (profile_key in ('walls_inventory_counter','plant_manager_readonly')),
  legal_entity text not null default 'Superior Walls of North Dakota, LLC'
    check (legal_entity = 'Superior Walls of North Dakota, LLC'),
  division_key text not null default 'walls' check (division_key = 'walls'),
  inventory_area text not null default 'production' check (inventory_area = 'production'),
  allowed_views text[] not null default array['overview','walls','inventory']::text[],
  allowed_wall_subviews text[] not null default array['current','overall','active']::text[],
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

alter table public.app_employee_access enable row level security;
revoke all on public.app_employee_access from anon;
revoke insert,update,delete on public.app_employee_access from authenticated;
grant select on public.app_employee_access to authenticated;

create or replace function public.is_operations_admin()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists (
    select 1 from public.app_user_roles r
    where r.user_id=auth.uid() and r.can_write
  );
$$;

create or replace function public.has_employee_access()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists (
    select 1 from public.app_employee_access a
    where a.user_id=auth.uid() and a.enabled
  );
$$;

drop policy if exists "Employees can read their own access" on public.app_employee_access;
create policy "Employees can read their own access" on public.app_employee_access
for select to authenticated using (user_id=auth.uid() or public.is_operations_admin());
grant select on public.app_employee_access to authenticated;

create or replace function public.get_app_access()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_role public.app_user_roles%rowtype; v_employee public.app_employee_access%rowtype;
begin
  select * into v_role from public.app_user_roles where user_id=auth.uid();
  if found then
    return jsonb_build_object(
      'authorized',true,'profile_key',coalesce(v_role.role,'viewer'),'can_write',v_role.can_write,
      'is_admin',v_role.can_write,'allowed_views',to_jsonb(array['overview','walls','boxes','manholes','fence','block','qc','delivery','inventory','billing','exceptions','import','audit','history']::text[]),
      'allowed_wall_subviews',to_jsonb(array['current','overall','active','plans','monthly','year']::text[])
    );
  end if;
  select * into v_employee from public.app_employee_access where user_id=auth.uid() and enabled;
  if found then
    return jsonb_build_object(
      'authorized',true,'profile_key',v_employee.profile_key,'can_write',false,'is_admin',false,
      'allowed_views',to_jsonb(v_employee.allowed_views),'allowed_wall_subviews',to_jsonb(v_employee.allowed_wall_subviews),
      'division_key',v_employee.division_key,'inventory_area',v_employee.inventory_area
    );
  end if;
  return jsonb_build_object('authorized',false,'profile_key','none','can_write',false,'is_admin',false,'allowed_views','[]'::jsonb,'allowed_wall_subviews','[]'::jsonb);
end;
$$;

-- Raw schedule tables are management-only. Restricted employees receive a filtered snapshot RPC.
drop policy if exists "Company users can view all dashboards" on public.schedule_state;
create policy "Operations admins can view schedule state" on public.schedule_state
for select to authenticated using (public.is_operations_admin());

drop policy if exists "Company users can view schedule meta" on public.schedule_meta;
create policy "Operations admins can view schedule meta" on public.schedule_meta
for select to authenticated using (public.is_operations_admin() or public.has_employee_access());
drop policy if exists "Company users can view schedule records" on public.schedule_records;
create policy "Operations admins can view schedule records" on public.schedule_records
for select to authenticated using (public.is_operations_admin());
drop policy if exists "Company users can view schedule milestones" on public.schedule_milestones;
create policy "Operations admins can view schedule milestones" on public.schedule_milestones
for select to authenticated using (public.is_operations_admin());
drop policy if exists "Company users can view schedule settings" on public.schedule_settings;
create policy "Operations admins can view schedule settings" on public.schedule_settings
for select to authenticated using (public.is_operations_admin());
drop policy if exists "Company users can view schedule history" on public.schedule_change_log;
create policy "Operations admins can view schedule history" on public.schedule_change_log
for select to authenticated using (public.is_operations_admin());

create or replace function public.get_schedule_snapshot()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_meta public.schedule_meta%rowtype; v_data jsonb; v_access public.app_employee_access%rowtype;
begin
  select * into v_meta from public.schedule_meta where id=1;
  if public.is_operations_admin() then
    v_data:=public.compose_schedule_data();
  else
    select * into v_access from public.app_employee_access where user_id=auth.uid() and enabled;
    if not found then raise exception 'Not authorized'; end if;
    v_data:=jsonb_build_object(
      'walls',coalesce((select jsonb_agg(r.data - 'planReview' order by r.ordinal) from public.schedule_records r where r.collection='walls' and coalesce(r.division,'walls')='walls'),'[]'::jsonb),
      'jobs','[]'::jsonb,'billing','[]'::jsonb,'audit','[]'::jsonb,'historyArchive','[]'::jsonb,
      'deliveryHistory','[]'::jsonb,'qcHistory','[]'::jsonb,'loads','[]'::jsonb,
      'migrationBackup',null,'systemFlags','{}'::jsonb
    );
  end if;
  return jsonb_build_object('id',1,'revision',v_meta.revision,'updated_at',v_meta.updated_at,'updated_by',v_meta.updated_by,
    'payload',jsonb_build_object('schemaVersion',v_meta.schema_version,'data',v_data));
end;
$$;

-- Inventory access is independent from general shared-data write permission.
create or replace function public.inventory_access(p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_operations_admin() or exists (
    select 1 from public.inventory_user_access a
    where a.email=lower(coalesce(auth.jwt()->>'email','')) and a.enabled
      and case p_permission when 'manage' then a.can_manage when 'adjust' then (a.can_adjust or a.can_manage) else (a.can_view or a.can_adjust or a.can_manage) end
  ) or exists (
    select 1 from public.app_employee_access a
    where a.user_id=auth.uid() and a.enabled and a.division_key='walls' and a.inventory_area='production'
      and case p_permission when 'manage' then false when 'adjust' then a.profile_key='walls_inventory_counter' else true end
  );
$$;

create or replace function public.inventory_item_access(p_item_id bigint,p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_operations_admin() or exists (
    select 1 from public.inventory_items i
    where i.item_id=p_item_id and (
      exists (
        select 1 from public.inventory_user_access a
        where a.email=lower(coalesce(auth.jwt()->>'email','')) and a.enabled
          and case p_permission when 'manage' then a.can_manage when 'adjust' then (a.can_adjust or a.can_manage) else (a.can_view or a.can_adjust or a.can_manage) end
      ) or exists (
        select 1 from public.app_employee_access a
        where a.user_id=auth.uid() and a.enabled and a.division_key=i.division_key and a.inventory_area=i.inventory_area
          and case p_permission when 'manage' then false when 'adjust' then a.profile_key='walls_inventory_counter' else true end
      )
    )
  );
$$;

drop policy if exists "Inventory users can view materials" on public.inventory_items;
create policy "Inventory users can view materials" on public.inventory_items
for select to authenticated using (public.inventory_item_access(item_id,'view'));

drop policy if exists "Inventory managers can view events" on public.inventory_events;
create policy "Inventory users can view relevant events" on public.inventory_events
for select to authenticated using (public.inventory_item_access(item_id,'view'));

create or replace function public.adjust_inventory_quantity(p_item_id bigint,p_delta integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before integer;v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_item_access(p_item_id,'adjust') then raise exception 'Inventory adjustment access required'; end if;
  if p_delta not in (-1,1) then raise exception 'Adjustment must be -1 or 1'; end if;
  select quantity into v_before from public.inventory_items where item_id=p_item_id for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if v_before is null then raise exception 'Set an initial count first'; end if;
  update public.inventory_items set quantity=greatest(0,v_before+p_delta),ordered=case when greatest(0,v_before+p_delta)>coalesce(reorder_threshold,-1) then false else ordered end,updated_by=v_actor where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email) values(p_item_id,'adjusted',v_before,v_item.quantity,jsonb_build_object('delta',p_delta),v_actor);
  return to_jsonb(v_item);
end;
$$;

create or replace function public.set_inventory_count(p_item_id bigint,p_expected_version bigint,p_quantity integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.inventory_items%rowtype; v_item public.inventory_items%rowtype; v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_item_access(p_item_id,'adjust') then raise exception 'Inventory count access required'; end if;
  if p_quantity is null or p_quantity<0 then raise exception 'Quantity must be zero or a positive whole number'; end if;
  select * into v_old from public.inventory_items where item_id=p_item_id for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if v_old.version<>p_expected_version then raise exception 'Inventory version conflict'; end if;
  update public.inventory_items set quantity=p_quantity,updated_by=v_actor
    where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email)
  values(p_item_id,'corrected',v_old.quantity,v_item.quantity,jsonb_build_object('count_only',true),v_actor);
  return to_jsonb(v_item);
end;
$$;

create or replace function public.receive_inventory_stock(p_item_id bigint,p_expected_version bigint,p_quantity integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before integer;v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_access('manage') then raise exception 'Inventory management access required'; end if;
  if p_quantity is null or p_quantity<1 then raise exception 'Received quantity must be a positive whole number'; end if;
  select quantity into v_before from public.inventory_items where item_id=p_item_id and version=p_expected_version for update;
  if not found then raise exception 'Inventory item missing or version conflict'; end if;
  update public.inventory_items set quantity=coalesce(v_before,0)+p_quantity,ordered=false,ordered_at=null,ordered_by=null,updated_by=v_actor where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email)
  values(p_item_id,'received',v_before,v_item.quantity,jsonb_build_object('received',p_quantity),v_actor);
  return to_jsonb(v_item);
end;
$$;

create or replace function public.mark_inventory_ordered(p_item_id bigint,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_access('manage') then raise exception 'Inventory management access required'; end if;
  update public.inventory_items set ordered=true,ordered_at=now(),ordered_by=v_actor,updated_at=now(),updated_by=v_actor,version=version+1
    where item_id=p_item_id and version=p_expected_version returning * into v_item;
  if not found then raise exception 'Inventory item missing or version conflict'; end if;
  update public.inventory_alert_outbox set delivery_status='suppressed',last_error='Suppressed because material was marked ordered'
    where item_id=p_item_id and delivery_status in ('pending','failed');
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,actor_email)
    values(p_item_id,'marked_ordered',v_item.quantity,v_item.quantity,v_actor);
  return to_jsonb(v_item);
end;
$$;

alter table public.inventory_alert_outbox add column if not exists next_attempt_at timestamptz not null default now();
alter table public.inventory_alert_outbox add column if not exists claimed_at timestamptz;
alter table public.inventory_alert_outbox add column if not exists provider_message_id text;
alter table public.inventory_alert_outbox drop constraint if exists inventory_alert_outbox_delivery_status_check;
alter table public.inventory_alert_outbox add constraint inventory_alert_outbox_delivery_status_check
  check (delivery_status in ('pending','sending','sent','failed','suppressed'));

create or replace function public.inventory_prepare_alert()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_was_low boolean:=coalesce(old.quantity is not null and old.reorder_threshold is not null and old.quantity<=old.reorder_threshold,false);
v_is_low boolean:=new.quantity is not null and new.reorder_threshold is not null and new.quantity<=new.reorder_threshold;
begin
  if not v_is_low then
    new.reorder_alert_open:=false;
  elsif old.ordered or new.ordered then
    new.reorder_alert_open:=true;
  elsif not v_was_low and not old.reorder_alert_open then
    new.reorder_alert_open:=true;
    insert into public.inventory_alert_outbox(item_id,payload) values(new.item_id,jsonb_build_object(
      'item_id',new.item_id,'titan_code',new.titan_code,'description',new.description,'category',new.category,
      'quantity',new.quantity,'reorder_threshold',new.reorder_threshold,'unit',new.unit,'updated_by',new.updated_by,
      'updated_at',now(),'purchase_status',case when new.ordered then 'Ordered' else 'Not ordered' end,
      'direct_link','https://wesleyb-hub.github.io/superior-operations-schedule/?view=inventory'
    ));
  end if;
  new.updated_at:=now();new.version:=old.version+1;
  return new;
end;
$$;

create or replace function public.claim_inventory_alerts(p_alert_id bigint default null,p_limit integer default 10)
returns setof public.inventory_alert_outbox language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
  update public.inventory_alert_outbox a set delivery_status='suppressed',last_error='Suppressed because material is already ordered'
  from public.inventory_items i where i.item_id=a.item_id and i.ordered and a.delivery_status in ('pending','failed');
  return query
  with claimable as (
    select a.alert_id from public.inventory_alert_outbox a
    where (p_alert_id is null or a.alert_id=p_alert_id)
      and ((a.delivery_status='pending') or (a.delivery_status='failed' and a.next_attempt_at<=now()))
      and a.attempts<6
    order by a.created_at
    for update skip locked limit greatest(1,least(coalesce(p_limit,10),25))
  )
  update public.inventory_alert_outbox a set delivery_status='sending',claimed_at=now(),attempts=a.attempts+1
  from claimable c where a.alert_id=c.alert_id returning a.*;
end;
$$;

update public.inventory_alert_outbox a set delivery_status='suppressed',last_error='Suppressed because material is already ordered'
from public.inventory_items i where i.item_id=a.item_id and i.ordered and a.delivery_status in ('pending','failed');

revoke all on function public.get_app_access(),public.is_operations_admin(),public.has_employee_access(),public.inventory_item_access(bigint,text),public.set_inventory_count(bigint,bigint,integer),public.mark_inventory_ordered(bigint,bigint),public.claim_inventory_alerts(bigint,integer) from public,anon;
grant execute on function public.get_app_access(),public.is_operations_admin(),public.has_employee_access(),public.inventory_item_access(bigint,text),public.set_inventory_count(bigint,bigint,integer),public.mark_inventory_ordered(bigint,bigint) to authenticated;
grant execute on function public.claim_inventory_alerts(bigint,integer) to service_role;

commit;
