-- Superior Walls Production inventory pilot.
-- Isolated from schedule_state and the structured operations schedule tables.
-- Prepared by Scout for Wes Borgen

begin;

create table if not exists public.inventory_user_access (
  email text primary key check (email = lower(email)),
  can_view boolean not null default true,
  can_adjust boolean not null default false,
  can_manage boolean not null default false,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

create table if not exists public.inventory_items (
  item_id bigint generated always as identity primary key,
  legal_entity text not null default 'Superior Walls of North Dakota, LLC'
    check (legal_entity = 'Superior Walls of North Dakota, LLC'),
  division_key text not null default 'walls' check (division_key = 'walls'),
  inventory_area text not null default 'production' check (inventory_area = 'production'),
  titan_code text not null,
  description text not null,
  category text not null check (category in ('RM Misc. SW','RM Rebar')),
  unit text not null default 'units' check (unit in ('units','boxes','bags','rolls','bundles','pallets','pieces','boards','lengths','sticks')),
  quantity integer check (quantity is null or quantity >= 0),
  reorder_threshold integer check (reorder_threshold is null or reorder_threshold >= 0),
  ordered boolean not null default false,
  ordered_at timestamptz,
  ordered_by text,
  reorder_alert_open boolean not null default false,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration',
  unique (division_key,inventory_area,titan_code)
);

create index if not exists inventory_items_status_idx
  on public.inventory_items (division_key,inventory_area,quantity,reorder_threshold);

create table if not exists public.inventory_events (
  event_id bigint generated always as identity primary key,
  item_id bigint not null references public.inventory_items(item_id),
  event_type text not null check (event_type in ('adjusted','corrected','threshold_updated','marked_ordered','received')),
  quantity_before integer,
  quantity_after integer,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  actor_email text not null
);

create table if not exists public.inventory_alert_outbox (
  alert_id bigint generated always as identity primary key,
  item_id bigint not null references public.inventory_items(item_id),
  event_type text not null default 'reorder_crossing' check (event_type = 'reorder_crossing'),
  payload jsonb not null,
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text
);

create index if not exists inventory_alert_outbox_pending_idx
  on public.inventory_alert_outbox (created_at) where delivery_status='pending';

create or replace function public.inventory_access(p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select case p_permission
    when 'manage' then public.can_edit_schedule()
    when 'adjust' then public.can_edit_schedule()
    else public.can_access_schedule()
  end or exists (
    select 1 from public.inventory_user_access a
    where a.email=lower(coalesce(auth.jwt()->>'email','')) and a.enabled
      and case p_permission when 'manage' then a.can_manage when 'adjust' then (a.can_adjust or a.can_manage) else (a.can_view or a.can_adjust or a.can_manage) end
  );
$$;

create or replace function public.get_inventory_access()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('can_view',public.inventory_access('view'),'can_adjust',public.inventory_access('adjust'),'can_manage',public.inventory_access('manage'));
$$;

alter table public.inventory_user_access enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_events enable row level security;
alter table public.inventory_alert_outbox enable row level security;

drop policy if exists "Inventory users can view materials" on public.inventory_items;
create policy "Inventory users can view materials" on public.inventory_items for select to authenticated using (public.inventory_access('view'));
drop policy if exists "Inventory managers can view access" on public.inventory_user_access;
create policy "Inventory managers can view access" on public.inventory_user_access for select to authenticated using (public.inventory_access('manage'));
drop policy if exists "Inventory managers can view events" on public.inventory_events;
create policy "Inventory managers can view events" on public.inventory_events for select to authenticated using (public.inventory_access('manage'));
drop policy if exists "Inventory managers can view alerts" on public.inventory_alert_outbox;
create policy "Inventory managers can view alerts" on public.inventory_alert_outbox for select to authenticated using (public.inventory_access('manage'));

revoke all on public.inventory_user_access,public.inventory_items,public.inventory_events,public.inventory_alert_outbox from anon;
revoke insert,update,delete on public.inventory_user_access,public.inventory_items,public.inventory_events,public.inventory_alert_outbox from authenticated;
grant select on public.inventory_items,public.inventory_user_access,public.inventory_events,public.inventory_alert_outbox to authenticated;

create or replace function public.inventory_prepare_alert()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_was_low boolean:=coalesce(old.quantity is not null and old.reorder_threshold is not null and old.quantity<=old.reorder_threshold,false);
v_is_low boolean:=new.quantity is not null and new.reorder_threshold is not null and new.quantity<=new.reorder_threshold;
begin
  if v_is_low and not v_was_low and not old.reorder_alert_open then
    new.reorder_alert_open:=true;
    insert into public.inventory_alert_outbox(item_id,payload) values(new.item_id,jsonb_build_object(
      'item_id',new.item_id,'titan_code',new.titan_code,'description',new.description,'category',new.category,
      'quantity',new.quantity,'reorder_threshold',new.reorder_threshold,'unit',new.unit,'updated_by',new.updated_by
    ));
  elsif not v_is_low then
    new.reorder_alert_open:=false;
  end if;
  new.updated_at:=now();new.version:=old.version+1;
  return new;
end;
$$;

drop trigger if exists inventory_prepare_alert_trigger on public.inventory_items;
create trigger inventory_prepare_alert_trigger before update of quantity,reorder_threshold on public.inventory_items
for each row execute function public.inventory_prepare_alert();

create or replace function public.adjust_inventory_quantity(p_item_id bigint,p_delta integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before integer;v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_access('adjust') then raise exception 'Inventory adjustment access required'; end if;
  if p_delta not in (-1,1) then raise exception 'Adjustment must be -1 or 1'; end if;
  select quantity into v_before from public.inventory_items where item_id=p_item_id for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if v_before is null then raise exception 'Set an initial count first'; end if;
  update public.inventory_items set quantity=greatest(0,v_before+p_delta),ordered=case when greatest(0,v_before+p_delta)>coalesce(reorder_threshold,-1) then false else ordered end,updated_by=v_actor where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email) values(p_item_id,'adjusted',v_before,v_item.quantity,jsonb_build_object('delta',p_delta),v_actor);
  return to_jsonb(v_item);
end;
$$;

create or replace function public.set_inventory_item(p_item_id bigint,p_expected_version bigint,p_quantity integer,p_reorder_threshold integer,p_unit text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.inventory_items%rowtype;v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_access('manage') then raise exception 'Inventory management access required'; end if;
  if p_quantity is not null and p_quantity<0 then raise exception 'Quantity cannot be negative'; end if;
  if p_reorder_threshold is not null and p_reorder_threshold<0 then raise exception 'Reorder threshold cannot be negative'; end if;
  if p_unit not in ('units','boxes','bags','rolls','bundles','pallets','pieces','boards','lengths','sticks') then raise exception 'Unsupported inventory unit'; end if;
  select * into v_old from public.inventory_items where item_id=p_item_id for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if v_old.version<>p_expected_version then raise exception 'Inventory version conflict'; end if;
  update public.inventory_items set quantity=p_quantity,reorder_threshold=p_reorder_threshold,unit=p_unit,ordered=case when p_quantity is not null and p_reorder_threshold is not null and p_quantity>p_reorder_threshold then false else ordered end,updated_by=v_actor where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email) values(p_item_id,'corrected',v_old.quantity,v_item.quantity,jsonb_build_object('threshold_before',v_old.reorder_threshold,'threshold_after',v_item.reorder_threshold,'unit_before',v_old.unit,'unit_after',v_item.unit),v_actor);
  return to_jsonb(v_item);
end;
$$;

create or replace function public.mark_inventory_ordered(p_item_id bigint,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_access('manage') then raise exception 'Inventory management access required'; end if;
  update public.inventory_items set ordered=true,ordered_at=now(),ordered_by=v_actor,updated_at=now(),updated_by=v_actor,version=version+1 where item_id=p_item_id and version=p_expected_version returning * into v_item;
  if not found then raise exception 'Inventory item missing or version conflict'; end if;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,actor_email) values(p_item_id,'marked_ordered',v_item.quantity,v_item.quantity,v_actor);
  return to_jsonb(v_item);
end;
$$;

create or replace function public.receive_inventory_stock(p_item_id bigint,p_expected_version bigint,p_quantity integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before integer;v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_access('adjust') then raise exception 'Inventory adjustment access required'; end if;
  if p_quantity is null or p_quantity<1 then raise exception 'Received quantity must be a positive whole number'; end if;
  select quantity into v_before from public.inventory_items where item_id=p_item_id and version=p_expected_version for update;
  if not found then raise exception 'Inventory item missing or version conflict'; end if;
  update public.inventory_items set quantity=coalesce(v_before,0)+p_quantity,ordered=false,ordered_at=null,ordered_by=null,updated_by=v_actor where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email) values(p_item_id,'received',v_before,v_item.quantity,jsonb_build_object('received',p_quantity),v_actor);
  return to_jsonb(v_item);
end;
$$;

revoke all on function public.inventory_access(text),public.get_inventory_access(),public.adjust_inventory_quantity(bigint,integer),public.set_inventory_item(bigint,bigint,integer,integer,text),public.mark_inventory_ordered(bigint,bigint),public.receive_inventory_stock(bigint,bigint,integer) from public,anon;
grant execute on function public.inventory_access(text) to authenticated;
grant execute on function public.get_inventory_access() to authenticated;
grant execute on function public.adjust_inventory_quantity(bigint,integer),public.set_inventory_item(bigint,bigint,integer,integer,text),public.mark_inventory_ordered(bigint,bigint),public.receive_inventory_stock(bigint,bigint,integer) to authenticated;

insert into public.inventory_items(titan_code,description,category) values
('1TonLiftPin','ALP Lift Pin 1Ton','RM Misc. SW'),
('2x10x10gt','2x10x10 green treated','RM Misc. SW'),
('2x6x12gt','2x6x12 green treat board','RM Misc. SW'),
('5/8REWH','#3/#4 5/8 Rebar Wheels','RM Misc. SW'),
('6inSTCL','6 inch Straight Coil loop','RM Misc. SW'),
('6x6x8 Dunnage','6x6x8 Dunnage','RM Misc. SW'),
('9GSF','9 foot galvanized stud facing','RM Misc. SW'),
('BSP','Bolting Saddle Plus','RM Misc. SW'),
('BSP Angled','Bolting Saddle Angled','RM Misc. SW'),
('BSP Straight','Bolting Saddle Straight','RM Misc. SW'),
('CL1/2x13/4','1/2x1-3/4 Coil Loop','RM Misc. SW'),
('CL5/8x13/4','5/8 x1-3/4 Coil Loop','RM Misc. SW'),
('facebarwire154a','Face bar support wire part number 141','RM Misc. SW'),
('FLCOIL1/2','Flared Loop Ferrule 1/2','RM Misc. SW'),
('Manhole Steps 12 inch','Manhole steps 12"','RM Misc. SW'),
('PISW','Push-In Spreader Wire','RM Misc. SW'),
('SpReW','Spreader Rebar Support Wire','RM Misc. SW'),
('TL2x6x12','Treated Lumber 2x6x12','RM Misc. SW'),
('TrReF','Triple Rebar Face Wire','RM Misc. SW'),
('24inch4bar','24 inch #4 bar','RM Rebar'),
('3ft11#4bar','3 foot 11 inch numer 4 rebar','RM Rebar'),
('4ft11#4bar','4 foot 11 inch #4 rebar','RM Rebar'),
('8ft11 4 bar','8 ft 11 inch number 4 bar','RM Rebar'),
('9ft11 4 bar','9ft 11 4bar studs','RM Rebar'),
('Header Stirrups','Header Stirrups','RM Rebar'),
('RE3','Rebar #3','RM Rebar'),
('RE4','Rebar #4','RM Rebar'),
('RE5','Rebar #5','RM Rebar'),
('RE6','Rebar #6','RM Rebar'),
('RESW','Rebar Support Wire','RM Rebar')
on conflict (division_key,inventory_area,titan_code) do update set description=excluded.description,category=excluded.category;

do $$ begin alter publication supabase_realtime add table public.inventory_items; exception when duplicate_object then null; end $$;

commit;
