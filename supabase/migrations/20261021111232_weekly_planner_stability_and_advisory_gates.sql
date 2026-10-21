-- Keep operational hard blockers gated while advisory readiness warnings remain visible without manual acknowledgement.
-- This preserves each section's save/approval checks, source fingerprint gates, and immutable packet history.
-- Prepared by Scout for Wes Borgen

begin;

CREATE OR REPLACE FUNCTION public.rebuild_weekly_planner_conflicts(p_week_start date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_fingerprint text:=public.weekly_planner_source_fingerprint(p_week_start);v_row record;
begin
  if not public.weekly_planner_permission('view') then raise exception 'Weekly Planner access required'; end if;

  -- Rebuild the active set from current planning inputs. Acknowledged and
  -- resolved rows remain as history, while obsolete open conflicts disappear.
  delete from public.weekly_planner_conflicts
  where week_start=p_week_start and status='open';

  for v_row in select * from (
    select 'missing-leader-'||s.section_key conflict_key,'block' severity,'missing_crew_leader' conflict_type,
      s.section_name||' needs a confirmed crew leader.' message,array[s.section_key] affected_sections,null::date work_date
    from public.weekly_planner_sections s where s.week_start=p_week_start and btrim(s.crew_leader)=''
    union all
    select 'missing-crew-'||s.section_key,'block','missing_crew_assignment',s.section_name||' needs at least one assigned employee.',array[s.section_key],null::date
    from public.weekly_planner_sections s where s.week_start=p_week_start and not exists(select 1 from public.weekly_planner_section_people p where p.section_id=s.section_id)
    union all
    select 'resource-readiness-'||r.resource_id::text,case when r.readiness_status in ('unavailable','hold') then 'block' else 'warning' end,'equipment_readiness',r.resource_name||' readiness is '||replace(r.readiness_status,'_',' ')||'.',array_remove(array[r.section_key],''),r.work_date
    from public.weekly_planner_resources r where r.week_start=p_week_start and r.readiness_status in ('unconfirmed','unavailable','hold')
    union all
    select 'assignment-readiness-'||a.assignment_id::text,case when a.readiness_status='hold' then 'block' else 'warning' end,'work_readiness',s.section_name||' has unconfirmed or held work on '||a.work_date::text||': '||coalesce(nullif(a.project_location,''),'Unspecified location')||'.',array[s.section_key],a.work_date
    from public.weekly_planner_assignments a join public.weekly_planner_sections s on s.section_id=a.section_id
    where s.week_start=p_week_start and a.readiness_status in ('unconfirmed','hold') and a.source_authority<>'manual_required'
    union all
    select 'resource-overlap-'||md5(lower(r.resource_name)||r.work_date::text),'block','equipment_conflict',r.resource_name||' is assigned more than once on '||r.work_date::text||'.',array_agg(distinct r.section_key),r.work_date
    from public.weekly_planner_resources r where r.week_start=p_week_start group by lower(r.resource_name),r.resource_name,r.work_date having count(*)>1
    union all
    select 'employee-overlap-'||md5(lower(p.employee_name)||a.work_date::text),'block','employee_conflict',p.employee_name||' is assigned to more than one work area on '||a.work_date::text||'.',array_agg(distinct s.section_key),a.work_date
    from public.weekly_planner_section_people p join public.weekly_planner_sections s on s.section_id=p.section_id
    join (select distinct section_id,work_date from public.weekly_planner_assignments) a on a.section_id=s.section_id
    where s.week_start=p_week_start group by lower(p.employee_name),p.employee_name,a.work_date having count(distinct s.section_key)>1
  ) q loop
    insert into public.weekly_planner_conflicts(week_start,conflict_key,severity,conflict_type,message,affected_sections,work_date,source_fingerprint)
    values(p_week_start,v_row.conflict_key,v_row.severity,v_row.conflict_type,v_row.message,v_row.affected_sections,v_row.work_date,v_fingerprint)
    on conflict(week_start,conflict_key) do update set severity=excluded.severity,conflict_type=excluded.conflict_type,message=excluded.message,
      affected_sections=excluded.affected_sections,work_date=excluded.work_date,source_fingerprint=excluded.source_fingerprint,
      status=case when weekly_planner_conflicts.source_fingerprint<>excluded.source_fingerprint then 'open' else weekly_planner_conflicts.status end,updated_at=now();
  end loop;

end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_weekly_planner_section(p_section_id uuid, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_section public.weekly_planner_sections%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_current text;v_snapshot jsonb;
begin
  select * into v_section from public.weekly_planner_sections where section_id=p_section_id for update;
  if not found then raise exception 'Weekly Planner section not found'; end if;
  if not public.weekly_planner_permission('approve',v_section.section_key) then raise exception 'Weekly Planner approval access required'; end if;
  if v_section.schedule_version<>p_expected_version then raise exception 'Weekly Planner version conflict; refresh before approving'; end if;
  v_current:=public.weekly_planner_source_fingerprint(v_section.week_start);
  if v_section.source_fingerprint<>v_current then raise exception 'Live operations changed; refresh the weekly plan before approval'; end if;
  if btrim(v_section.crew_leader)='' or not exists(select 1 from public.weekly_planner_section_people where section_id=p_section_id) then raise exception 'Confirm the crew leader and assigned employees before approval'; end if;
  perform public.rebuild_weekly_planner_conflicts(v_section.week_start);
  if exists(select 1 from public.weekly_planner_conflicts c where c.week_start=v_section.week_start and c.status='open' and c.severity='block' and (cardinality(c.affected_sections)=0 or v_section.section_key=any(c.affected_sections))) then raise exception 'Resolve or acknowledge the section planning conflicts before approval'; end if;
  v_snapshot:=jsonb_build_object('section',to_jsonb(v_section),'people',coalesce((select jsonb_agg(to_jsonb(p) order by p.is_leader desc,p.employee_name) from public.weekly_planner_section_people p where p.section_id=p_section_id),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.work_date,a.sort_order,a.assignment_id) from public.weekly_planner_assignments a where a.section_id=p_section_id),'[]'::jsonb));
  insert into public.weekly_planner_section_revisions(section_id,week_start,section_key,schedule_version,source_fingerprint,snapshot,approved_by_user_id,approved_by_email)
  values(p_section_id,v_section.week_start,v_section.section_key,v_section.schedule_version,v_current,v_snapshot,auth.uid(),v_actor) on conflict(section_id,schedule_version) do nothing;
  update public.weekly_planner_sections set status='approved',approved_source_fingerprint=v_current,approved_by_user_id=auth.uid(),approved_by_email=v_actor,approved_at=now(),updated_at=now(),updated_by=v_actor
  where section_id=p_section_id returning * into v_section;
  insert into public.weekly_planner_audit(week_start,section_key,event_type,detail,actor_user_id,actor_email)
  values(v_section.week_start,v_section.section_key,'section_approved',jsonb_build_object('schedule_version',v_section.schedule_version,'source_fingerprint',v_current),auth.uid(),v_actor);
  return to_jsonb(v_section);
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_weekly_planner_pack(p_week_start date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_current text;v_version bigint;v_snapshot jsonb;v_pack public.weekly_planner_packs%rowtype;
begin
  if not public.weekly_planner_permission('publish') then raise exception 'Weekly Planner publication access required'; end if;
  v_current:=public.weekly_planner_source_fingerprint(p_week_start);
  if (select count(*) from public.weekly_planner_sections where week_start=p_week_start and status='approved' and approved_source_fingerprint=v_current)<>8 then raise exception 'All eight sections must be approved and current before publishing'; end if;
  if exists(select 1 from public.weekly_planner_conflicts where week_start=p_week_start and status='open' and severity='block') then raise exception 'Resolve or acknowledge every planning conflict before publishing'; end if;
  select coalesce(max(pack_version),0)+1 into v_version from public.weekly_planner_packs where week_start=p_week_start;
  v_snapshot:=jsonb_build_object('week_start',p_week_start,'week_end',p_week_start+4,'source_fingerprint',v_current,'published_at',now(),'published_by',v_actor,
    'sections',coalesce((select jsonb_agg(jsonb_build_object('section',to_jsonb(s),'people',coalesce((select jsonb_agg(to_jsonb(p) order by p.is_leader desc,p.employee_name) from public.weekly_planner_section_people p where p.section_id=s.section_id),'[]'::jsonb),'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.work_date,a.sort_order,a.assignment_id) from public.weekly_planner_assignments a where a.section_id=s.section_id),'[]'::jsonb)) order by s.sort_order) from public.weekly_planner_sections s where s.week_start=p_week_start),'[]'::jsonb),
    'resources',coalesce((select jsonb_agg(to_jsonb(r) order by r.work_date,r.resource_name) from public.weekly_planner_resources r where r.week_start=p_week_start),'[]'::jsonb),
    'conflicts',coalesce((select jsonb_agg(to_jsonb(c) order by c.severity,c.conflict_type) from public.weekly_planner_conflicts c where c.week_start=p_week_start),'[]'::jsonb));
  update public.weekly_planner_packs set is_active=false where week_start=p_week_start and is_active;
  insert into public.weekly_planner_packs(week_start,pack_version,source_fingerprint,snapshot,published_by_user_id,published_by_email)
  values(p_week_start,v_version,v_current,v_snapshot,auth.uid(),v_actor) returning * into v_pack;
  update public.weekly_planner_weeks set status='approved',version=version+1,updated_at=now(),updated_by=v_actor where week_start=p_week_start;
  insert into public.weekly_planner_audit(week_start,event_type,detail,actor_user_id,actor_email)
  values(p_week_start,'pack_published',jsonb_build_object('pack_id',v_pack.pack_id,'pack_version',v_version,'source_fingerprint',v_current),auth.uid(),v_actor);
  return to_jsonb(v_pack);
end;
$function$;

commit;
