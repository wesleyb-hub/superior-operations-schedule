-- Keep partial-run scope visible in linked Weekly Planner assignments. Updating the
-- activity version already triggers the existing planner reapproval invalidation.
create or replace function public.sync_walls_installation_week(p_week_start date)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_section uuid;v_actor text:=lower(coalesce(auth.jwt()->>'email','system'));
begin
  select section_id into v_section from public.weekly_planner_sections where week_start=p_week_start and section_key='installation_stone';
  if v_section is null then return; end if;
  delete from public.weekly_planner_assignments a using public.weekly_planner_sections s where a.section_id=s.section_id and s.week_start=p_week_start and a.source_type in ('walls_installation_activity','walls_installation_qc');
  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select v_section,a.activity_date,coalesce(nullif(r.data->>'address',''),nullif(r.data->>'project',''),nullif(r.data->>'development',''),r.data->>'job'),
    upper(replace(a.activity_type,'_',' '))||' · '||coalesce(r.data->>'job',a.wall_record_id)
      ||case when a.activity_type in ('loading_hauling','wall_installation') then coalesce((select ' · Runs: '||string_agg('Table '||p.table_id||' ('||p.planned_lf||' LF)','; ' order by p.strip_at,p.table_id) from public.walls_installation_activity_assignments m join public.walls_production_assignments p on p.assignment_id=m.assignment_id where m.activity_id=a.activity_id),' · Run scope not selected') else '' end
      ||coalesce((select ' · '||string_agg(x.resource_type||': '||x.resource_name||' ('||x.availability_status||')','; ' order by x.resource_type,x.resource_name) from public.walls_installation_resources x where x.activity_id=a.activity_id),' · Crew/equipment unconfirmed')
      ||case when nullif(j.readiness->>'restrictions','') is not null then ' · Site restriction: '||(j.readiness->>'restrictions') else '' end,
    coalesce(to_char(a.start_time,'HH24:MI'),''),case when a.needs_review then 'Master schedule changed — review field plan' when a.status='on_hold' then 'Installation activity on hold' when exists(select 1 from public.walls_installation_issues i where i.wall_record_id=a.wall_record_id and i.status='open' and i.severity='hold') then 'Open field issue hold' else '' end,
    concat_ws(' · ',nullif(a.notes,''),nullif(j.readiness->>'restrictions',''),case when exists(select 1 from public.walls_installation_issues i where i.wall_record_id=a.wall_record_id and i.status='open') then 'Open field issue(s) require review' end,'Confirm site readiness, final QC, crew, equipment, trucking, and access.'),'linked','walls_installation_activity',a.activity_id::text,
    case when a.needs_review or a.status='on_hold' or exists(select 1 from public.walls_installation_issues i where i.wall_record_id=a.wall_record_id and i.status='open' and i.severity='hold') then 'hold' when not exists(select 1 from public.walls_installation_resources x where x.activity_id=a.activity_id and x.availability_status='confirmed') then 'unconfirmed' else 'confirmed' end,
    10000+row_number() over(order by a.start_time,a.activity_id)::integer,v_actor
  from public.walls_installation_activities a join public.schedule_records r on r.collection='walls' and r.record_id=a.wall_record_id left join public.walls_installation_jobs j on j.wall_record_id=a.wall_record_id
  where a.status<>'cancelled' and a.activity_date between p_week_start and p_week_start+4;
  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,a.activity_date,coalesce(nullif(r.data->>'address',''),nullif(r.data->>'project',''),nullif(r.data->>'development',''),r.data->>'job'),
    upper(replace(a.activity_type,'_',' '))||' · '||coalesce(r.data->>'job',a.wall_record_id)
      ||coalesce((select ' · Runs: '||string_agg('Table '||p.table_id||' ('||p.planned_lf||' LF)','; ' order by p.strip_at,p.table_id) from public.walls_installation_activity_assignments m join public.walls_production_assignments p on p.assignment_id=m.assignment_id where m.activity_id=a.activity_id),' · Run scope not selected')
      ||coalesce((select ' · '||string_agg(x.resource_type||': '||x.resource_name||coalesce(' / '||nullif(x.role_name,''),''),' · ' order by x.resource_type,x.resource_name) from public.walls_installation_resources x where x.activity_id=a.activity_id and x.resource_type in ('crane','truck','trailer','stone_slinger','equipment')),' · Truck/crane/equipment unconfirmed'),
    coalesce(to_char(a.start_time,'HH24:MI'),''),case when a.needs_review or a.status='on_hold' then 'Field plan needs review / hold' when exists(select 1 from public.walls_installation_issues i where i.wall_record_id=a.wall_record_id and i.status='open' and i.severity='hold') then 'Open field issue hold' else '' end,
    concat_ws(' · ',nullif(a.notes,''),nullif(j.readiness->>'restrictions',''),case when exists(select 1 from public.walls_installation_issues i where i.wall_record_id=a.wall_record_id and i.status='open') then 'Review open field issue(s)' end,'Coordinate existing Delivery loads; confirm driver, operator, crane, route, and site access.'),'linked','walls_installation_activity',a.activity_id::text,
    case when a.needs_review or a.status='on_hold' then 'hold' when not exists(select 1 from public.walls_installation_resources x where x.activity_id=a.activity_id and x.resource_type in ('crane','truck','trailer','stone_slinger','equipment') and x.availability_status='confirmed' and x.readiness_status in ('ready','not_applicable')) then 'unconfirmed' else 'confirmed' end,
    20000+row_number() over(order by a.start_time,a.activity_id)::integer,v_actor
  from public.walls_installation_activities a join public.schedule_records r on r.collection='walls' and r.record_id=a.wall_record_id left join public.walls_installation_jobs j on j.wall_record_id=a.wall_record_id
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='logistics_cranes'
  where a.status<>'cancelled' and a.activity_type in ('loading_hauling','wall_installation') and a.activity_date between p_week_start and p_week_start+4;
  insert into public.weekly_planner_assignments(section_id,work_date,project_location,assignment_text,start_time,status_hold,backup_instructions,source_authority,source_type,source_id,readiness_status,sort_order,updated_by)
  select s.section_id,a.strip_at::date,coalesce(nullif(r.data->>'address',''),nullif(r.data->>'project',''),r.data->>'job'),
    'Final Superior Walls QC release · '||coalesce(r.data->>'job',a.wall_record_id)||' · Table '||a.table_id||' · '||a.planned_lf||' LF',
    '',case when a.stage<>'stripped' or q.status is distinct from 'released' then 'Final Walls QC release required' else '' end,
    'Final QC is separate from Approved for Production; do not dispatch unreleased wall panels.','linked','walls_installation_qc',a.assignment_id::text,
    case when a.stage='stripped' and q.status='released' then 'confirmed' else 'hold' end,30000+row_number() over(order by a.strip_at,a.assignment_id)::integer,v_actor
  from public.walls_production_assignments a join public.schedule_records r on r.collection='walls' and r.record_id=a.wall_record_id
  left join public.walls_installation_qc_releases q on q.assignment_id=a.assignment_id
  join public.weekly_planner_sections s on s.week_start=p_week_start and s.section_key='quality_control'
  where a.stage<>'cancelled' and (a.strip_at::date between p_week_start and p_week_start+4 or exists(select 1 from public.walls_installation_activities x where x.wall_record_id=a.wall_record_id and x.activity_type in ('loading_hauling','wall_installation') and x.activity_date between p_week_start and p_week_start+4));
  delete from public.weekly_planner_conflicts where week_start=p_week_start and conflict_type='installation_resource_overlap' and status='open';
  insert into public.weekly_planner_conflicts(week_start,conflict_key,severity,conflict_type,message,affected_sections,work_date,source_fingerprint)
  select p_week_start,'install-resource-'||md5(x.resource_type||lower(x.resource_name)||a.activity_date::text),'warning','installation_resource_overlap',x.resource_type||' '||x.resource_name||' has multiple installation assignments on '||a.activity_date||'; verify times and availability.',array['installation_stone','logistics_cranes'],a.activity_date,public.weekly_planner_source_fingerprint(p_week_start)
  from public.walls_installation_activities a join public.walls_installation_resources x on x.activity_id=a.activity_id
  where a.status in ('planned','in_progress','on_hold') and a.activity_date between p_week_start and p_week_start+4 and x.availability_status<>'unavailable'
  group by x.resource_type,x.resource_name,a.activity_date having count(distinct a.activity_id)>1
  on conflict(week_start,conflict_key) do update set severity=excluded.severity,message=excluded.message,affected_sections=excluded.affected_sections,work_date=excluded.work_date,source_fingerprint=excluded.source_fingerprint,status='open',updated_at=now();
  update public.weekly_planner_sections set source_fingerprint=public.weekly_planner_source_fingerprint(p_week_start),schedule_version=schedule_version+1,status=case when status='approved' then 'reapproval_required' else 'needs_review' end,
    approved_source_fingerprint=null,approved_by_user_id=null,approved_by_email=null,approved_at=null,updated_at=now(),updated_by=v_actor
  where week_start=p_week_start and section_key in ('installation_stone','logistics_cranes','quality_control');
end;
$$;
