-- Serialize production-batch mapping edits with delivery status transitions.
-- Without the load-row lock, a mapping edit could read Scheduled while a concurrent
-- transaction changes the same load to Loaded/Delivered and validates the old map.
-- Locking the schedule row makes the operations serialize: mapping edits either
-- commit first and are checked by the delivery gate, or observe the shipped state
-- and are rejected. No load or production record is rewritten by this migration.
create or replace function public.link_walls_installation_load_assignments(
  p_load_record_id text,
  p_assignment_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_wall_id text;
  v_count integer;
  v_load_status text;
  v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
  v_old_assignments jsonb;
begin
  if not public.walls_installation_permission('manage') then
    raise exception 'Superior Walls Installation management access required';
  end if;

  select l.data->>'linkId',coalesce(l.data->>'status','')
    into v_wall_id,v_load_status
  from public.schedule_records l
  where l.collection='loads' and l.record_id=p_load_record_id
    and l.division='walls' and l.data->>'linkType'='wall'
  for update;

  if v_wall_id is null then
    raise exception 'Select an existing Delivery load linked to a Superior Walls job';
  end if;
  if v_load_status in ('Loaded','Delivered') then
    raise exception 'Production-batch mapping cannot be changed after a delivery load has shipped';
  end if;

  p_assignment_ids:=coalesce(p_assignment_ids,'{}'::uuid[]);
  select count(distinct a.assignment_id) into v_count
  from public.walls_production_assignments a
  where a.assignment_id=any(p_assignment_ids)
    and a.wall_record_id=v_wall_id and a.stage<>'cancelled';
  if v_count<>cardinality(p_assignment_ids) then
    raise exception 'Every selected production assignment must belong to the linked master job';
  end if;

  insert into public.walls_installation_jobs(wall_record_id,created_by,updated_by)
    values(v_wall_id,v_actor,v_actor) on conflict(wall_record_id) do nothing;
  select coalesce(jsonb_agg(assignment_id order by assignment_id),'[]'::jsonb)
    into v_old_assignments
  from public.walls_installation_load_assignments where load_record_id=p_load_record_id;
  delete from public.walls_installation_load_assignments where load_record_id=p_load_record_id;
  insert into public.walls_installation_load_assignments(load_record_id,assignment_id,linked_by_user_id,linked_by_email)
    select p_load_record_id,x,auth.uid(),v_actor from unnest(p_assignment_ids) x;
  insert into public.walls_installation_events(wall_record_id,event_type,detail,actor_user_id,actor_email)
    values(v_wall_id,'delivery_load_assignments_linked',
      jsonb_build_object('load_record_id',p_load_record_id,'before',v_old_assignments,'after',to_jsonb(p_assignment_ids)),
      auth.uid(),v_actor);
  return jsonb_build_object('ok',true,'load_record_id',p_load_record_id,'assignment_ids',to_jsonb(p_assignment_ids));
end;
$$;

-- CREATE OR REPLACE retains the function's established execute grants. Repeat the
-- explicit boundary here so the shipment-mapping RPC cannot become public/anonymous.
revoke all on function public.link_walls_installation_load_assignments(text,uuid[]) from public,anon;
grant execute on function public.link_walls_installation_load_assignments(text,uuid[]) to authenticated;

