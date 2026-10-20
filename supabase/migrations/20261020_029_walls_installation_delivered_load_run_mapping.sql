-- Permit a one-time, audited production-run mapping on a Delivered Superior Walls load.
-- The shipment status stays immutable; only exact stripped and final-QC-released runs can be recorded.
-- Prepared by Scout for Wes Borgen

create or replace function public.link_walls_installation_load_assignments(p_load_record_id text, p_assignment_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_wall_id text;
  v_count integer;
  v_existing_count integer;
  v_load_status text;
  v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
  v_old_assignments jsonb;
begin
  if not public.walls_installation_permission('manage') then raise exception 'Superior Walls Installation management access required'; end if;
  select l.data->>'linkId',coalesce(l.data->>'status','') into v_wall_id,v_load_status
    from public.schedule_records l where l.collection='loads' and l.record_id=p_load_record_id
      and l.division='walls' and l.data->>'linkType'='wall' for update;
  if v_wall_id is null then raise exception 'Select an existing Delivery load linked to a Superior Walls job'; end if;
  p_assignment_ids:=coalesce(p_assignment_ids,'{}'::uuid[]);
  select count(*) into v_existing_count from public.walls_installation_load_assignments where load_record_id=p_load_record_id;
  if v_load_status='Loaded' then
    raise exception 'Production-run mapping is locked once a load is marked Loaded';
  elsif v_load_status='Delivered' then
    if v_existing_count>0 then raise exception 'This Delivered load already has an audited run list and cannot be changed'; end if;
    if cardinality(p_assignment_ids)=0 then raise exception 'Select the exact runs included in this Delivered shipment'; end if;
  end if;
  select count(distinct a.assignment_id) into v_count from public.walls_production_assignments a
   where a.assignment_id=any(p_assignment_ids) and a.wall_record_id=v_wall_id and a.stage<>'cancelled';
  if v_count<>cardinality(p_assignment_ids) then raise exception 'Every selected production assignment must belong to the linked master job'; end if;
  if v_load_status='Delivered' and exists(
    select 1 from unnest(p_assignment_ids) selected(assignment_id)
    left join public.walls_production_assignments a on a.assignment_id=selected.assignment_id
    left join public.walls_installation_qc_releases q on q.assignment_id=a.assignment_id
    where a.assignment_id is null or a.stage<>'stripped' or q.status is distinct from 'released'
      or exists(select 1 from public.walls_production_issues i where i.wall_record_id=v_wall_id and i.status='open'
        and (i.assignment_id=a.assignment_id or i.assignment_id is null))
  ) then raise exception 'A Delivered load can only be linked to this job’s stripped, finally QC-released runs with no open production hold'; end if;
  if v_load_status='Delivered' and exists(
    select 1 from unnest(p_assignment_ids) selected(assignment_id)
    join public.walls_installation_load_assignments existing on existing.assignment_id=selected.assignment_id
    join public.schedule_records other_load on other_load.collection='loads' and other_load.record_id=existing.load_record_id
      and coalesce(other_load.data->>'status','')='Delivered' where existing.load_record_id<>p_load_record_id
  ) then raise exception 'A production run is already recorded on another Delivered load'; end if;
  insert into public.walls_installation_jobs(wall_record_id,created_by,updated_by) values(v_wall_id,v_actor,v_actor) on conflict(wall_record_id) do nothing;
  select coalesce(jsonb_agg(assignment_id order by assignment_id),'[]'::jsonb) into v_old_assignments
    from public.walls_installation_load_assignments where load_record_id=p_load_record_id;
  delete from public.walls_installation_load_assignments where load_record_id=p_load_record_id;
  insert into public.walls_installation_load_assignments(load_record_id,assignment_id,linked_by_user_id,linked_by_email)
    select p_load_record_id,x,auth.uid(),v_actor from unnest(p_assignment_ids) x;
  insert into public.walls_installation_events(wall_record_id,event_type,detail,actor_user_id,actor_email)
    values(v_wall_id,'delivery_load_assignments_linked',jsonb_build_object('load_record_id',p_load_record_id,'before',v_old_assignments,
      'after',to_jsonb(p_assignment_ids),'delivery_status',v_load_status,'initial_delivered_mapping',v_load_status='Delivered'),auth.uid(),v_actor);
  return jsonb_build_object('ok',true,'load_record_id',p_load_record_id,'assignment_ids',to_jsonb(p_assignment_ids));
end;
$function$;