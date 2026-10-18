-- Correct derived job status so a completed partial run never presents the whole foundation as installed.
create or replace function public.get_walls_installation_snapshot(p_from date default current_date-7,p_to date default current_date+45)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.walls_installation_permission('view') then raise exception 'Superior Walls Installation access required'; end if;
  return jsonb_build_object(
    'permissions',jsonb_build_object('view',true,'manage',public.walls_installation_permission('manage'),'resources',public.walls_installation_permission('resources'),'qc',public.walls_installation_permission('qc'),'field_progress',public.walls_installation_permission('field_progress')),
    'jobs',coalesce((select jsonb_agg(jsonb_build_object(
      'job',r.data,'record_id',r.record_id,'installation',to_jsonb(j),
      'activities',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('resources',coalesce((select jsonb_agg(to_jsonb(x) order by x.resource_type,x.resource_name) from public.walls_installation_resources x where x.activity_id=a.activity_id),'[]'::jsonb)) order by a.activity_date,a.start_time,a.activity_id) from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.status<>'cancelled' and a.activity_date between p_from and p_to),'[]'::jsonb),
      'production',coalesce((select jsonb_agg(to_jsonb(a) order by a.strip_at,a.table_id) from public.walls_production_assignments a where a.wall_record_id=r.record_id and a.stage<>'cancelled'),'[]'::jsonb),
      'qc',coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at) from public.walls_installation_qc_releases q where q.wall_record_id=r.record_id),'[]'::jsonb),
      'issues',coalesce((select jsonb_agg(to_jsonb(i) order by i.reported_at desc) from public.walls_installation_issues i where i.wall_record_id=r.record_id),'[]'::jsonb),
      'open_production_issues',(select count(*) from public.walls_production_issues i where i.wall_record_id=r.record_id and i.status='open'),
      'delivery',coalesce((select jsonb_agg(jsonb_build_object('record_id',l.record_id,'assignment_ids',coalesce((select jsonb_agg(m.assignment_id) from public.walls_installation_load_assignments m where m.load_record_id=l.record_id),'[]'::jsonb))||l.data order by l.ordinal) from public.schedule_records l where l.collection='loads' and l.division='walls' and l.data->>'linkId'=r.record_id),'[]'::jsonb),
      'overall_status',case
        when coalesce(j.status,'planned')='on_hold' or exists(select 1 from public.walls_installation_issues i where i.wall_record_id=r.record_id and i.status='open' and i.severity='hold') then 'On Hold'
        when coalesce(j.closeout->>'field_complete','false')='true'
          and exists(select 1 from public.walls_production_assignments p where p.wall_record_id=r.record_id and p.stage<>'cancelled')
          and not exists(select 1 from public.walls_production_assignments p where p.wall_record_id=r.record_id and p.stage<>'cancelled'
            and not exists(select 1 from public.walls_installation_activity_assignments m join public.walls_installation_activities a on a.activity_id=m.activity_id
              where m.assignment_id=p.assignment_id and a.wall_record_id=r.record_id and a.activity_type='wall_installation' and a.status='completed'))
          and not exists(select 1 from unnest(array['bolting','foaming','caulking','corrections','other']) k where coalesce(j.closeout->>k,'not_required') not in ('complete','not_required'))
          and not exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_type='field_closeout' and a.status not in ('completed','cancelled'))
          then 'Field Complete'
        when exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_type='field_closeout' and a.status not in ('completed','cancelled')) then 'Closeout Pending'
        when exists(select 1 from public.walls_production_assignments p where p.wall_record_id=r.record_id and p.stage<>'cancelled')
          and not exists(select 1 from public.walls_production_assignments p where p.wall_record_id=r.record_id and p.stage<>'cancelled'
            and not exists(select 1 from public.walls_installation_activity_assignments m join public.walls_installation_activities a on a.activity_id=m.activity_id
              where m.assignment_id=p.assignment_id and a.wall_record_id=r.record_id and a.activity_type='wall_installation' and a.status='completed')) then 'Installation Complete'
        when exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_type='wall_installation' and a.status in ('completed','in_progress')) then 'Installation In Progress'
        when exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_type='stone_footing' and a.status in ('planned','in_progress')) then 'Site Preparation'
        when exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_type='loading_hauling' and a.status='planned') then 'Ready for Installation'
        when nullif(r.data->>'installDate','') is not null then 'Scheduled' else 'Not Scheduled' end
    ) order by nullif(r.data->>'installDate','') nulls last,r.ordinal) from public.schedule_records r left join public.walls_installation_jobs j on j.wall_record_id=r.record_id
      where r.collection='walls' and (
        (coalesce(r.data->>'completedDate','')='' and coalesce(r.data->>'completedMonth','')=''
          and (coalesce(r.data->>'installDate','')='' or (r.data->>'installDate') between p_from::text and p_to::text or exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_date between p_from and p_to)))
        or exists(select 1 from public.walls_production_assignments p left join public.walls_installation_qc_releases q on q.assignment_id=p.assignment_id where p.wall_record_id=r.record_id and p.stage='stripped' and q.status is distinct from 'released')
        or exists(select 1 from public.schedule_records l where l.collection='loads' and l.division='walls' and l.data->>'linkType'='wall' and l.data->>'linkId'=r.record_id and coalesce(l.data->>'status','') not in ('Delivered','Cancelled'))
      )
    ),'[]'::jsonb),
    'resource_conflicts',coalesce((select jsonb_agg(jsonb_build_object('resource',resource_name,'resource_type',resource_type,'date',activity_date,'activities',activity_ids) order by activity_date,resource_type,resource_name) from (
      select resource_name,resource_type,activity_date,array_agg(activity_id::text) activity_ids from (
        select a.activity_id,a.activity_date,x.resource_type,lower(trim(x.resource_name)) resource_name from public.walls_installation_activities a join public.walls_installation_resources x on x.activity_id=a.activity_id
        where a.status in ('planned','in_progress','on_hold') and x.availability_status<>'unavailable' and a.activity_date between p_from and p_to and nullif(trim(x.resource_name),'') is not null
      ) u group by resource_name,resource_type,activity_date having count(distinct activity_id)>1
    ) c),'[]'::jsonb),
    'generated_at',now()
  );
end;
$$;

revoke all on function public.get_walls_installation_snapshot(date,date) from public,anon;
grant execute on function public.get_walls_installation_snapshot(date,date) to authenticated;
