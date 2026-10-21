-- Fail closed when production-release evidence is missing or JSON null.
-- Preserve the existing RPC signature, permission checks, stages, events and grants.
create or replace function public.advance_walls_production_stage(p_assignment_id uuid,p_new_stage text,p_setup_progress integer default null,p_actual_lf numeric default null,p_pre_pour_ready boolean default null,p_note text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.walls_production_assignments%rowtype;v_row public.walls_production_assignments%rowtype;v_release text;v_required text;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  select * into v_old from public.walls_production_assignments where assignment_id=p_assignment_id for update;
  if not found then raise exception 'Production assignment not found'; end if;
  v_required:=case when p_new_stage in ('setup_in_progress','setup_complete','ready_for_pour') then 'setup' when p_new_stage in ('poured','curing') then 'pour' when p_new_stage='stripped' then 'strip' else 'plan' end;
  if not public.walls_production_permission(v_required) then raise exception 'Production stage permission required'; end if;
  if not ((v_old.stage='planned' and p_new_stage='setup_in_progress') or (v_old.stage='setup_in_progress' and p_new_stage='setup_complete') or (v_old.stage='setup_complete' and p_new_stage='ready_for_pour') or (v_old.stage='ready_for_pour' and p_new_stage='poured') or (v_old.stage='poured' and p_new_stage='curing') or (v_old.stage='curing' and p_new_stage='stripped')) then raise exception 'Production stages must advance in order'; end if;
  if exists (select 1 from public.walls_production_issues where assignment_id=p_assignment_id and status='open') then raise exception 'Resolve the production hold before advancing this assignment'; end if;
  select data#>>'{planReview,stages,approvedProduction,status}' into v_release from public.schedule_records where collection='walls' and record_id=v_old.wall_record_id;
  if p_new_stage in ('setup_in_progress','setup_complete','ready_for_pour','poured','curing','stripped') and v_release is distinct from 'Complete' then raise exception 'Job is not released for production'; end if;
  if p_new_stage='ready_for_pour' and coalesce(p_pre_pour_ready,false) is not true then raise exception 'Required pre-pour readiness must be recorded'; end if;
  if p_new_stage='poured' and (p_actual_lf is null or p_actual_lf<=0 or p_actual_lf>v_old.planned_lf) then raise exception 'Actual poured LF must be positive and cannot exceed planned LF'; end if;
  update public.walls_production_assignments set stage=p_new_stage,
    setup_progress=case when p_new_stage='setup_in_progress' then greatest(setup_progress,coalesce(p_setup_progress,1)) when p_new_stage in ('setup_complete','ready_for_pour','poured','curing','stripped') then 100 else setup_progress end,
    pre_pour_ready=case when p_new_stage in ('ready_for_pour','poured','curing','stripped') then true else coalesce(p_pre_pour_ready,pre_pour_ready) end,
    actual_poured_lf=case when p_new_stage='poured' then p_actual_lf else actual_poured_lf end,
    notes=case when trim(coalesce(p_note,''))<>'' then concat_ws(E'\n',nullif(notes,''),trim(p_note)) else notes end
    where assignment_id=p_assignment_id returning * into v_row;
  insert into public.walls_production_events(assignment_id,event_type,previous_stage,new_stage,actual_lf,detail,actor_email)
    values(p_assignment_id,'stage_changed',v_old.stage,p_new_stage,v_row.actual_poured_lf,jsonb_build_object('note',coalesce(p_note,''),'setup_progress',v_row.setup_progress,'pre_pour_ready',v_row.pre_pour_ready),v_actor);
  return to_jsonb(v_row);
end;
$$;
