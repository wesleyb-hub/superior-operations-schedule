-- Centralized, scope-aware inventory for Superior Operations.
-- Preserves every existing Walls Production row, event and alert; adds no materials.
-- Prepared by Scout for Wes Borgen

begin;

-- Keep the legacy email access table usable while making every grant scope-specific.
alter table public.inventory_user_access add column if not exists division_key text not null default 'walls';
alter table public.inventory_user_access add column if not exists inventory_area text not null default 'production';
alter table public.inventory_user_access drop constraint if exists inventory_user_access_pkey;
alter table public.inventory_user_access drop constraint if exists inventory_user_access_scope_check;
alter table public.inventory_user_access add constraint inventory_user_access_scope_check check (
  (division_key='walls' and inventory_area in ('production','install')) or
  (division_key='boxes' and inventory_area='production')
);
alter table public.inventory_user_access add constraint inventory_user_access_pkey primary key (email,division_key,inventory_area);

-- Allow one employee to receive future inventory grants without changing their app identity.
alter table public.app_employee_access add column if not exists inventory_can_view boolean not null default true;
alter table public.app_employee_access add column if not exists inventory_can_adjust boolean not null default false;
alter table public.app_employee_access add column if not exists inventory_can_manage boolean not null default false;
update public.app_employee_access
set inventory_can_adjust=true
where profile_key='walls_inventory_counter' and not inventory_can_adjust;

alter table public.app_employee_access drop constraint if exists app_employee_access_pkey;
alter table public.app_employee_access drop constraint if exists app_employee_access_division_key_check;
alter table public.app_employee_access drop constraint if exists app_employee_access_inventory_area_check;
alter table public.app_employee_access drop constraint if exists app_employee_access_legal_entity_check;
alter table public.app_employee_access add constraint app_employee_access_scope_check check (
  (division_key='walls' and inventory_area in ('production','install')) or
  (division_key='boxes' and inventory_area='production')
);
alter table public.app_employee_access add constraint app_employee_access_legal_entity_check check (
  (division_key='walls' and legal_entity='Superior Walls of North Dakota, LLC') or
  (division_key='boxes' and legal_entity='Superior Precast Structures, LLC')
);
alter table public.app_employee_access add constraint app_employee_access_pkey primary key (user_id,division_key,inventory_area);

-- Categories remain controlled data, but can now be added per division and area.
create table if not exists public.inventory_categories (
  division_key text not null,
  inventory_area text not null,
  category text not null check (length(btrim(category)) between 1 and 120),
  legal_entity text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text not null default 'migration',
  primary key (division_key,inventory_area,category),
  constraint inventory_categories_scope_check check (
    (division_key='walls' and inventory_area in ('production','install')) or
    (division_key='boxes' and inventory_area='production')
  ),
  constraint inventory_categories_entity_check check (
    (division_key='walls' and legal_entity='Superior Walls of North Dakota, LLC') or
    (division_key='boxes' and legal_entity='Superior Precast Structures, LLC')
  )
);

insert into public.inventory_categories(division_key,inventory_area,category,legal_entity)
select distinct division_key,inventory_area,category,legal_entity
from public.inventory_items
on conflict (division_key,inventory_area,category) do nothing;

alter table public.inventory_items drop constraint if exists inventory_items_category_check;
alter table public.inventory_items drop constraint if exists inventory_items_division_key_check;
alter table public.inventory_items drop constraint if exists inventory_items_inventory_area_check;
alter table public.inventory_items drop constraint if exists inventory_items_legal_entity_check;
alter table public.inventory_items drop constraint if exists inventory_items_scope_check;
alter table public.inventory_items drop constraint if exists inventory_items_entity_check;
alter table public.inventory_items drop constraint if exists inventory_items_category_fkey;
alter table public.inventory_items add constraint inventory_items_scope_check check (
  (division_key='walls' and inventory_area in ('production','install')) or
  (division_key='boxes' and inventory_area='production')
);
alter table public.inventory_items add constraint inventory_items_entity_check check (
  (division_key='walls' and legal_entity='Superior Walls of North Dakota, LLC') or
  (division_key='boxes' and legal_entity='Superior Precast Structures, LLC')
);
alter table public.inventory_items add constraint inventory_items_category_fkey
  foreign key (division_key,inventory_area,category)
  references public.inventory_categories(division_key,inventory_area,category);

alter table public.inventory_categories enable row level security;
revoke all on public.inventory_categories from anon;
revoke insert,update,delete on public.inventory_categories from authenticated;
grant select on public.inventory_categories to authenticated;

create or replace function public.inventory_scope_access(
  p_division_key text,
  p_inventory_area text,
  p_permission text default 'view'
)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_operations_admin() or exists (
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
  );
$$;

-- Backward-compatible Walls Production access entry points.
create or replace function public.inventory_access(p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.inventory_scope_access('walls','production',p_permission);
$$;

create or replace function public.get_inventory_access()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'division_key','walls','inventory_area','production',
    'can_view',public.inventory_scope_access('walls','production','view'),
    'can_adjust',public.inventory_scope_access('walls','production','adjust'),
    'can_manage',public.inventory_scope_access('walls','production','manage')
  );
$$;

create or replace function public.get_inventory_access(p_division_key text,p_inventory_area text)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'division_key',p_division_key,'inventory_area',p_inventory_area,
    'can_view',public.inventory_scope_access(p_division_key,p_inventory_area,'view'),
    'can_adjust',public.inventory_scope_access(p_division_key,p_inventory_area,'adjust'),
    'can_manage',public.inventory_scope_access(p_division_key,p_inventory_area,'manage')
  );
$$;

create or replace function public.get_inventory_scopes()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with scopes(division_key,inventory_area,label,sort_order) as (values
    ('walls'::text,'production'::text,'Superior Walls Production'::text,1),
    ('walls'::text,'install'::text,'Superior Walls Install'::text,2),
    ('boxes'::text,'production'::text,'Box Culverts'::text,3)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'division_key',division_key,'inventory_area',inventory_area,'label',label,
    'can_view',public.inventory_scope_access(division_key,inventory_area,'view'),
    'can_adjust',public.inventory_scope_access(division_key,inventory_area,'adjust'),
    'can_manage',public.inventory_scope_access(division_key,inventory_area,'manage')
  ) order by sort_order) filter(where public.inventory_scope_access(division_key,inventory_area,'view')),'[]'::jsonb)
  from scopes;
$$;

create or replace function public.inventory_item_access(p_item_id bigint,p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists (
    select 1 from public.inventory_items i
    where i.item_id=p_item_id
      and public.inventory_scope_access(i.division_key,i.inventory_area,p_permission)
  );
$$;

drop policy if exists "Inventory users can view categories" on public.inventory_categories;
create policy "Inventory users can view categories" on public.inventory_categories
for select to authenticated using (public.inventory_scope_access(division_key,inventory_area,'view'));

drop policy if exists "Inventory users can view materials" on public.inventory_items;
create policy "Inventory users can view materials" on public.inventory_items
for select to authenticated using (public.inventory_item_access(item_id,'view'));

drop policy if exists "Inventory managers can view events" on public.inventory_events;
drop policy if exists "Inventory users can view relevant events" on public.inventory_events;
create policy "Inventory users can view relevant events" on public.inventory_events
for select to authenticated using (public.inventory_item_access(item_id,'view'));

drop policy if exists "Inventory managers can view alerts" on public.inventory_alert_outbox;
create policy "Inventory managers can view alerts" on public.inventory_alert_outbox
for select to authenticated using (public.inventory_item_access(item_id,'manage'));

drop policy if exists "Inventory managers can view access" on public.inventory_user_access;
create policy "Inventory managers can view access" on public.inventory_user_access
for select to authenticated using (public.is_operations_admin());

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
  if v_old.version<>p_expected_version then raise exception 'Inventory version conflict'; end if;
  update public.inventory_items set quantity=p_quantity,reorder_threshold=p_reorder_threshold,unit=p_unit,
    ordered=case when p_quantity is not null and p_reorder_threshold is not null and p_quantity>p_reorder_threshold then false else ordered end,
    updated_by=v_actor where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email)
  values(p_item_id,'corrected',v_old.quantity,v_item.quantity,jsonb_build_object('threshold_before',v_old.reorder_threshold,'threshold_after',v_item.reorder_threshold,'unit_before',v_old.unit,'unit_after',v_item.unit),v_actor);
  return to_jsonb(v_item);
end;
$$;

create or replace function public.receive_inventory_stock(p_item_id bigint,p_expected_version bigint,p_quantity integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before integer;v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_item_access(p_item_id,'manage') then raise exception 'Inventory management access required'; end if;
  if p_quantity is null or p_quantity<1 then raise exception 'Received quantity must be a positive whole number'; end if;
  select quantity into v_before from public.inventory_items where item_id=p_item_id and version=p_expected_version for update;
  if not found then raise exception 'Inventory item missing or version conflict'; end if;
  update public.inventory_items set quantity=coalesce(v_before,0)+p_quantity,ordered=false,ordered_at=null,ordered_by=null,updated_by=v_actor
    where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email)
  values(p_item_id,'received',v_before,v_item.quantity,jsonb_build_object('received',p_quantity),v_actor);
  return to_jsonb(v_item);
end;
$$;

create or replace function public.mark_inventory_ordered(p_item_id bigint,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_item_access(p_item_id,'manage') then raise exception 'Inventory management access required'; end if;
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

create or replace function public.inventory_prepare_alert()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_was_low boolean:=coalesce(old.quantity is not null and old.reorder_threshold is not null and old.quantity<=old.reorder_threshold,false);
v_is_low boolean:=new.quantity is not null and new.reorder_threshold is not null and new.quantity<=new.reorder_threshold;
begin
  if v_is_low and not v_was_low and not old.reorder_alert_open then
    new.reorder_alert_open:=true;
    insert into public.inventory_alert_outbox(item_id,payload) values(new.item_id,jsonb_build_object(
      'item_id',new.item_id,'division_key',new.division_key,'inventory_area',new.inventory_area,
      'legal_entity',new.legal_entity,'titan_code',new.titan_code,'description',new.description,'category',new.category,
      'quantity',new.quantity,'reorder_threshold',new.reorder_threshold,'unit',new.unit,'updated_by',new.updated_by
    ));
  elsif not v_is_low then
    new.reorder_alert_open:=false;
  end if;
  new.updated_at:=now();new.version:=old.version+1;
  return new;
end;
$$;

revoke all on function public.inventory_scope_access(text,text,text),public.get_inventory_access(text,text),public.get_inventory_scopes() from public,anon;
grant execute on function public.inventory_scope_access(text,text,text),public.get_inventory_access(text,text),public.get_inventory_scopes() to authenticated;

commit;
