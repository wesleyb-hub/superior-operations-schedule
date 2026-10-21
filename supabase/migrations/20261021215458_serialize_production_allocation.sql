-- Serialize authoritative job-footage allocation across production tables.
-- Definition-only fix; no records, role grants, or permissions are changed.
begin;

create or replace function public.validate_walls_production_assignment()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_total numeric;v_height_total numeric;v_assigned numeric;v_height_assigned numeric;v_capacity numeric;v_job jsonb;
begin
  select data into v_job from public.schedule_records where collection='walls' and record_id=new.wall_record_id;
  if v_job is null then raise exception 'Authoritative Superior Walls job not found'; end if;
  if tg_op='UPDATE' and new.wall_record_id=old.wall_record_id and new.table_id=old.table_id and new.wall_height=old.wall_height and new.planned_lf=old.planned_lf and new.setup_start_at=old.setup_start_at and new.pour_at=old.pour_at and new.strip_at=old.strip_at then
    new.updated_at:=now();new.updated_by:=lower(coalesce(auth.jwt()->>'email','migration'));new.version:=old.version+1;return new;
  end if;
  -- Serialize allocation writers for this target job, without introducing
  -- parent-row lock cycles against full-snapshot schedule saves. Hash collisions
  -- only serialize unrelated jobs; they cannot permit excess allocation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('superior_walls_production_allocation:'||new.wall_record_id,0));
  -- Refresh job fields after any advisory-lock wait. Source edits retain their
  -- existing review semantics; this lock serializes allocation writers only.
  select data into v_job from public.schedule_records where collection='walls' and record_id=new.wall_record_id;
  if v_job is null then raise exception 'Authoritative Superior Walls job not found'; end if;
  v_total:=public.walls_job_total_lf(new.wall_record_id);
  if v_total<=0 then raise exception 'Enter the job linear footage before assigning production tables'; end if;
  select capacity_lf into v_capacity from public.walls_production_tables where table_id=new.table_id and enabled;
  if not found then raise exception 'Production table is not active'; end if;
  if v_capacity is not null and new.planned_lf>v_capacity then raise exception 'Assignment exceeds the configured table capacity'; end if;
  select coalesce(sum(planned_lf),0) into v_assigned from public.walls_production_assignments
    where wall_record_id=new.wall_record_id and stage<>'cancelled' and assignment_id<>coalesce(new.assignment_id,'00000000-0000-0000-0000-000000000000'::uuid);
  if v_assigned+new.planned_lf>v_total then raise exception 'Assignment would exceed the authoritative job linear footage'; end if;
  v_height_total:=coalesce(nullif(v_job#>>array['lfByHeight','h'||trim(to_char(new.wall_height,'FM99'))],'')::numeric,0);
  if v_height_total>0 then
    select coalesce(sum(planned_lf),0) into v_height_assigned from public.walls_production_assignments
      where wall_record_id=new.wall_record_id and wall_height=new.wall_height and stage<>'cancelled' and assignment_id<>coalesce(new.assignment_id,'00000000-0000-0000-0000-000000000000'::uuid);
    if v_height_assigned+new.planned_lf>v_height_total then raise exception 'Assignment would exceed the job footage for this wall height'; end if;
  end if;
  new.schedule_production_date:=case when coalesce(v_job->>'productionDate','')~'^\d{4}-\d{2}-\d{2}$' then (v_job->>'productionDate')::date else null end;
  new.schedule_total_lf:=v_total;
  new.updated_at:=now();new.updated_by:=lower(coalesce(auth.jwt()->>'email','migration'));
  if tg_op='UPDATE' then new.version:=old.version+1; end if;
  return new;
end;
$$;

create or replace function public.upsert_walls_production_assignment(
  p_assignment_id uuid,p_wall_record_id text,p_table_id text,p_wall_height numeric,p_planned_lf numeric,
  p_setup_start_at timestamp,p_pour_at timestamp,p_strip_at timestamp,p_notes text default '',p_expected_version bigint default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_production_assignments%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.walls_production_permission('assign') then raise exception 'Table-assignment permission required'; end if;
  -- Acquire the target-job allocation mutex before an existing assignment row.
  -- Reparenting locks only its target job; no source/target parent-row cycle.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('superior_walls_production_allocation:'||p_wall_record_id,0));
  if p_assignment_id is null then
    insert into public.walls_production_assignments(wall_record_id,table_id,wall_height,planned_lf,setup_start_at,pour_at,strip_at,notes,created_by,updated_by)
    values(p_wall_record_id,p_table_id,p_wall_height,p_planned_lf,p_setup_start_at,p_pour_at,p_strip_at,coalesce(p_notes,''),v_actor,v_actor) returning * into v_row;
    insert into public.walls_production_events(assignment_id,event_type,new_stage,detail,actor_email) values(v_row.assignment_id,'assignment_created','planned',jsonb_build_object('planned_lf',p_planned_lf,'table_id',p_table_id),v_actor);
  else
    select * into v_row from public.walls_production_assignments where assignment_id=p_assignment_id for update;
    if not found then raise exception 'Production assignment not found'; end if;
    if v_row.version<>p_expected_version then raise exception 'Production assignment version conflict'; end if;
    if v_row.stage<>'planned' then raise exception 'Started production must be preserved; only planned assignments can be rescheduled'; end if;
    update public.walls_production_assignments set wall_record_id=p_wall_record_id,table_id=p_table_id,wall_height=p_wall_height,planned_lf=p_planned_lf,
      setup_start_at=p_setup_start_at,pour_at=p_pour_at,strip_at=p_strip_at,notes=coalesce(p_notes,''),needs_review=false,review_reason=''
      where assignment_id=p_assignment_id returning * into v_row;
    insert into public.walls_production_events(assignment_id,event_type,previous_stage,new_stage,detail,actor_email) values(v_row.assignment_id,'assignment_updated','planned','planned',jsonb_build_object('planned_lf',p_planned_lf,'table_id',p_table_id),v_actor);
  end if;
  return to_jsonb(v_row);
end;
$$;

commit;
