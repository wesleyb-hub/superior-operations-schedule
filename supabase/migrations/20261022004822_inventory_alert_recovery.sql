begin;

-- No existing alert is rewritten by this migration. Quiesce the old worker
-- before applying; deploy the new worker before resuming authenticated sweeps.
alter table public.inventory_alert_outbox add column if not exists delivery_protocol integer;
alter table public.inventory_alert_outbox add column if not exists delivery_request jsonb;
alter table public.inventory_alert_outbox add column if not exists delivery_started_at timestamptz;
create index if not exists inventory_alert_retry_due_idx
  on public.inventory_alert_outbox(next_attempt_at) where delivery_status in ('pending','failed');
create index if not exists inventory_alert_stale_claim_idx
  on public.inventory_alert_outbox(claimed_at) where delivery_status='sending';

create or replace function public.claim_inventory_alerts(p_alert_id bigint default null,p_limit integer default 10)
returns setof public.inventory_alert_outbox language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;

  -- Gateway deduplication is unverified. Never replay an attempted legacy
  -- row: its outcome must be reconciled from existing provider records.
  -- Terminal rows stay visible as failed; infinity means no automatic resend.
  update public.inventory_alert_outbox a
    set delivery_status='failed',next_attempt_at='infinity'::timestamptz,
        last_error=concat_ws(' | ',nullif(a.last_error,''),'Manual review required: legacy delivery outcome unconfirmed; not automatically resent')
    where (p_alert_id is null or a.alert_id=p_alert_id)
      and a.delivery_protocol is distinct from 1 and a.attempts>0
      and (a.delivery_status='sending' or (a.delivery_status in ('pending','failed') and a.next_attempt_at<>'infinity'::timestamptz));

  -- Do not reclaim an active owner. Expired/attempt-exhausted claims are made
  -- terminal instead of remaining sending forever or risking duplicate email.
  update public.inventory_alert_outbox a
    set delivery_status='failed',next_attempt_at='infinity'::timestamptz,
        last_error=concat_ws(' | ',nullif(a.last_error,''),'Manual review required: dispatch outcome unconfirmed or retry limit exhausted')
    where (p_alert_id is null or a.alert_id=p_alert_id)
      and (a.attempts>=6 or a.delivery_started_at is not null)
      and ((a.delivery_status in ('pending','failed') and a.next_attempt_at<>'infinity'::timestamptz)
        or (a.delivery_status='sending' and (a.claimed_at is null or a.claimed_at<=now()-interval '5 minutes')));

  update public.inventory_alert_outbox a
    set delivery_status='suppressed',last_error=concat_ws(' | ',nullif(a.last_error,''),'Suppressed because material is already ordered')
    from public.inventory_items i
    where i.item_id=a.item_id and i.ordered and (p_alert_id is null or a.alert_id=p_alert_id)
      and ((a.delivery_status in ('pending','failed') and a.next_attempt_at<>'infinity'::timestamptz)
        or (a.delivery_status='sending' and (a.claimed_at is null or a.claimed_at<=now()-interval '5 minutes')));

  return query
  with claimable as (
    select a.alert_id from public.inventory_alert_outbox a
    where (p_alert_id is null or a.alert_id=p_alert_id)
      and ((a.delivery_status in ('pending','failed') and a.next_attempt_at<=now())
        or (a.delivery_status='sending' and (a.claimed_at is null or a.claimed_at<=now()-interval '5 minutes')))
      and a.attempts<6
      and a.delivery_started_at is null
    order by a.created_at,a.alert_id
    for update skip locked limit greatest(1,least(coalesce(p_limit,10),25))
  )
  update public.inventory_alert_outbox a
    set delivery_status='sending',claimed_at=now(),attempts=a.attempts+1,
        delivery_protocol=1
    from claimable c where a.alert_id=c.alert_id returning a.*;
end;
$$;

-- Preserve the existing service-role-only RPC policy; no new access grants.
revoke all on function public.claim_inventory_alerts(bigint,integer) from public,anon,authenticated;
grant execute on function public.claim_inventory_alerts(bigint,integer) to service_role;

-- Preserve quarantine visibility/history when an inventory manager marks an
-- item ordered. This replacement keeps the existing access gate, search path,
-- SECURITY DEFINER setting and ACL; only alert suppression is narrowed.
create or replace function public.mark_inventory_ordered(p_item_id bigint,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_item_access(p_item_id,'manage') then raise exception 'Inventory management access required'; end if;
  update public.inventory_items set ordered=true,ordered_at=now(),ordered_by=v_actor,updated_at=now(),updated_by=v_actor,version=version+1
    where item_id=p_item_id and version=p_expected_version returning * into v_item;
  if not found then raise exception 'Inventory item missing or version conflict'; end if;
  update public.inventory_alert_outbox set delivery_status='suppressed',last_error=concat_ws(' | ',nullif(last_error,''),'Suppressed because material was marked ordered')
    where item_id=p_item_id and delivery_status in ('pending','failed')
      and next_attempt_at<>'infinity'::timestamptz;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,actor_email)
  values(p_item_id,'marked_ordered',v_item.quantity,v_item.quantity,v_actor);
  return to_jsonb(v_item);
end;
$$;

commit;
