-- Dispatch new Superior Walls Production reorder alerts to the email worker.
-- Historical outbox rows are suppressed separately during production activation.
-- Prepared by Scout for Wes Borgen

begin;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Never deliver setup alerts created before production email activation.
update public.inventory_alert_outbox
set delivery_status = 'suppressed',
    last_error = 'Historical setup alert suppressed during email activation'
where created_at < timestamptz '2026-10-13 13:15:00+00'
  and delivery_status in ('pending', 'failed', 'sending');

create or replace function public.dispatch_inventory_reorder_alert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'inventory_webhook_secret'
  limit 1;

  if coalesce(v_secret, '') = '' then
    raise warning 'inventory_webhook_secret is not configured; alert % remains queued', new.alert_id;
    return new;
  end if;

  select net.http_post(
    url := 'https://qgetoeprpgxkmywjohba.supabase.co/functions/v1/inventory-reorder-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('record', to_jsonb(new)),
    timeout_milliseconds := 10000
  ) into v_request_id;

  return new;
end;
$$;

revoke all on function public.dispatch_inventory_reorder_alert() from public, anon, authenticated;

drop trigger if exists inventory_reorder_email_dispatch_trigger on public.inventory_alert_outbox;
create trigger inventory_reorder_email_dispatch_trigger
after insert on public.inventory_alert_outbox
for each row execute function public.dispatch_inventory_reorder_alert();

-- Retry only unsent current alerts. Activation suppresses all preexisting rows first.
select cron.unschedule(jobid)
from cron.job
where jobname = 'inventory-reorder-email-retry';

select cron.schedule(
  'inventory-reorder-email-retry',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://qgetoeprpgxkmywjohba.supabase.co/functions/v1/inventory-reorder-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'inventory_webhook_secret'
        limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $cron$
);

commit;
