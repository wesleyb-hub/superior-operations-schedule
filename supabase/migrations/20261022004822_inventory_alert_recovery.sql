begin;

-- No existing alert is rewritten by this migration. Quiesce the old worker
-- before applying; deploy the new worker before resuming authenticated sweeps.
alter table public.inventory_alert_outbox add column if not exists delivery_key text;
alter table public.inventory_alert_outbox add column if not exists delivery_request jsonb;
alter table public.inventory_alert_outbox add column if not exists delivery_started_at timestamptz;
create unique index if not exists inventory_alert_delivery_key_idx
  on public.inventory_alert_outbox(delivery_key) where delivery_key is not null;
create index if not exists inventory_alert_retry_due_idx
  on public.inventory_alert_outbox(next_attempt_at) where delivery_status in ('pending','failed');
create index if not exists inventory_alert_stale_claim_idx
  on public.inventory_alert_outbox(claimed_at) where delivery_status='sending';

create or replace function public.claim_inventory_alerts(p_alert_id bigint default null,p_limit integer default 10)
returns setof public.inventory_alert_outbox language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;

  -- The old worker did not send idempotency keys. Never replay an attempted
  -- legacy row: its outcome must be reconciled from existing provider records.
  -- Terminal rows stay visible as failed; infinity means no automatic resend.
  update public.inventory_alert_outbox a
    set delivery_status='failed',next_attempt_at='infinity'::timestamptz,
        last_error=concat_ws(' | ',nullif(a.last_error,''),'Manual review required: legacy delivery outcome unconfirmed; not automatically resent')
    where (p_alert_id is null or a.alert_id=p_alert_id)
      and a.delivery_key is null and a.attempts>0
      and (a.delivery_status='sending' or (a.delivery_status in ('pending','failed') and a.next_attempt_at<>'infinity'::timestamptz));

  -- Do not reclaim an active owner. Expired/attempt-exhausted claims are made
  -- terminal instead of remaining sending forever or exceeding provider TTL.
  update public.inventory_alert_outbox a
    set delivery_status='failed',next_attempt_at='infinity'::timestamptz,
        last_error=concat_ws(' | ',nullif(a.last_error,''),'Manual review required: retry limit or safe idempotency window exhausted')
    where (p_alert_id is null or a.alert_id=p_alert_id)
      and (a.attempts>=6 or a.delivery_started_at<=now()-interval '23 hours')
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
      and (a.delivery_started_at is null or a.delivery_started_at>now()-interval '23 hours')
    order by a.created_at,a.alert_id
    for update skip locked limit greatest(1,least(coalesce(p_limit,10),25))
  )
  update public.inventory_alert_outbox a
    set delivery_status='sending',claimed_at=now(),attempts=a.attempts+1,
        delivery_key=coalesce(a.delivery_key,'inventory-reorder/'||gen_random_uuid()::text)
    from claimable c where a.alert_id=c.alert_id returning a.*;
end;
$$;

-- Preserve the existing service-role-only RPC policy; no new access grants.
revoke all on function public.claim_inventory_alerts(bigint,integer) from public,anon,authenticated;
grant execute on function public.claim_inventory_alerts(bigint,integer) to service_role;

commit;
