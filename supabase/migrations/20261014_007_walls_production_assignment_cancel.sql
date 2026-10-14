-- Superior Walls production assignment correction control.
-- Prepared by Scout for Wes Borgen.
-- A mistaken, unstarted plan is removed from active views by cancellation while its audit trail is retained.

create or replace function public.cancel_walls_production_assignment(
  p_assignment_id uuid,
  p_reason text default 'Entered by mistake'
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_old public.walls_production_assignments%rowtype;
  v_row public.walls_production_assignments%rowtype;
  v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
  v_reason text:=trim(coalesce(p_reason,''));
begin
  if not public.walls_production_permission('assign') then
    raise exception 'Table-assignment permission required';
  end if;
  if length(v_reason)<3 then
    raise exception 'A short cancellation reason is required';
  end if;

  select * into v_old
  from public.walls_production_assignments
  where assignment_id=p_assignment_id
  for update;

  if not found then raise exception 'Production assignment not found'; end if;
  if v_old.stage<>'planned' then
    raise exception 'Started production history cannot be deleted; only planned assignments can be removed';
  end if;
  if exists (
    select 1 from public.walls_production_issues
    where assignment_id=p_assignment_id and status='open'
  ) then
    raise exception 'Resolve the production hold before removing this assignment';
  end if;

  update public.walls_production_assignments
  set stage='cancelled',
      notes=concat_ws(E'\n',nullif(notes,''),'Removed from active production plan: '||v_reason),
      needs_review=false,
      review_reason='',
      version=version+1,
      updated_at=now(),
      updated_by=v_actor
  where assignment_id=p_assignment_id
  returning * into v_row;

  insert into public.walls_production_events(
    assignment_id,event_type,previous_stage,new_stage,detail,actor_email
  ) values (
    p_assignment_id,'assignment_cancelled',v_old.stage,'cancelled',jsonb_build_object('reason',v_reason),v_actor
  );

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.cancel_walls_production_assignment(uuid,text) from public,anon;
grant execute on function public.cancel_walls_production_assignment(uuid,text) to authenticated;

