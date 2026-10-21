-- Use authoritative production-table ordering; IDs are text, not numeric sort keys.
-- Preserve every existing planner permission, workflow gate and integration trigger.
create or replace function public.generate_weekly_planner(p_week_start date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_revision bigint:=0;v_fingerprint text;v_source jsonb;
begin
  if not public.weekly_planner_permission('edit') then raise exception 'Weekly Planner edit access required'; end if;
  perform public.ensure_weekly_planner_week(p_week_start);
  select revision into v_revision from public.schedule_meta where id=1;
  v_fingerprint:=public.weekly_planner_source_fingerprint(p_week_start);

  v_source:=jsonb_build_object(
    'schedule_revision',coalesce(v_revision,0),
    'walls_production',coalesce((select jsonb_agg(to_jsonb(a) order by a.setup_start_at,a.table_id) from public.walls_production_assignments a where a.stage<>'cancelled' and a.setup_start_at::date<=p_week_start+4 and a.strip_at::date>=p_week_start),'[]'::jsonb),
    'schedule_records',coalesce((select jsonb_agg(jsonb_build_object('collection',r.collection,'record_id',r.record_id,'division',r.division,'data',r.data,'updated_at',r.updated_at) order by r.collection,r.ordinal)
      from public.schedule_records r where (r.collection='loads' and (r.data->>'date') between p_week_start::text and (p_week_start+4)::text)
        or (r.collection='walls' and ((r.data->>'installDate') between p_week_start::text and (p_week_start+4)::text or (r.data->>'deliveryDate') between p_week_start::text and (p_week_start+4)::text))
        or r.collection='jobs'),'[]'::jsonb)
  );
  insert into public.weekly_planner_source_snapshots(week_start,source_revision,source_fingerprint,source_data,created_by)
  values(p_week_start,coalesce(v_revision,0),v_fingerprint,v_source,v_actor) on conflict(week_start,source_fingerprint) do nothing;

  delete from public.weekly_planner_assignments a using public.weekly_planner_sections s
  where a.section_id=s.section_id and s.week_start=p_week_start and a.source_authority in ('linked','manual_required');

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,d.work_date,coalesce(nullif(r.data->>'project',''),nullif(r.data->>'development',''),r.data->>'job','Superior Walls plant'),
    concat_ws(' · ',case when a.setup_start_at::date=d.work_date then 'Setup' end,case when a.pour_at::date=d.work_date then 'Pour '||a.planned_lf||' LF' end,case when a.strip_at::date=d.work_date then 'Strip / reset' end)||' — Table '||a.table_id,
    case when a.setup_start_at::date=d.work_date then to_char(a.setup_start_at,'HH24:MI') when a.pour_at::date=d.work_date then to_char(a.pour_at,'HH24:MI') else to_char(a.strip_at,'HH24:MI') end,
    case when a.needs_review then coalesce(nullif(a.review_reason,''),'Source change needs review') else '' end,
    'Follow production release, cure, QC, and table-handoff requirements.','linked','walls_production_assignment',a.assignment_id::text,
    case when a.needs_review then 'hold' else 'unconfirmed' end,coalesce((select t.sort_order from public.walls_production_tables t where t.table_id=a.table_id),0),v_actor
  from public.walls_production_assignments a
  join public.schedule_records r on r.collection=a.schedule_collection and r.record_id=a.wall_record_id
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='walls_production'
  cross join lateral (select g::date work_date from generate_series(p_week_start,p_week_start+4,interval '1 day') g) d
  where a.stage<>'cancelled' and (a.setup_start_at::date=d.work_date or a.pour_at::date=d.work_date);

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,d.work_date,'Table '||a.table_id,
    concat_ws(' + ',case when a.setup_start_at::date=d.work_date then 'Setup' end,case when a.pour_at::date=d.work_date then 'Pour' end,case when a.strip_at::date=d.work_date then 'Strip / reset' end)||' · '||coalesce(r.data->>'job',a.wall_record_id)||' · '||a.planned_lf||' LF',
    '',case when a.needs_review then coalesce(nullif(a.review_reason,''),'Source change needs review') else '' end,'Table flow mirrors the authoritative production assignment.','linked','walls_production_assignment',a.assignment_id::text,
    case when a.needs_review then 'hold' else 'not_applicable' end,coalesce((select t.sort_order from public.walls_production_tables t where t.table_id=a.table_id),0),v_actor
  from public.walls_production_assignments a
  join public.schedule_records r on r.collection=a.schedule_collection and r.record_id=a.wall_record_id
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='table_flow'
  cross join lateral (select g::date work_date from generate_series(p_week_start,p_week_start+4,interval '1 day') g) d
  where a.stage<>'cancelled' and (a.setup_start_at::date=d.work_date or a.pour_at::date=d.work_date or a.strip_at::date=d.work_date);

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,a.strip_at::date,coalesce(nullif(r.data->>'project',''),r.data->>'job','Superior Walls plant'),
    'Strip / reset Table '||a.table_id||' · '||coalesce(r.data->>'job',a.wall_record_id)||' · '||a.planned_lf||' LF',to_char(a.strip_at,'HH24:MI'),
    case when a.needs_review then coalesce(nullif(a.review_reason,''),'Source change needs review') else '' end,
    'Stage only released panels; coordinate same-day table handoff.','linked','walls_production_assignment',a.assignment_id::text,
    case when a.needs_review then 'hold' else 'unconfirmed' end,coalesce((select t.sort_order from public.walls_production_tables t where t.table_id=a.table_id),0),v_actor
  from public.walls_production_assignments a join public.schedule_records r on r.collection=a.schedule_collection and r.record_id=a.wall_record_id
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='walls_stripping_loading'
  where a.stage<>'cancelled' and a.strip_at::date between p_week_start and p_week_start+4;

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,(p.value->>'plannedDate')::date,coalesce(nullif(r.data->>'name',''),r.record_id),
    coalesce(nullif(p.value->>'label',''),nullif(p.value->>'pieceType',''),'Precast piece')||' · '||coalesce(nullif(p.value->>'pieceSize',''),'production support'),'',
    case when coalesce(p.value->>'status','')='hold' then 'QC hold' else '' end,'Coordinate forms, steel, concrete, QC, and handling.','linked','schedule_record_product',r.record_id||':'||coalesce(p.value->>'id',''),
    case when coalesce(p.value->>'status','')='hold' then 'hold' else 'unconfirmed' end,coalesce((p.value->>'sortOrder')::integer,0),v_actor
  from public.schedule_records r cross join lateral jsonb_array_elements(coalesce(r.data->'products','[]'::jsonb)) p(value)
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='box_precast_support'
  where r.collection='jobs' and coalesce(r.division,'') in ('boxes','manholes','fence','block')
    and coalesce(p.value->>'plannedDate','') ~ '^\d{4}-\d{2}-\d{2}$' and (p.value->>'plannedDate')::date between p_week_start and p_week_start+4;

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,(r.data->>'installDate')::date,coalesce(nullif(r.data->>'address',''),nullif(r.data->>'project',''),r.data->>'job'),
    'Install '||coalesce(r.data->>'job',r.record_id)||' · '||coalesce(nullif(r.data->>'type',''),'Superior Walls'),'',coalesce(r.data->>'constraint',''),
    'Confirm site readiness, released panels, crew, crane, trucking, and installation plan.','linked','schedule_record',r.record_id,'unconfirmed',r.ordinal,v_actor
  from public.schedule_records r join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='installation_stone'
  where r.collection='walls' and coalesce(r.data->>'installDate','') ~ '^\d{4}-\d{2}-\d{2}$' and (r.data->>'installDate')::date between p_week_start and p_week_start+4;

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,(r.data->>'date')::date,coalesce(nullif(r.data->>'project',''),'Delivery'),
    coalesce(nullif(r.data->>'load',''),'Scheduled load')||case when coalesce(r.data->>'qty','')<>'' then ' · '||(r.data->>'qty') else '' end,'',
    case when coalesce(r.data->>'status','') in ('Hold','At Risk') then r.data->>'status' else '' end,
    'Confirm released product, truck/trailer, driver, crane, route, and site readiness.','linked','schedule_load',r.record_id,
    case when coalesce(r.data->>'status','')='Loaded' then 'confirmed' when coalesce(r.data->>'status','')='Hold' then 'hold' else 'unconfirmed' end,r.ordinal,v_actor
  from public.schedule_records r join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='logistics_cranes'
  where r.collection='loads' and coalesce(r.data->>'date','') ~ '^\d{4}-\d{2}-\d{2}$' and (r.data->>'date')::date between p_week_start and p_week_start+4;

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,a.pour_at::date,'Table '||a.table_id,'Production inspection coverage · '||coalesce(r.data->>'job',a.wall_record_id)||' · '||a.planned_lf||' LF','',
    case when exists(select 1 from public.walls_production_issues i where i.assignment_id=a.assignment_id and i.status='open') then 'Open production / QC issue' else '' end,
    'Weekly schedule approval is not QC release. Complete and document required inspection separately.','linked','walls_production_assignment',a.assignment_id::text,
    case when exists(select 1 from public.walls_production_issues i where i.assignment_id=a.assignment_id and i.status='open') then 'hold' else 'unconfirmed' end,coalesce((select t.sort_order from public.walls_production_tables t where t.table_id=a.table_id),0),v_actor
  from public.walls_production_assignments a join public.schedule_records r on r.collection=a.schedule_collection and r.record_id=a.wall_record_id
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='quality_control'
  where a.stage<>'cancelled' and a.pour_at::date between p_week_start and p_week_start+4;

  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,g::date,'Plant','Management input required: maintenance priorities and plant-support coverage.','','Missing confirmed maintenance plan','Enter verified equipment, owner, timing, and backup work.','manual_required','',g::date::text,'unconfirmed',extract(isodow from g)::integer,v_actor
  from public.weekly_planner_sections s cross join generate_series(p_week_start,p_week_start+4,interval '1 day') g
  where s.week_start=p_week_start and s.section_key='maintenance_plant';

  update public.weekly_planner_sections set source_fingerprint=v_fingerprint,schedule_version=schedule_version+1,
    status=case when status='approved' then 'reapproval_required' else 'needs_review' end,approved_by_user_id=null,approved_by_email=null,approved_at=null,
    updated_at=now(),updated_by=v_actor where week_start=p_week_start;
  update public.weekly_planner_weeks set status='review',source_revision=coalesce(v_revision,0),source_fingerprint=v_fingerprint,generated_at=now(),generated_by=v_actor,
    version=version+1,updated_at=now(),updated_by=v_actor where week_start=p_week_start;
  update public.weekly_planner_packs set is_active=false where week_start=p_week_start and is_active;
  insert into public.weekly_planner_audit(week_start,event_type,detail,actor_user_id,actor_email)
  values(p_week_start,'generated',jsonb_build_object('source_revision',coalesce(v_revision,0),'source_fingerprint',v_fingerprint),auth.uid(),v_actor);
  perform public.rebuild_weekly_planner_conflicts(p_week_start);
  return jsonb_build_object('ok',true,'week_start',p_week_start,'source_revision',coalesce(v_revision,0),'source_fingerprint',v_fingerprint);
end;
$$;
