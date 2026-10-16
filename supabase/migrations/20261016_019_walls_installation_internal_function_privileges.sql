-- Keep internal trigger and synchronization functions out of the client RPC surface.
-- Their triggers execute under PostgreSQL's trigger machinery; clients use only
-- the explicitly granted installation UI functions.
-- Prepared by Scout for Wes Borgen

begin;

revoke all on function public.flag_walls_installation_schedule_change() from public,anon,authenticated;
revoke all on function public.enforce_walls_delivery_qc_release() from public,anon,authenticated;
revoke all on function public.weekly_planner_source_fingerprint(date) from public,anon,authenticated;
revoke all on function public.sync_walls_installation_week(date) from public,anon,authenticated;
revoke all on function public.mark_walls_installation_planner_stale() from public,anon,authenticated;
revoke all on function public.mark_walls_installation_resource_planner_stale() from public,anon,authenticated;
revoke all on function public.mark_walls_installation_related_planner_stale() from public,anon,authenticated;
revoke all on function public.sync_walls_installation_after_planner_generation() from public,anon,authenticated;
revoke all on function public.sync_walls_installation_after_planner_audit() from public,anon,authenticated;

commit;

