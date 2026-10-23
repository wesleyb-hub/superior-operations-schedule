-- Internal conflict recomputation is a write, not a viewer RPC.
-- Existing SECURITY DEFINER generator/save/approval functions retain their
-- own authorization checks and call this helper with their owner's privileges.
-- Do not change its body, function ownership, user access rows, or other ACLs.
revoke execute on function public.rebuild_weekly_planner_conflicts(date)
  from public, anon, authenticated;
