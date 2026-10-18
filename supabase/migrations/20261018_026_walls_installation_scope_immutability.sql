-- Once an activity starts or is put on hold, retain its run scope and audit trail.
create or replace function public.guard_walls_installation_scope_immutability()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_activity_id uuid;v_status text;
begin
  v_activity_id:=case when tg_op='DELETE' then old.activity_id else new.activity_id end;
  select status into v_status from public.walls_installation_activities where activity_id=v_activity_id for update;
  if v_status is null then raise exception 'Installation activity not found for production scope'; end if;
  if v_status<>'planned' then raise exception 'Production run scope is locked after an activity starts or is put on hold; add a follow-up activity for additional runs'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists walls_installation_scope_locked on public.walls_installation_activity_assignments;
create trigger walls_installation_scope_locked before insert or update or delete on public.walls_installation_activity_assignments
  for each row execute function public.guard_walls_installation_scope_immutability();

create or replace function public.guard_walls_installation_started_status()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.status in ('in_progress','on_hold') and new.status='planned' then
    raise exception 'Started or held field work cannot return to Planned; resume it as In Progress or create follow-up work';
  end if;
  return new;
end;
$$;
drop trigger if exists walls_installation_started_status_guard on public.walls_installation_activities;
create trigger walls_installation_started_status_guard before update of status on public.walls_installation_activities
  for each row execute function public.guard_walls_installation_started_status();
revoke all on function public.guard_walls_installation_scope_immutability(),public.guard_walls_installation_started_status() from public,anon,authenticated;
