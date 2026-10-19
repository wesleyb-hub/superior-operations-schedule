-- Keep schedule API entry points available to signed-in clients while removing
-- accidental anonymous/PUBLIC execution from privileged SECURITY DEFINER routines.
revoke execute on function public.can_access_schedule() from public, anon;
revoke execute on function public.can_edit_schedule() from public, anon;
grant execute on function public.can_access_schedule() to authenticated;
grant execute on function public.can_edit_schedule() to authenticated;

revoke execute on function public.get_schedule_snapshot() from public, anon;
revoke execute on function public.save_schedule_snapshot(bigint,jsonb,text) from public, anon;
revoke execute on function public.list_schedule_backups() from public, anon;
revoke execute on function public.restore_schedule_revision(bigint,bigint) from public, anon;
grant execute on function public.get_schedule_snapshot() to authenticated;
grant execute on function public.save_schedule_snapshot(bigint,jsonb,text) to authenticated;
grant execute on function public.list_schedule_backups() to authenticated;
grant execute on function public.restore_schedule_revision(bigint,bigint) to authenticated;

-- These functions are only invoked by existing triggers, never by the browser.
-- Trigger execution uses the function owner and does not require caller EXECUTE.
revoke all on function public.flag_walls_production_schedule_change() from public, anon, authenticated;
revoke all on function public.inventory_prepare_alert() from public, anon, authenticated;
revoke all on function public.validate_walls_production_assignment() from public, anon, authenticated;

-- Internal LF helper is used by the protected production snapshot and assignment
-- trigger; exposing its SECURITY DEFINER RPC would let any signed-in user query
-- arbitrary job IDs outside the app's normal access path.
revoke all on function public.walls_job_total_lf(text) from public, anon, authenticated;

-- Inventory alert claiming is performed only by the Edge Function's service-role client.
-- Keep that grant explicit and remove the inherited authenticated RPC grant.
revoke all on function public.claim_inventory_alerts(bigint,integer) from public, anon, authenticated;
grant execute on function public.claim_inventory_alerts(bigint,integer) to service_role;

