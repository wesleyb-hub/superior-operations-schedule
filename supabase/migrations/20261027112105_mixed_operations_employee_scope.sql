-- Private candidate: schema/capability definitions only. No identities or grants are enrolled.
-- Created with Supabase CLI 2.122.0. Apply only after reviewed activation consent.
-- Product total/dailyRate are unit counts (not monetary amounts); no prices are projected.
begin;
alter table public.app_employee_access drop constraint app_employee_access_profile_key_check;
alter table public.app_employee_access add constraint app_employee_access_profile_key_check check(profile_key in ('walls_inventory_counter','plant_manager_readonly','walls_production_inventory_qc_v1'));
alter table public.app_employee_access add constraint app_employee_mixed_scope_check check (
 profile_key<>'walls_production_inventory_qc_v1' or (
 inventory_can_view and inventory_can_adjust and inventory_can_manage
 and allowed_views @> array['overview','walls','inventory','boxes','manholes','fence','block','qc','weekly-planner']::text[]
 and allowed_views <@ array['overview','walls','inventory','boxes','manholes','fence','block','qc','weekly-planner']::text[]
 and cardinality(allowed_views)=9
 and allowed_wall_subviews @> array['production','installation']::text[]
 and allowed_wall_subviews <@ array['production','installation']::text[]
 and cardinality(allowed_wall_subviews)=2));

-- Includes disabled records: disabling the profile cannot accidentally expose raw supervisor data.
create or replace function public.has_mixed_operations_profile()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and exists(select 1 from public.app_employee_access a where a.user_id=auth.uid() and a.profile_key='walls_production_inventory_qc_v1');
$$;
create or replace function public.mixed_operations_profile_active()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and (select count(*)=3 and bool_and(enabled and profile_key='walls_production_inventory_qc_v1') from public.app_employee_access where user_id=auth.uid());
$$;
revoke all on function public.has_mixed_operations_profile(),public.mixed_operations_profile_active() from public,anon;
grant execute on function public.has_mixed_operations_profile(),public.mixed_operations_profile_active() to authenticated;
create or replace function public.inventory_scope_access(
  p_division_key text,
  p_inventory_area text,
  p_permission text default 'view'
)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_operations_admin() or ((not public.has_mixed_operations_profile() or (public.mixed_operations_profile_active() and ((p_division_key='walls' and p_inventory_area in ('production','install')) or (p_division_key='boxes' and p_inventory_area='production')))) and (exists (
    select 1 from public.inventory_user_access a
    where a.email=lower(coalesce(auth.jwt()->>'email','')) and a.enabled
      and a.division_key=p_division_key and a.inventory_area=p_inventory_area
      and case p_permission
        when 'manage' then a.can_manage
        when 'adjust' then (a.can_adjust or a.can_manage)
        else (a.can_view or a.can_adjust or a.can_manage)
      end
  ) or exists (
    select 1 from public.app_employee_access a
    where a.user_id=auth.uid() and a.enabled
      and a.division_key=p_division_key and a.inventory_area=p_inventory_area
      and case p_permission
        when 'manage' then a.inventory_can_manage
        when 'adjust' then (a.inventory_can_adjust or a.inventory_can_manage)
        else (a.inventory_can_view or a.inventory_can_adjust or a.inventory_can_manage)
      end
  )));
$$;
create or replace function public.can_read_full_walls_production()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and (public.is_operations_admin() or (not public.has_mixed_operations_profile() and exists(
    select 1 from public.walls_production_access a where a.user_id=auth.uid() and a.enabled and a.can_view)));
$$;
create or replace function public.walls_production_permission(p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_operations_admin() or ((not public.has_mixed_operations_profile() or public.mixed_operations_profile_active()) and (exists (
    select 1 from public.walls_production_access a where a.user_id=auth.uid() and a.enabled and
      case p_permission
        when 'setup' then a.can_update_setup
        when 'pour' then a.can_record_pour
        when 'strip' then a.can_record_strip
        when 'issue' then a.can_report_issue
        when 'assign' then a.can_manage_assignments
        when 'plan' then a.can_manage_plan
        else a.can_view
      end
  ) or (p_permission='view' and exists (
    select 1 from public.app_employee_access a where a.user_id=auth.uid() and a.enabled and a.division_key='walls' and a.inventory_area='production' and 'walls'=any(a.allowed_views)
  ))));
$$;
create or replace function public.walls_installation_permission(p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_operations_admin() or ((not public.has_mixed_operations_profile() or public.mixed_operations_profile_active()) and (not public.has_mixed_operations_profile() or p_permission in ('view','qc')) and exists(select 1 from public.walls_installation_access a where a.user_id=auth.uid() and a.enabled and case p_permission when 'manage' then a.can_manage when 'resources' then a.can_assign_resources when 'qc' then a.can_qc when 'field_progress' then a.can_record_field_progress else a.can_view end))
$$;
create or replace function public.get_app_access()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_role public.app_user_roles%rowtype;v_employee public.app_employee_access%rowtype;v_views text[];v_walls boolean;v_field boolean;v_wall_subviews text[];
begin
  select * into v_role from public.app_user_roles where user_id=auth.uid();
  if found then return jsonb_build_object('authorized',true,'profile_key',coalesce(v_role.role,'viewer'),'can_write',v_role.can_write,'is_admin',v_role.can_write,
    'allowed_views',to_jsonb(array['overview','walls','boxes','manholes','fence','block','qc','delivery','inventory','billing','exceptions','import','audit','history']::text[]),
    'allowed_wall_subviews',to_jsonb(array['production','current','overall','active','plans','monthly','year']::text[])); end if;
  if public.has_mixed_operations_profile() then
    if not public.mixed_operations_profile_active() then
      return jsonb_build_object('authorized',false,'profile_key','none','can_write',false,'is_admin',false,'allowed_views','[]'::jsonb,'allowed_wall_subviews','[]'::jsonb);
    end if;
    return jsonb_build_object('authorized',true,'profile_key','walls_production_inventory_qc_v1','can_write',false,'is_admin',false,
      'allowed_views',to_jsonb(array['overview','walls','inventory','boxes','manholes','fence','block','qc','weekly-planner']::text[]),
      'allowed_wall_subviews',to_jsonb(array['production','installation']::text[]),'division_key','walls','inventory_area','production');
  end if;
  select * into v_employee from public.app_employee_access where user_id=auth.uid() and enabled order by division_key,inventory_area limit 1;
  if found then
    v_walls:=public.walls_production_permission('view');
    v_field:=public.walls_installation_permission('view') and exists(select 1 from public.app_employee_access a where a.user_id=auth.uid() and a.enabled and 'installation'=any(a.allowed_wall_subviews));
    v_wall_subviews:=array[]::text[];
    if v_walls then v_wall_subviews:=array_append(v_wall_subviews,'production'); end if;
    if v_field then v_wall_subviews:=array_append(v_wall_subviews,'installation'); end if;
    v_views:=array['overview']::text[];
    if v_walls or v_field then v_views:=array_append(v_views,'walls'); end if;
    if jsonb_array_length(public.get_inventory_scopes())>0 then v_views:=array_append(v_views,'inventory'); end if;
    if exists(select 1 from public.app_employee_access a where a.user_id=auth.uid() and a.enabled and a.division_key='walls' and a.inventory_area='production' and 'weekly-planner'=any(a.allowed_views)) then v_views:=array_append(v_views,'weekly-planner'); end if;
    return jsonb_build_object('authorized',true,'profile_key',v_employee.profile_key,'can_write',false,'is_admin',false,
      'allowed_views',to_jsonb(v_views),'allowed_wall_subviews',to_jsonb(v_wall_subviews),
      'division_key',v_employee.division_key,'inventory_area',v_employee.inventory_area);
  end if;
  return jsonb_build_object('authorized',false,'profile_key','none','can_write',false,'is_admin',false,'allowed_views','[]'::jsonb,'allowed_wall_subviews','[]'::jsonb);
end;
$$;

-- Pure scalar projections: nested links/contacts/prices/history and unknown fields never pass.
create or replace function public.mixed_employee_product_projection(p_data jsonb)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
 select public.employee_scalar_fields(p_data,array['id','label','qty','status','plannedDate','productionDays','isSpecial','structureId','pieceType','pieceSize','pieceNotes','pouredDate','releasedDate','prePassedDate']);
$$;
create or replace function public.mixed_employee_job_projection(p_data jsonb,p_division text)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
 select public.employee_scalar_fields(p_data,array['id','name','type','customer','status','total','completedDate','dailyRate','regularPieceCount','deliveryDate','constraint'])
 ||jsonb_build_object('division',p_division,'products',coalesce((select jsonb_agg(public.mixed_employee_product_projection(p)) from jsonb_array_elements(case when jsonb_typeof(p_data->'products')='array' then p_data->'products' else '[]'::jsonb end) p),'[]'::jsonb));
$$;
revoke all on function public.mixed_employee_product_projection(jsonb),public.mixed_employee_job_projection(jsonb,text) from public,anon,authenticated;
create or replace function public.get_schedule_snapshot()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_meta public.schedule_meta%rowtype; v_data jsonb; v_access public.app_employee_access%rowtype;
begin
  select * into v_meta from public.schedule_meta where id=1;
  if public.is_operations_admin() then
    v_data:=public.compose_schedule_data();
  else
    select * into v_access from public.app_employee_access where user_id=auth.uid() and enabled;
    if not found then raise exception 'Not authorized'; end if;
    if public.has_mixed_operations_profile() and not public.mixed_operations_profile_active() then raise exception 'Not authorized'; end if;
    v_data:=jsonb_build_object(
      'walls',coalesce((select jsonb_agg(public.employee_wall_projection(r.data) order by r.ordinal) from public.schedule_records r where r.collection='walls' and r.division='walls' and public.walls_production_permission('view')),'[]'::jsonb),
      'jobs',case when public.mixed_operations_profile_active() then coalesce((select jsonb_agg(public.mixed_employee_job_projection(r.data,r.division) order by r.ordinal) from public.schedule_records r where r.collection='jobs' and r.division in ('boxes','manholes','fence','block')),'[]'::jsonb) else '[]'::jsonb end,'billing','[]'::jsonb,'audit','[]'::jsonb,'historyArchive','[]'::jsonb,
      'deliveryHistory','[]'::jsonb,'qcHistory','[]'::jsonb,'loads','[]'::jsonb,
      'migrationBackup',null,'systemFlags','{}'::jsonb
    );
  end if;
  return jsonb_build_object('id',1,'revision',v_meta.revision,'updated_at',v_meta.updated_at,'updated_by',case when public.is_operations_admin() then v_meta.updated_by else null end,
    'payload',jsonb_build_object('schemaVersion',v_meta.schema_version,'data',v_data));
end;
$$;
create or replace function public.mixed_installation_snapshot_internal(p_from date default current_date-7,p_to date default current_date+45)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.walls_installation_permission('view') then raise exception 'Superior Walls Installation access required'; end if;
  return jsonb_build_object(
    'permissions',jsonb_build_object('view',true,'manage',public.walls_installation_permission('manage'),'resources',public.walls_installation_permission('resources'),'qc',public.walls_installation_permission('qc'),'field_progress',public.walls_installation_permission('field_progress')),
    'jobs',coalesce((select jsonb_agg(jsonb_build_object(
      'job',r.data,'record_id',r.record_id,'installation',to_jsonb(j),
      'activities',coalesce((select jsonb_agg(to_jsonb(a)||(case when public.has_mixed_operations_profile() then jsonb_build_object('production_scope',coalesce((select jsonb_agg(jsonb_build_object('activity_id',m.activity_id,'assignment_id',m.assignment_id,'load_record_id',m.load_record_id)) from public.walls_installation_activity_assignments m where m.activity_id=a.activity_id),'[]'::jsonb)) else '{}'::jsonb end)||jsonb_build_object('resources',coalesce((select jsonb_agg(to_jsonb(x) order by x.resource_type,x.resource_name) from public.walls_installation_resources x where x.activity_id=a.activity_id),'[]'::jsonb)) order by a.activity_date,a.start_time,a.activity_id) from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.status<>'cancelled' and a.activity_date between p_from and p_to),'[]'::jsonb),
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
      where r.collection='walls' and (not public.has_mixed_operations_profile() or r.division='walls') and (
        (coalesce(r.data->>'completedDate','')='' and coalesce(r.data->>'completedMonth','')=''
          and (coalesce(r.data->>'installDate','')='' or (r.data->>'installDate') between p_from::text and p_to::text or exists(select 1 from public.walls_installation_activities a where a.wall_record_id=r.record_id and a.activity_date between p_from and p_to)))
        or exists(select 1 from public.walls_production_assignments p left join public.walls_installation_qc_releases q on q.assignment_id=p.assignment_id where p.wall_record_id=r.record_id and p.stage='stripped' and q.status is distinct from 'released')
        or exists(select 1 from public.schedule_records l where l.collection='loads' and l.division='walls' and l.data->>'linkType'='wall' and l.data->>'linkId'=r.record_id and coalesce(l.data->>'status','') not in ('Delivered','Cancelled'))
      )
    ),'[]'::jsonb),
    'day_cards',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.start_time,t.created_at,t.task_id) from public.walls_installation_day_tasks t where t.card_id=c.card_id and t.status<>'cancelled'),'[]'::jsonb)) order by c.work_date,c.created_at,c.card_id)
      from public.walls_installation_day_cards c where c.status='planned' and c.work_date between p_from and p_to),'[]'::jsonb),
    'resource_conflicts',coalesce((select jsonb_agg(jsonb_build_object('resource',resource_name,'resource_type',resource_type,'date',activity_date,'activities',activity_ids) order by activity_date,resource_type,resource_name) from (
      select resource_name,resource_type,activity_date,array_agg(activity_id) activity_ids from (
        select a.activity_id::text activity_id,a.activity_date,x.resource_type,lower(trim(x.resource_name)) resource_name from public.walls_installation_activities a join public.walls_installation_resources x on x.activity_id=a.activity_id
          where a.status in ('planned','in_progress','on_hold') and x.availability_status<>'unavailable' and a.activity_date between p_from and p_to and nullif(trim(x.resource_name),'') is not null
        union all select t.task_id::text,c.work_date,'employee',lower(trim(x)) from public.walls_installation_day_tasks t join public.walls_installation_day_cards c on c.card_id=t.card_id cross join lateral unnest(t.crew_names) x
          where t.status in ('planned','in_progress','on_hold') and c.status='planned' and c.work_date between p_from and p_to and nullif(trim(x),'') is not null
        union all select t.task_id::text,c.work_date,'equipment',lower(trim(x)) from public.walls_installation_day_tasks t join public.walls_installation_day_cards c on c.card_id=t.card_id cross join lateral unnest(t.equipment_names) x
          where t.status in ('planned','in_progress','on_hold') and c.status='planned' and c.work_date between p_from and p_to and nullif(trim(x),'') is not null
      ) u group by resource_name,resource_type,activity_date having count(distinct activity_id)>1
    ) conflicts),'[]'::jsonb),
    'generated_at',now()
  );
end;
$$;
revoke all on function public.mixed_installation_snapshot_internal(date,date) from public,anon,authenticated;

create or replace function public.mixed_employee_array_projection(p_data jsonb,p_keys text[])
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(public.employee_scalar_fields(x,p_keys)),'[]'::jsonb)
 from jsonb_array_elements(case when jsonb_typeof(p_data)='array' then p_data else '[]'::jsonb end) x;
$$;
create or replace function public.mixed_employee_string_array(p_data jsonb)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(p_data)='array' then p_data else '[]'::jsonb end) x where jsonb_typeof(x)='string';
$$;
create or replace function public.mixed_employee_installation_projection(p_data jsonb)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object(
 'permissions',public.employee_scalar_fields(p_data->'permissions',array['view','manage','resources','qc','field_progress']),
 'generated_at',p_data->'generated_at',
 'jobs',coalesce((select jsonb_agg(
  public.employee_scalar_fields(j,array['record_id','open_production_issues','overall_status'])||jsonb_build_object(
   'job',public.employee_wall_projection(j->'job')||public.employee_scalar_fields(j->'job',array['installDate']),
   'installation',public.employee_scalar_fields(j->'installation',array['wall_record_id','status','needs_review','review_reason','version'])||jsonb_build_object(
     'readiness',public.employee_scalar_fields(j#>'{installation,readiness}',array['site_access','excavation','layout_elevation','stone_footing','equipment_access','site_preparation_complete','restrictions']),
     'closeout',public.employee_scalar_fields(j#>'{installation,closeout}',array['bolting','foaming','caulking','corrections','other','field_complete'])),
   'production',public.mixed_employee_array_projection(j->'production',array['assignment_id','wall_record_id','table_id','wall_height','planned_lf','setup_start_at','pour_at','strip_at','stage','setup_progress','pre_pour_ready','actual_poured_lf','schedule_production_date','schedule_total_lf','needs_review','review_reason','notes','version']),
   'qc',public.mixed_employee_array_projection(j->'qc',array['assignment_id','wall_record_id','status','inspection_note','released_at','updated_at']),
   'issues',public.mixed_employee_array_projection(j->'issues',array['issue_id','wall_record_id','activity_id','category','severity','description','status','reported_at','resolved_at','resolution_note']),
   'delivery',public.mixed_employee_array_projection(j->'delivery',array['record_id','load','status','date','linkType','linkId']),
   'activities',coalesce((select jsonb_agg(public.employee_scalar_fields(a,array['activity_id','wall_record_id','activity_type','activity_date','start_time','end_time','status','notes','needs_review','version'])||jsonb_build_object(
     'production_scope',public.mixed_employee_array_projection(a->'production_scope',array['activity_id','assignment_id','load_record_id']),
     'resources',public.mixed_employee_array_projection(a->'resources',array['resource_assignment_id','activity_id','resource_type','resource_name','role_name','availability_status','readiness_status','problem_notes','version']))) from jsonb_array_elements(coalesce(j->'activities','[]'::jsonb)) a),'[]'::jsonb)
  )) from jsonb_array_elements(coalesce(p_data->'jobs','[]'::jsonb)) j),'[]'::jsonb),
 'day_cards',coalesce((select jsonb_agg(public.employee_scalar_fields(c,array['card_id','work_date','title','notes','status','version'])||jsonb_build_object(
  'tasks',coalesce((select jsonb_agg(public.employee_scalar_fields(t,array['task_id','card_id','task_title','start_time','end_time','status','notes','version'])||jsonb_build_object('crew_names',public.mixed_employee_string_array(t->'crew_names'),'equipment_names',public.mixed_employee_string_array(t->'equipment_names'))) from jsonb_array_elements(coalesce(c->'tasks','[]'::jsonb)) t),'[]'::jsonb))) from jsonb_array_elements(coalesce(p_data->'day_cards','[]'::jsonb)) c),'[]'::jsonb),
 'resource_conflicts',coalesce((select jsonb_agg(public.employee_scalar_fields(c,array['resource','resource_type','date'])||jsonb_build_object('activities',public.mixed_employee_string_array(c->'activities'))) from jsonb_array_elements(coalesce(p_data->'resource_conflicts','[]'::jsonb)) c),'[]'::jsonb));
$$;
revoke all on function public.mixed_employee_array_projection(jsonb,text[]),public.mixed_employee_string_array(jsonb),public.mixed_employee_installation_projection(jsonb) from public,anon,authenticated;

create or replace function public.get_walls_installation_snapshot(p_from date default current_date-7,p_to date default current_date+45)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_data jsonb;
begin
 if not public.walls_installation_permission('view') then raise exception 'Superior Walls Installation access required'; end if;
 v_data:=public.mixed_installation_snapshot_internal(p_from,p_to);
 if public.has_mixed_operations_profile() and not public.is_operations_admin() then
  return public.mixed_employee_installation_projection(v_data);
 end if;
 return v_data;
end;
$$;
revoke all on function public.get_walls_installation_snapshot(date,date) from public,anon;
grant execute on function public.get_walls_installation_snapshot(date,date) to authenticated;

-- Mixed employees read only safe snapshots, never raw field rows or actor identities.
drop policy if exists "Mixed employee projection only" on public.walls_installation_jobs;
create policy "Mixed employee projection only" on public.walls_installation_jobs as restrictive for select to authenticated using (public.is_operations_admin() or not public.has_mixed_operations_profile());
drop policy if exists "Mixed employee projection only" on public.walls_installation_activities;
create policy "Mixed employee projection only" on public.walls_installation_activities as restrictive for select to authenticated using (public.is_operations_admin() or not public.has_mixed_operations_profile());
drop policy if exists "Mixed employee projection only" on public.walls_installation_resources;
create policy "Mixed employee projection only" on public.walls_installation_resources as restrictive for select to authenticated using (public.is_operations_admin() or not public.has_mixed_operations_profile());
drop policy if exists "Mixed employee projection only" on public.walls_installation_issues;
create policy "Mixed employee projection only" on public.walls_installation_issues as restrictive for select to authenticated using (public.is_operations_admin() or not public.has_mixed_operations_profile());
drop policy if exists "Mixed employee projection only" on public.walls_installation_events;
create policy "Mixed employee projection only" on public.walls_installation_events as restrictive for select to authenticated using (public.is_operations_admin() or not public.has_mixed_operations_profile());
drop policy if exists "Mixed employee projection only" on public.walls_installation_qc_releases;
create policy "Mixed employee projection only" on public.walls_installation_qc_releases as restrictive for select to authenticated using (public.is_operations_admin() or not public.has_mixed_operations_profile());
drop policy if exists "Mixed employee projection only" on public.walls_installation_load_assignments;
create policy "Mixed employee projection only" on public.walls_installation_load_assignments as restrictive for select to authenticated using (public.is_operations_admin() or not public.has_mixed_operations_profile());
drop policy if exists "Mixed employee projection only" on public.walls_installation_day_cards;
create policy "Mixed employee projection only" on public.walls_installation_day_cards as restrictive for select to authenticated using (public.is_operations_admin() or not public.has_mixed_operations_profile());
drop policy if exists "Mixed employee projection only" on public.walls_installation_day_tasks;
create policy "Mixed employee projection only" on public.walls_installation_day_tasks as restrictive for select to authenticated using (public.is_operations_admin() or not public.has_mixed_operations_profile());
drop policy if exists "Mixed employee projection only" on public.walls_installation_day_events;
create policy "Mixed employee projection only" on public.walls_installation_day_events as restrictive for select to authenticated using (public.is_operations_admin() or not public.has_mixed_operations_profile());
drop policy if exists "Mixed employee projection only" on public.walls_installation_activity_assignments;
create policy "Mixed employee projection only" on public.walls_installation_activity_assignments as restrictive for select to authenticated using (public.is_operations_admin() or not public.has_mixed_operations_profile());

create or replace function public.set_walls_installation_qc(p_assignment_id uuid,p_status text,p_note text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_assignment public.walls_production_assignments%rowtype;v_row public.walls_installation_qc_releases%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));v_previous text;
begin
  if not public.walls_installation_permission('qc') then raise exception 'Superior Walls QC release access required'; end if;
  if p_status not in ('released','hold','pending') then raise exception 'Unsupported Walls QC status'; end if;
  if p_status='hold' and length(btrim(coalesce(p_note,'')))<3 then raise exception 'Describe the final-QC issue before placing an assignment on hold';end if;
  select * into v_assignment from public.walls_production_assignments where assignment_id=p_assignment_id for update;
  if not found then raise exception 'Production assignment not found'; end if;
  if public.has_mixed_operations_profile() and not exists(select 1 from public.schedule_records r where r.collection='walls' and r.division='walls' and r.record_id=v_assignment.wall_record_id) then raise exception 'Superior Walls assignment required'; end if;
  select status into v_previous from public.walls_installation_qc_releases where assignment_id=p_assignment_id;
  if p_status='released' and (v_assignment.stage<>'stripped' or exists(select 1 from public.walls_production_issues i where i.assignment_id=p_assignment_id and i.status='open')) then raise exception 'Assignment must be stripped with no open production holds before final QC release'; end if;
  insert into public.walls_installation_jobs(wall_record_id,created_by,updated_by) values(v_assignment.wall_record_id,v_actor,v_actor) on conflict(wall_record_id) do nothing;
  insert into public.walls_installation_qc_releases(assignment_id,wall_record_id,status,inspection_note,released_at,released_by_user_id,released_by_email,updated_by)
  values(p_assignment_id,v_assignment.wall_record_id,p_status,coalesce(p_note,''),case when p_status='released' then now() end,case when p_status='released' then auth.uid() end,case when p_status='released' then v_actor end,v_actor)
  on conflict(assignment_id) do update set status=excluded.status,inspection_note=excluded.inspection_note,released_at=excluded.released_at,released_by_user_id=excluded.released_by_user_id,released_by_email=excluded.released_by_email,updated_at=now(),updated_by=v_actor
  returning * into v_row;
  insert into public.walls_installation_events(wall_record_id,event_type,detail,actor_user_id,actor_email)
    values(v_assignment.wall_record_id,'final_qc_'||p_status,jsonb_build_object('assignment_id',p_assignment_id,'from',v_previous,'to',p_status,'note',p_note),auth.uid(),v_actor);
  if public.has_mixed_operations_profile() and not public.is_operations_admin() then return public.employee_scalar_fields(to_jsonb(v_row),array['assignment_id','wall_record_id','status','inspection_note','released_at','updated_at']); end if;
  return to_jsonb(v_row);
end;
$$;
-- Defensive target fence for legacy narrow production RPCs: a corrupt collection/division
-- pairing must not let a mixed employee mutate another division by a known UUID.
create or replace function public.guard_mixed_employee_walls_target()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id text;
begin
 if public.has_mixed_operations_profile() and not public.is_operations_admin() then
  v_id:=case when tg_op='DELETE' then old.wall_record_id else new.wall_record_id end;
  if not public.mixed_operations_profile_active() or not exists(select 1 from public.schedule_records r where r.collection='walls' and r.division='walls' and r.record_id=v_id) then raise exception 'Superior Walls target required'; end if;
  if tg_op='UPDATE' and old.wall_record_id is distinct from new.wall_record_id and not exists(select 1 from public.schedule_records r where r.collection='walls' and r.division='walls' and r.record_id=old.wall_record_id) then raise exception 'Superior Walls target required'; end if;
  -- Independent FKs do not establish issue/assignment parent consistency. Check
  -- both versions so a known corrupt issue cannot be resolved or laundered.
  -- Null assignment IDs are legitimate wall-level issues and remain supported.
  if tg_table_name='walls_production_issues' then
   if tg_op in ('INSERT','UPDATE') and new.assignment_id is not null then
    perform 1 from public.walls_production_assignments a where a.assignment_id=new.assignment_id and a.schedule_collection='walls' and a.wall_record_id=new.wall_record_id for share;
    if not found then raise exception 'Superior Walls issue assignment parent mismatch'; end if;
   end if;
   if tg_op in ('UPDATE','DELETE') and old.assignment_id is not null then
    perform 1 from public.walls_production_assignments a where a.assignment_id=old.assignment_id and a.schedule_collection='walls' and a.wall_record_id=old.wall_record_id for share;
    if not found then raise exception 'Superior Walls issue assignment parent mismatch'; end if;
   end if;
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
revoke all on function public.guard_mixed_employee_walls_target() from public,anon,authenticated;
create trigger mixed_employee_walls_assignment_target before insert or update or delete on public.walls_production_assignments for each row execute function public.guard_mixed_employee_walls_target();
create trigger mixed_employee_walls_issue_target before insert or update or delete on public.walls_production_issues for each row execute function public.guard_mixed_employee_walls_target();

-- Reuse the exact approved Walls crew projection; partial mixed revocation fails closed.
create or replace function employee_pack_private.approved_crew_packs(p_week_start date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare
  v_pack public.weekly_planner_packs%rowtype;
  v_sections jsonb;
  v_result jsonb:=jsonb_build_object('permissions',jsonb_build_object('view',true,'edit',false,'approve',false,'publish',false),'packs','[]'::jsonb);
begin
  if (public.has_mixed_operations_profile() and not public.mixed_operations_profile_active()) or auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' or not exists (
    select 1 from public.app_employee_access a
    where a.user_id=auth.uid() and a.enabled
      and a.division_key='walls' and a.inventory_area='production'
      and 'weekly-planner'=any(a.allowed_views)
  ) then raise exception 'Approved crew pack access required' using errcode='42501'; end if;
  if p_week_start is null or extract(isodow from p_week_start)<>1 then
    raise exception 'Planning week must start on Monday' using errcode='22023';
  end if;

  -- A published row is the publication source of truth. Ambiguous active packs,
  -- review/reapproval weeks, and approval/version drift all fail closed. No
  -- generation, source snapshot, conflict rebuild or business writer is called.
  if (select count(*) from public.weekly_planner_packs p where p.week_start=p_week_start and p.is_active)<>1 then return v_result; end if;
  select p.* into v_pack from public.weekly_planner_packs p
  join public.weekly_planner_weeks w on w.week_start=p.week_start
  where p.week_start=p_week_start and p.is_active and p.pack_version>0
    and p.published_at is not null and w.status='approved'
    and p.source_fingerprint=w.source_fingerprint;
  if not found then return v_result; end if;
  -- The stored fingerprint still binds publication/approval provenance, but its
  -- GLOBAL live value includes unrelated divisions, revision counters and stage
  -- progress. Compare only the approved production plan to current planned work.
  if not employee_pack_private.production_plan_matches(p_week_start,v_pack.source_fingerprint,v_pack.published_at) then return v_result; end if;
  if jsonb_typeof(v_pack.snapshot->'sections') is distinct from 'array'
    or v_pack.snapshot->>'week_start' is distinct from p_week_start::text
    or v_pack.snapshot->>'week_end' is distinct from (p_week_start+4)::text then return v_result; end if;
  if jsonb_array_length(v_pack.snapshot->'sections')<>8
    or (select count(*) from public.weekly_planner_sections s where s.week_start=p_week_start)<>8
    or exists (
      select 1 from jsonb_array_elements(v_pack.snapshot->'sections') x
      where not exists (
        select 1 from public.weekly_planner_sections s
        where s.week_start=p_week_start and s.section_key=x#>>'{section,section_key}'
          and s.section_id::text=x#>>'{section,section_id}'
          and s.schedule_version::text=x#>>'{section,schedule_version}'
          and s.status='approved' and x#>>'{section,status}'='approved'
          and s.approved_source_fingerprint=v_pack.source_fingerprint
          and x#>>'{section,approved_source_fingerprint}'=v_pack.source_fingerprint
      )
    ) or (select count(distinct x#>>'{section,section_key}') from jsonb_array_elements(v_pack.snapshot->'sections') x)<>8
  then return v_result; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'section',jsonb_build_object('section_key',scope.section_key,'section_name',scope.section_name,
      'sort_order',scope.sort_order,'status','approved',
      'crew_leader',employee_pack_private.pack_text(x->'section','crew_leader')),
    'people',coalesce((select jsonb_agg(jsonb_build_object('employee_name',employee_pack_private.pack_text(person,'employee_name')) order by ord)
      from jsonb_array_elements(case when jsonb_typeof(x->'people')='array' then x->'people' else '[]'::jsonb end) with ordinality p(person,ord)
      where employee_pack_private.pack_text(person,'employee_name')<>''),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(jsonb_build_object(
      'work_date',employee_pack_private.pack_text(assignment,'work_date'),
      'project_location',employee_pack_private.pack_text(assignment,'project_location'),
      'assignment_text',employee_pack_private.pack_text(assignment,'assignment_text'),
      'start_time',employee_pack_private.pack_text(assignment,'start_time'),
      'status_hold',employee_pack_private.pack_text(assignment,'status_hold'),
      'backup_instructions',employee_pack_private.pack_text(assignment,'backup_instructions')) order by ord)
      from jsonb_array_elements(case when jsonb_typeof(x->'assignments')='array' then x->'assignments' else '[]'::jsonb end) with ordinality a(assignment,ord)
      where employee_pack_private.pack_text(assignment,'work_date') in
        (p_week_start::text,(p_week_start+1)::text,(p_week_start+2)::text,(p_week_start+3)::text,(p_week_start+4)::text)), '[]'::jsonb)
  ) order by scope.sort_order),'[]'::jsonb) into v_sections
  from jsonb_array_elements(v_pack.snapshot->'sections') x
  join (values ('walls_production','Walls Production',1),('table_flow','Five-Day Production Table Flow',2),('walls_stripping_loading','Walls Stripping and Loading',3))
    as scope(section_key,section_name,sort_order) on scope.section_key=x#>>'{section,section_key}';

  return jsonb_set(v_result,'{packs}',jsonb_build_array(jsonb_build_object(
    'pack_id',v_pack.pack_id,'week_start',v_pack.week_start,'pack_version',v_pack.pack_version,
    'is_active',true,'published_at',v_pack.published_at,
    'snapshot',jsonb_build_object('week_start',v_pack.week_start,'week_end',v_pack.week_start+4,'sections',v_sections))));
end;
$$;
commit;
