-- Invalidate approved sections when planning availability or resources change.
-- Keep existing section revisions and published packets as immutable history.
-- Prepared by Scout for Wes Borgen

begin;

-- Repair approval state for any week where planning inputs were saved after a
-- section approval. The section revisions and old packets remain untouched.
with stale_sections as (
  update public.weekly_planner_sections s
  set status='reapproval_required',
      schedule_version=s.schedule_version+1,
      approved_source_fingerprint=null,
      approved_by_user_id=null,
      approved_by_email=null,
      approved_at=null,
      updated_at=now(),
      updated_by='migration 20261016_016'
  where s.status='approved'
    and exists (
      select 1 from public.weekly_planner_audit a
      where a.week_start=s.week_start
        and a.event_type='planning_inputs_saved'
        and a.occurred_at>s.approved_at
    )
  returning s.week_start,s.section_key
)
insert into public.weekly_planner_audit(week_start,section_key,event_type,detail,actor_user_id,actor_email)
select week_start,section_key,'section_reapproval_required',
       jsonb_build_object('reason','planning_inputs_saved_after_approval','migration','20261016_016'),
       null,'migration 20261016_016'
from stale_sections;

update public.weekly_planner_weeks w
set status='reapproval_required',
    version=w.version+1,
    updated_at=now(),
    updated_by='migration 20261016_016'
where exists (
  select 1 from public.weekly_planner_sections s
  where s.week_start=w.week_start and s.status='reapproval_required'
)
and w.status<>'reapproval_required';

update public.weekly_planner_packs p
set is_active=false
where p.is_active
  and exists (
    select 1 from public.weekly_planner_sections s
    where s.week_start=p.week_start and s.status='reapproval_required'
  );

create or replace function public.save_weekly_planner_inputs(p_week_start date,p_availability jsonb,p_resources jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
  v_item jsonb;
  v_invalidated integer:=0;
begin
  if not public.weekly_planner_permission('edit') then raise exception 'Weekly Planner edit access required'; end if;
  perform public.ensure_weekly_planner_week(p_week_start);
  if jsonb_typeof(coalesce(p_availability,'[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_resources,'[]'::jsonb))<>'array' then
    raise exception 'Availability and resources must be arrays';
  end if;

  delete from public.weekly_planner_availability where week_start=p_week_start;
  for v_item in select value from jsonb_array_elements(coalesce(p_availability,'[]'::jsonb)) loop
    if btrim(coalesce(v_item->>'employee_name',''))<>'' then
      insert into public.weekly_planner_availability(week_start,employee_name,availability,notes,confirmed,updated_by)
      values(p_week_start,btrim(v_item->>'employee_name'),coalesce(v_item->'availability','{}'::jsonb),
        btrim(coalesce(v_item->>'notes','')),coalesce((v_item->>'confirmed')::boolean,false),v_actor);
    end if;
  end loop;

  delete from public.weekly_planner_resources where week_start=p_week_start;
  for v_item in select value from jsonb_array_elements(coalesce(p_resources,'[]'::jsonb)) loop
    if btrim(coalesce(v_item->>'resource_name',''))<>''
      and coalesce(v_item->>'work_date','') ~ '^\d{4}-\d{2}-\d{2}$'
      and (v_item->>'work_date')::date between p_week_start and p_week_start+4 then
      insert into public.weekly_planner_resources(week_start,resource_type,resource_name,work_date,start_time,end_time,section_key,project_location,readiness_status,notes,updated_by)
      values(p_week_start,
        case when v_item->>'resource_type' in ('crane','truck','trailer','forklift','equipment','other') then v_item->>'resource_type' else 'other' end,
        btrim(v_item->>'resource_name'),(v_item->>'work_date')::date,nullif(v_item->>'start_time','')::time,
        nullif(v_item->>'end_time','')::time,btrim(coalesce(v_item->>'section_key','')),
        btrim(coalesce(v_item->>'project_location','')),
        case when v_item->>'readiness_status' in ('unconfirmed','ready','unavailable','hold') then v_item->>'readiness_status' else 'unconfirmed' end,
        btrim(coalesce(v_item->>'notes','')),v_actor);
    end if;
  end loop;

  with invalidated as (
    update public.weekly_planner_sections
    set status='reapproval_required',schedule_version=schedule_version+1,
        approved_source_fingerprint=null,approved_by_user_id=null,approved_by_email=null,approved_at=null,
        updated_at=now(),updated_by=v_actor
    where week_start=p_week_start and status='approved'
    returning section_key,schedule_version
  )
  insert into public.weekly_planner_audit(week_start,section_key,event_type,detail,actor_user_id,actor_email)
  select p_week_start,section_key,'section_reapproval_required',
    jsonb_build_object('reason','planning_inputs_changed','schedule_version',schedule_version),auth.uid(),v_actor
  from invalidated;
  get diagnostics v_invalidated=row_count;

  update public.weekly_planner_weeks
  set status=case when status in ('approved','reapproval_required') or v_invalidated>0 then 'reapproval_required' else 'review' end,
      version=version+1,updated_at=now(),updated_by=v_actor
  where week_start=p_week_start;
  update public.weekly_planner_packs set is_active=false where week_start=p_week_start and is_active;
  insert into public.weekly_planner_audit(week_start,event_type,detail,actor_user_id,actor_email)
  values(p_week_start,'planning_inputs_saved',jsonb_build_object('sections_requiring_reapproval',v_invalidated),auth.uid(),v_actor);
  perform public.rebuild_weekly_planner_conflicts(p_week_start);
  return jsonb_build_object('ok',true,'week_start',p_week_start,'sections_requiring_reapproval',v_invalidated);
end;
$$;

revoke all on function public.save_weekly_planner_inputs(date,jsonb,jsonb) from public,anon;
grant execute on function public.save_weekly_planner_inputs(date,jsonb,jsonb) to authenticated;

commit;

