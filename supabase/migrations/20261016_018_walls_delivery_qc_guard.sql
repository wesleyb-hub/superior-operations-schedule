-- Activate the Superior Walls final-QC guard after the Installation UI is deployed.
-- This affects future load status transitions only; no existing load is rewritten.
-- Prepared by Scout for Wes Borgen

begin;

drop trigger if exists walls_delivery_qc_gate on public.schedule_records;
create trigger walls_delivery_qc_gate
before insert or update of data on public.schedule_records
for each row when (new.collection='loads')
execute function public.enforce_walls_delivery_qc_release();

commit;

