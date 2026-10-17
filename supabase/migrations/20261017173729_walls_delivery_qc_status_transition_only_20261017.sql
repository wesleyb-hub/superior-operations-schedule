-- Keep Superior Walls final-QC validation on actual load-status transitions only.
-- Link/date edits during Hub schedule saves must not revalidate historical deliveries.
-- No operational rows are modified by this migration.
create or replace function public.enforce_walls_delivery_qc_release()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_old_status text;
  v_new_status text;
  v_assignment_count integer;
  v_released_count integer;
  v_open_issues integer;
  v_link_id text;
  v_has_mapping boolean;
begin
  if coalesce(new.division,new.data->>'division')<>'walls'
     or new.data->>'linkType'<>'wall' then
    return new;
  end if;

  v_link_id:=new.data->>'linkId';
  v_new_status:=coalesce(new.data->>'status','');
  if tg_op='UPDATE' then
    v_old_status:=coalesce(old.data->>'status','');
  end if;

  -- Validate only a new load already marked Loaded/Delivered or a real transition
  -- into either status. Changes to delivery dates or wall links do not release loads.
  if v_new_status in ('Loaded','Delivered')
     and (tg_op='INSERT' or v_old_status is distinct from v_new_status) then
    select exists(
      select 1 from public.walls_installation_load_assignments m
      where m.load_record_id=new.record_id
    ) into v_has_mapping;

    if v_has_mapping then
      select count(*),
             count(*) filter(where a.stage='stripped' and q.status='released')
      into v_assignment_count,v_released_count
      from public.walls_installation_load_assignments m
      join public.walls_production_assignments a on a.assignment_id=m.assignment_id
      left join public.walls_installation_qc_releases q on q.assignment_id=a.assignment_id
      where m.load_record_id=new.record_id;
    else
      select count(*),
             count(*) filter(where a.stage='stripped' and q.status='released')
      into v_assignment_count,v_released_count
      from public.walls_production_assignments a
      left join public.walls_installation_qc_releases q on q.assignment_id=a.assignment_id
      where a.wall_record_id=v_link_id and a.stage<>'cancelled';
    end if;

    select count(*) into v_open_issues
    from public.walls_production_issues i
    where i.wall_record_id=v_link_id and i.status='open';

    if v_assignment_count=0
       or v_assignment_count<>v_released_count
       or v_open_issues>0 then
      raise exception 'Linked Superior Walls delivery requires every production assignment stripped and finally QC released, with no open production hold';
    end if;
  end if;

  return new;
end;
$$;
