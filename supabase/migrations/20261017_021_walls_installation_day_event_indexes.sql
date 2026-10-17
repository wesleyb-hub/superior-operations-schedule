-- Index audit-table foreign keys for deletion checks and history lookups.
-- Prepared by Scout for Wes Borgen

begin;

create index if not exists walls_installation_day_events_card_idx
  on public.walls_installation_day_events(card_id,occurred_at desc);
create index if not exists walls_installation_day_events_task_idx
  on public.walls_installation_day_events(task_id,occurred_at desc)
  where task_id is not null;
create index if not exists walls_installation_day_events_actor_idx
  on public.walls_installation_day_events(actor_user_id,occurred_at desc)
  where actor_user_id is not null;

commit;

