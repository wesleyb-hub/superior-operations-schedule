-- Allow a production table to be stripped/reset and begin the next setup on the same calendar day.
-- Existing assignments and production history are unchanged.
-- Prepared by Scout for Wes Borgen

begin;

alter table public.walls_production_assignments
  drop constraint if exists walls_production_no_table_overlap;

alter table public.walls_production_assignments
  add constraint walls_production_no_table_overlap
  exclude using gist (
    table_id with =,
    daterange(setup_start_at::date,strip_at::date,'[)') with &&
  )
  where (stage <> 'cancelled');

comment on constraint walls_production_no_table_overlap on public.walls_production_assignments is
  'Prevents true production-day overlaps while allowing the next setup to begin on the prior assignment strip/reset date.';

commit;
