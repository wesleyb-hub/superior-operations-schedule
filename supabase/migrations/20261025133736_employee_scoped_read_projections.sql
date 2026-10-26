-- Employee-only read paths: exact scope + explicit scalar field projections.
-- No user/access/operational rows change. Admin and independent supervisor grants remain additive.
-- Generate with Supabase CLI 2.122.0; apply only after explicit production approval.
begin;

-- Pure projection helpers never query data and are not callable by API roles.
create or replace function public.employee_scalar_fields(p_data jsonb,p_keys text[])
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p_data)='object' then p_data else '{}'::jsonb end)
  where key=any(p_keys) and jsonb_typeof(value) in ('string','number','boolean','null');
$$;

create or replace function public.employee_wall_projection(p_data jsonb)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
  select public.employee_scalar_fields(p_data,array['id','job','type','project','development','address','productionDate','lf','lfUnassigned','completedDate','completedMonth'])
    ||jsonb_build_object('lfByHeight',public.employee_scalar_fields(p_data->'lfByHeight',array['h4','h5','h8','h9','h10','h12']));
$$;

-- Preserve independently granted supervisors. Employee grants alone never unlock raw rows.
create or replace function public.can_read_full_walls_production()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and (public.is_operations_admin() or exists(
    select 1 from public.walls_production_access a where a.user_id=auth.uid() and a.enabled and a.can_view));
$$;

create or replace function public.can_read_full_inventory(p_division_key text,p_inventory_area text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and (public.is_operations_admin() or exists(
    select 1 from public.inventory_user_access a where a.email=lower(coalesce(auth.jwt()->>'email','')) and a.enabled
      and a.division_key=p_division_key and a.inventory_area=p_inventory_area and (a.can_view or a.can_adjust or a.can_manage)));
$$;

create or replace function public.employee_inventory_item_projection(p_data jsonb)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
  select public.employee_scalar_fields(p_data,array['item_id','titan_code','description','category','unit','quantity','reorder_threshold','ordered','version','updated_at','division_key','inventory_area']);
$$;

-- Policy helpers return booleans only; all new defaults are explicitly revoked.
revoke all on function public.employee_scalar_fields(jsonb,text[]),public.employee_wall_projection(jsonb),public.employee_inventory_item_projection(jsonb) from public,anon,authenticated;
revoke all on function public.can_read_full_walls_production(),public.can_read_full_inventory(text,text) from public,anon;
grant execute on function public.can_read_full_walls_production(),public.can_read_full_inventory(text,text) to authenticated;


create or replace function public.walls_production_permission(p_permission text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_operations_admin() or exists (
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
  ));
$$;

create or replace function public.get_app_access()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_role public.app_user_roles%rowtype;v_employee public.app_employee_access%rowtype;v_views text[];v_walls boolean;v_field boolean;v_wall_subviews text[];
begin
  select * into v_role from public.app_user_roles where user_id=auth.uid();
  if found then return jsonb_build_object('authorized',true,'profile_key',coalesce(v_role.role,'viewer'),'can_write',v_role.can_write,'is_admin',v_role.can_write,
    'allowed_views',to_jsonb(array['overview','walls','boxes','manholes','fence','block','qc','delivery','inventory','billing','exceptions','import','audit','history']::text[]),
    'allowed_wall_subviews',to_jsonb(array['production','current','overall','active','plans','monthly','year']::text[])); end if;
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
    v_data:=jsonb_build_object(
      'walls',coalesce((select jsonb_agg(public.employee_wall_projection(r.data) order by r.ordinal) from public.schedule_records r where r.collection='walls' and r.division='walls' and public.walls_production_permission('view')),'[]'::jsonb),
      'jobs','[]'::jsonb,'billing','[]'::jsonb,'audit','[]'::jsonb,'historyArchive','[]'::jsonb,
      'deliveryHistory','[]'::jsonb,'qcHistory','[]'::jsonb,'loads','[]'::jsonb,
      'migrationBackup',null,'systemFlags','{}'::jsonb
    );
  end if;
  return jsonb_build_object('id',1,'revision',v_meta.revision,'updated_at',v_meta.updated_at,'updated_by',case when public.is_operations_admin() then v_meta.updated_by else null end,
    'payload',jsonb_build_object('schemaVersion',v_meta.schema_version,'data',v_data));
end;
$$;

drop policy if exists "Employee projection only" on public.walls_production_tables;
create policy "Employee projection only" on public.walls_production_tables as restrictive for select to authenticated using (public.can_read_full_walls_production());

drop policy if exists "Employee projection only" on public.walls_production_assignments;
create policy "Employee projection only" on public.walls_production_assignments as restrictive for select to authenticated using (public.can_read_full_walls_production());

drop policy if exists "Employee projection only" on public.walls_production_issues;
create policy "Employee projection only" on public.walls_production_issues as restrictive for select to authenticated using (public.can_read_full_walls_production());

drop policy if exists "Employee projection only" on public.walls_production_events;
create policy "Employee projection only" on public.walls_production_events as restrictive for select to authenticated using (public.can_read_full_walls_production());

drop policy if exists "Employee projection only" on public.walls_production_weekly_forecasts;
create policy "Employee projection only" on public.walls_production_weekly_forecasts as restrictive for select to authenticated using (public.can_read_full_walls_production());

drop policy if exists "Employee projection only" on public.inventory_items;
create policy "Employee projection only" on public.inventory_items as restrictive for select to authenticated using (public.can_read_full_inventory(division_key,inventory_area));

drop policy if exists "Employee projection only" on public.inventory_categories;
create policy "Employee projection only" on public.inventory_categories as restrictive for select to authenticated using (public.can_read_full_inventory(division_key,inventory_area));

drop policy if exists "Employee projection only" on public.inventory_events;
create policy "Employee projection only" on public.inventory_events as restrictive for select to authenticated using (
  exists(select 1 from public.inventory_items i where i.item_id=inventory_events.item_id and public.can_read_full_inventory(i.division_key,i.inventory_area)));
-- schedule_meta contains updated_by; employees get revision/timestamp through the safe RPC instead.
drop policy if exists "Employee projection only" on public.schedule_meta;
create policy "Employee projection only" on public.schedule_meta as restrictive for select to authenticated using (public.is_operations_admin());


create or replace function public.get_walls_production_snapshot(p_from date default current_date-7,p_to date default current_date+45)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_full boolean:=public.can_read_full_walls_production();
begin
  if not public.walls_production_permission('view') then raise exception 'Superior Walls production access required'; end if;
  return jsonb_build_object(
    'full_read_access',v_full,
    'permissions',jsonb_build_object(
      'view',true,'setup',public.walls_production_permission('setup'),'pour',public.walls_production_permission('pour'),
      'strip',public.walls_production_permission('strip'),'issue',public.walls_production_permission('issue'),
      'assign',public.walls_production_permission('assign'),'plan',public.walls_production_permission('plan')
    ),
    'tables',coalesce((select jsonb_agg(case when v_full then to_jsonb(t) else public.employee_scalar_fields(to_jsonb(t),array['table_id','label','capacity_lf','sort_order','enabled','version']) end order by t.sort_order,t.label) from public.walls_production_tables t where t.enabled),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(case when v_full then jsonb_build_object(
      'id',r.record_id,'job',r.data->>'job','model',r.data->>'type','project',r.data->>'project','development',r.data->>'development',
      'customer',r.data->>'customer','address',r.data->>'address','productionDate',r.data->>'productionDate',
      'totalLf',public.walls_job_total_lf(r.record_id),'lfByHeight',coalesce(r.data->'lfByHeight','{}'::jsonb),
      'releaseStatus',case when r.data#>>'{planReview,stages,approvedProduction,status}'='Complete' then 'Released for Production' else 'Not Released for Production' end,
      'documentLinks',case when r.data#>>'{planReview,stages,approvedProduction,status}'='Complete' then coalesce(r.data->'links','[]'::jsonb) else '[]'::jsonb end,
      'assignedLf',coalesce((select sum(a.planned_lf) from public.walls_production_assignments a where a.wall_record_id=r.record_id and a.stage<>'cancelled'),0),
      'actualPouredLf',coalesce((select sum(a.actual_poured_lf) from public.walls_production_assignments a where a.wall_record_id=r.record_id and a.stage not in ('cancelled','planned','setup_in_progress','setup_complete','ready_for_pour')),0)
    ) else public.employee_wall_projection(r.data)||jsonb_build_object(
      'id',r.record_id,'model',public.employee_scalar_fields(r.data,array['type'])->'type',
      'totalLf',public.walls_job_total_lf(r.record_id),
      'releaseStatus',case when r.data#>>'{planReview,stages,approvedProduction,status}'='Complete' then 'Released for Production' else 'Not Released for Production' end,
      'documentLinks','[]'::jsonb,
      'assignedLf',coalesce((select sum(a.planned_lf) from public.walls_production_assignments a where a.wall_record_id=r.record_id and a.stage<>'cancelled'),0),
      'actualPouredLf',coalesce((select sum(a.actual_poured_lf) from public.walls_production_assignments a where a.wall_record_id=r.record_id and a.stage not in ('cancelled','planned','setup_in_progress','setup_complete','ready_for_pour')),0)
    ) end order by nullif(r.data->>'productionDate','') nulls last,r.ordinal) from public.schedule_records r where r.collection='walls' and (v_full or r.division='walls') and coalesce(r.data->>'completedDate','')='' and coalesce(r.data->>'completedMonth','')=''),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(case when v_full then to_jsonb(a) else public.employee_scalar_fields(to_jsonb(a),array['assignment_id','wall_record_id','table_id','wall_height','planned_lf','setup_start_at','pour_at','strip_at','stage','setup_progress','pre_pour_ready','actual_poured_lf','schedule_production_date','schedule_total_lf','needs_review','review_reason','notes','version']) end order by a.setup_start_at,a.table_id) from public.walls_production_assignments a where (v_full or exists(select 1 from public.schedule_records r where r.collection='walls' and r.record_id=a.wall_record_id and r.division='walls')) and a.stage<>'cancelled' and a.setup_start_at::date<=p_to+45 and a.strip_at::date>=p_from-7),'[]'::jsonb),
    'issues',coalesce((select jsonb_agg(case when v_full then to_jsonb(i) else public.employee_scalar_fields(to_jsonb(i),array['issue_id','assignment_id','wall_record_id','table_id','category','description','status','reported_at','resolved_at']) end order by (i.status='open') desc,i.reported_at desc) from public.walls_production_issues i where (v_full or exists(select 1 from public.schedule_records r where r.collection='walls' and r.record_id=i.wall_record_id and r.division='walls')) and (i.status='open' or i.reported_at::date>=p_from-30)),'[]'::jsonb),
    'events',case when not v_full then '[]'::jsonb else coalesce((select jsonb_agg(x.data order by x.occurred_at desc) from (select to_jsonb(e) data,e.occurred_at from public.walls_production_events e order by e.occurred_at desc limit 200) x),'[]'::jsonb) end,
    'generatedAt',now()
  );
end;
$$;

create or replace function public.get_walls_production_weekly_forecast(p_week_start date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_full boolean:=public.can_read_full_walls_production();
  v_week date:=date_trunc('week',p_week_start::timestamp)::date;
  v_baseline public.walls_production_weekly_forecasts%rowtype;
  v_current numeric:=0;
  v_actual numeric:=0;
begin
  if not public.walls_production_permission('view') then
    raise exception 'Superior Walls production access required';
  end if;

  select * into v_baseline
  from public.walls_production_weekly_forecasts
  where week_start=v_week;

  -- Frozen baselines are JSON snapshots, not a second authority for division or fields.
  if not v_full and v_baseline.week_start is not null then
    select coalesce(jsonb_agg(public.employee_scalar_fields(d,array['assignmentId','wallRecordId','tableId','tableLabel','wallHeight','plannedLf','pourDate'])||jsonb_build_object('job',public.employee_wall_projection(r.data)->'job','model',public.employee_wall_projection(r.data)->'type')),'[]'::jsonb),
      coalesce(sum(case when jsonb_typeof(d->'plannedLf')='number' then (d->>'plannedLf')::numeric else 0 end),0),count(*)
    into v_baseline.baseline_detail,v_baseline.baseline_planned_lf,v_baseline.baseline_assignment_count
    from jsonb_array_elements(case when jsonb_typeof(v_baseline.baseline_detail)='array' then v_baseline.baseline_detail else '[]'::jsonb end) d
    join public.schedule_records r on r.collection='walls' and r.division='walls' and r.record_id=d->>'wallRecordId';
  end if;

  select coalesce(sum(a.planned_lf),0) into v_current
  from public.walls_production_assignments a
  where (v_full or exists(select 1 from public.schedule_records r where r.collection='walls' and r.division='walls' and r.record_id=a.wall_record_id)) and a.stage<>'cancelled' and a.pour_at::date between v_week and v_week+6;

  select coalesce(sum(e.actual_lf),0) into v_actual
  from public.walls_production_events e
  where (v_full or exists(select 1 from public.walls_production_assignments a join public.schedule_records r on r.collection='walls' and r.record_id=a.wall_record_id where a.assignment_id=e.assignment_id and r.division='walls')) and e.event_type='stage_changed' and e.new_stage='poured'
    and (e.occurred_at at time zone 'America/Chicago')::date between v_week and v_week+6;

  return jsonb_build_object(
    'weekStart',v_week,
    'weekEnd',v_week+6,
     'baseline',case when v_baseline.week_start is null then null when v_full then to_jsonb(v_baseline) else
      public.employee_scalar_fields(to_jsonb(v_baseline),array['week_start','baseline_planned_lf','baseline_assignment_count','frozen_at'])
      ||jsonb_build_object('baseline_detail',coalesce((select jsonb_agg(public.employee_scalar_fields(d,array['assignmentId','wallRecordId','job','model','tableId','tableLabel','wallHeight','plannedLf','pourDate']))
        from jsonb_array_elements(case when jsonb_typeof(v_baseline.baseline_detail)='array' then v_baseline.baseline_detail else '[]'::jsonb end) d
        where exists(select 1 from public.schedule_records r where r.collection='walls' and r.division='walls' and r.record_id=d->>'wallRecordId')),'[]'::jsonb)) end,
    'currentPlannedLf',v_current,
    'actualPouredLf',v_actual,
    'daily',coalesce((
      select jsonb_agg(jsonb_build_object(
        'date',d.day::date,
        'plannedLf',coalesce((select sum(a.planned_lf) from public.walls_production_assignments a where (v_full or exists(select 1 from public.schedule_records r where r.collection='walls' and r.division='walls' and r.record_id=a.wall_record_id)) and a.stage<>'cancelled' and a.pour_at::date=d.day::date),0),
        'actualLf',coalesce((select sum(e.actual_lf) from public.walls_production_events e where (v_full or exists(select 1 from public.walls_production_assignments a join public.schedule_records r on r.collection='walls' and r.record_id=a.wall_record_id where a.assignment_id=e.assignment_id and r.division='walls')) and e.event_type='stage_changed' and e.new_stage='poured' and (e.occurred_at at time zone 'America/Chicago')::date=d.day::date),0)
      ) order by d.day)
      from generate_series(v_week::timestamp,(v_week+6)::timestamp,interval '1 day') d(day)
    ),'[]'::jsonb),
    'assignments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignmentId',a.assignment_id,
        'wallRecordId',a.wall_record_id,
        'job',coalesce((case when v_full then r.data else public.employee_wall_projection(r.data) end)->>'job',a.wall_record_id),
        'model',coalesce((case when v_full then r.data else public.employee_wall_projection(r.data) end)->>'type',''),
        'project',case when v_full then coalesce(r.data->>'project',r.data->>'development','') else coalesce(public.employee_wall_projection(r.data)->>'project',public.employee_wall_projection(r.data)->>'development','') end,
        'tableId',a.table_id,
        'tableLabel',coalesce(t.label,a.table_id),
        'wallHeight',a.wall_height,
        'plannedLf',a.planned_lf,
        'plannedPourDate',a.pour_at::date,
        'actualLf',case when x.actual_date between v_week and v_week+6 then coalesce(x.actual_lf,0) else 0 end,
        'actualPourDate',x.actual_date,
        'stage',a.stage
      ) order by coalesce(x.actual_date,a.pour_at::date),a.pour_at,a.table_id)
      from public.walls_production_assignments a
      join public.schedule_records r on r.collection='walls' and r.record_id=a.wall_record_id
      left join public.walls_production_tables t on t.table_id=a.table_id
      left join lateral (
        select coalesce(sum(e.actual_lf),0) actual_lf,
          min((e.occurred_at at time zone 'America/Chicago')::date) actual_date
        from public.walls_production_events e
        where e.assignment_id=a.assignment_id and e.event_type='stage_changed' and e.new_stage='poured'
      ) x on true
      where (v_full or exists(select 1 from public.schedule_records r where r.collection='walls' and r.division='walls' and r.record_id=a.wall_record_id)) and a.stage<>'cancelled' and (
        a.pour_at::date between v_week and v_week+6 or x.actual_date between v_week and v_week+6
      )
    ),'[]'::jsonb),
    'generatedAt',now()
  );
end;
$$;

-- Unified inventory loader: scope authorization before any read; never fall back to raw REST.
create or replace function public.get_inventory_snapshot(p_division_key text,p_inventory_area text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_full boolean;
begin
  if auth.uid() is null or not public.inventory_scope_access(p_division_key,p_inventory_area,'view') then
    raise exception 'Inventory scope access required';
  end if;
  v_full:=public.can_read_full_inventory(p_division_key,p_inventory_area);
  return jsonb_build_object(
    'division_key',p_division_key,'inventory_area',p_inventory_area,'full_read_access',v_full,
    'items',coalesce((select jsonb_agg(case when v_full then to_jsonb(i) else public.employee_inventory_item_projection(to_jsonb(i)) end order by i.item_id)
      from public.inventory_items i where i.division_key=p_division_key and i.inventory_area=p_inventory_area),'[]'::jsonb),
    'events',case when not v_full then '[]'::jsonb else coalesce((select jsonb_agg(x.data order by x.occurred_at desc) from (
      select to_jsonb(e) data,e.occurred_at from public.inventory_events e join public.inventory_items i using(item_id)
      where i.division_key=p_division_key and i.inventory_area=p_inventory_area order by e.occurred_at desc limit 50) x),'[]'::jsonb) end,
    'generated_at',now());
end;
$$;
revoke all on function public.get_inventory_snapshot(text,text) from public,anon;
grant execute on function public.get_inventory_snapshot(text,text) to authenticated;


create or replace function public.adjust_inventory_quantity(p_item_id bigint,p_delta integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before integer;v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_item_access(p_item_id,'adjust') then raise exception 'Inventory adjustment access required'; end if;
  if p_delta not in (-1,1) then raise exception 'Adjustment must be -1 or 1'; end if;
  select quantity into v_before from public.inventory_items where item_id=p_item_id for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if v_before is null then raise exception 'Set an initial count first'; end if;
  update public.inventory_items set quantity=greatest(0,v_before+p_delta),ordered=case when greatest(0,v_before+p_delta)>coalesce(reorder_threshold,-1) then false else ordered end,updated_by=v_actor where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email) values(p_item_id,'adjusted',v_before,v_item.quantity,jsonb_build_object('delta',p_delta),v_actor);
  return case when public.can_read_full_inventory(v_item.division_key,v_item.inventory_area) then to_jsonb(v_item) else public.employee_inventory_item_projection(to_jsonb(v_item)) end;
end;
$$;

create or replace function public.set_inventory_count(p_item_id bigint,p_expected_version bigint,p_quantity integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.inventory_items%rowtype; v_item public.inventory_items%rowtype; v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_item_access(p_item_id,'adjust') then raise exception 'Inventory count access required'; end if;
  if p_quantity is null or p_quantity<0 then raise exception 'Quantity must be zero or a positive whole number'; end if;
  select * into v_old from public.inventory_items where item_id=p_item_id for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if v_old.version is distinct from p_expected_version then raise exception 'Inventory version conflict'; end if;
  update public.inventory_items set quantity=p_quantity,updated_by=v_actor
    where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email)
  values(p_item_id,'corrected',v_old.quantity,v_item.quantity,jsonb_build_object('count_only',true),v_actor);
  return case when public.can_read_full_inventory(v_item.division_key,v_item.inventory_area) then to_jsonb(v_item) else public.employee_inventory_item_projection(to_jsonb(v_item)) end;
end;
$$;

create or replace function public.set_inventory_item(p_item_id bigint,p_expected_version bigint,p_quantity integer,p_reorder_threshold integer,p_unit text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.inventory_items%rowtype;v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_item_access(p_item_id,'manage') then raise exception 'Inventory management access required'; end if;
  if p_quantity is not null and p_quantity<0 then raise exception 'Quantity cannot be negative'; end if;
  if p_reorder_threshold is not null and p_reorder_threshold<0 then raise exception 'Reorder threshold cannot be negative'; end if;
  if p_unit not in ('units','boxes','bags','rolls','bundles','pallets','pieces','boards','lengths','sticks') then raise exception 'Unsupported inventory unit'; end if;
  select * into v_old from public.inventory_items where item_id=p_item_id for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if v_old.version is distinct from p_expected_version then raise exception 'Inventory version conflict'; end if;
  update public.inventory_items set quantity=p_quantity,reorder_threshold=p_reorder_threshold,unit=p_unit,
    ordered=case when p_quantity is not null and p_reorder_threshold is not null and p_quantity>p_reorder_threshold then false else ordered end,
    updated_by=v_actor where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email)
  values(p_item_id,'corrected',v_old.quantity,v_item.quantity,jsonb_build_object('threshold_before',v_old.reorder_threshold,'threshold_after',v_item.reorder_threshold,'unit_before',v_old.unit,'unit_after',v_item.unit),v_actor);
  return case when public.can_read_full_inventory(v_item.division_key,v_item.inventory_area) then to_jsonb(v_item) else public.employee_inventory_item_projection(to_jsonb(v_item)) end;
end;
$$;

create or replace function public.receive_inventory_stock(p_item_id bigint,p_expected_version bigint,p_quantity integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before integer;v_item public.inventory_items%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.inventory_item_access(p_item_id,'manage') then raise exception 'Inventory management access required'; end if;
  if p_quantity is null or p_quantity<1 then raise exception 'Received quantity must be a positive whole number'; end if;
  select quantity into v_before from public.inventory_items where item_id=p_item_id and version=p_expected_version for update;
  if not found then raise exception 'Inventory item missing or version conflict'; end if;
  update public.inventory_items set quantity=coalesce(v_before,0)+p_quantity,ordered=false,ordered_at=null,ordered_by=null,updated_by=v_actor
    where item_id=p_item_id returning * into v_item;
  insert into public.inventory_events(item_id,event_type,quantity_before,quantity_after,detail,actor_email)
  values(p_item_id,'received',v_before,v_item.quantity,jsonb_build_object('received',p_quantity),v_actor);
  return case when public.can_read_full_inventory(v_item.division_key,v_item.inventory_area) then to_jsonb(v_item) else public.employee_inventory_item_projection(to_jsonb(v_item)) end;
end;
$$;

-- Guarded return-only transplant: hosted alert recovery differs from committed source.
-- Match exact known bodies after CRLF normalization ONLY, including all string literals.
-- Preserve whichever variant is present; never change alert suppression/retry semantics.
do $employee_mark_ordered_projection$
declare
  v_oid oid:=to_regprocedure('public.mark_inventory_ordered(bigint,bigint)');
  v_body text;v_definition text;v_hash text;v_patched text;
  v_old constant text:='return to_jsonb(v_item);';
  v_new constant text:='return case when public.can_read_full_inventory(v_item.division_key,v_item.inventory_area) then to_jsonb(v_item) else public.employee_inventory_item_projection(to_jsonb(v_item)) end;';
begin
  select p.prosrc,pg_get_functiondef(p.oid) into v_body,v_definition
  from pg_proc p where p.oid=v_oid and p.prosecdef and p.prorettype='jsonb'::regtype
    and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=public, pg_temp'];
  if not found then raise exception 'Employee projection preflight failed: mark_inventory_ordered owner/signature/config drift'; end if;
  v_hash:=md5(replace(v_body,E'\r\n',E'\n'));
  -- Already-projected exact known variants make source reapplication a no-op.
  if v_hash in ('6e1834d14126799d61b4295671d4ee58','dd17a3ed3b95554e3672d96b09d4df82') then return; end if;
  if v_hash not in ('73e9d808081079b3aa3530ae8d6beba7','1173dc423b5bf06c98fd3ba1fb61aa26') then
    raise exception 'Employee projection preflight failed: unknown mark_inventory_ordered body; review drift before applying';
  end if;
  if (length(v_body)-length(replace(v_body,v_old,'')))/length(v_old)<>1
    or (length(v_definition)-length(replace(v_definition,v_body,'')))/length(v_body)<>1 then
    raise exception 'Employee projection preflight failed: ambiguous mark_inventory_ordered return';
  end if;
  v_patched:=replace(v_body,v_old,v_new);
  execute replace(v_definition,v_body,v_patched);
end;
$employee_mark_ordered_projection$;

create or replace function public.get_operations_agent_context()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_access jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_access:=public.get_app_access();
  if not coalesce((v_access->>'authorized')::boolean,false) then raise exception 'Operations Hub access required'; end if;
  return jsonb_build_object(
    'access',v_access,
    'inventory',coalesce((select jsonb_agg(jsonb_build_object(
      'item_id',i.item_id,'code',i.titan_code,'description',i.description,'category',i.category,
      'division_key',i.division_key,'inventory_area',i.inventory_area,'quantity',i.quantity,
      'reorder_threshold',i.reorder_threshold,'unit',i.unit,'ordered',i.ordered,'version',i.version,
      'can_adjust',public.inventory_item_access(i.item_id,'adjust')
    ) order by i.division_key,i.inventory_area,i.category,i.description)
    from public.inventory_items i where public.inventory_item_access(i.item_id,'view')),'[]'::jsonb),
    'production',case when public.walls_production_permission('view') then coalesce((select jsonb_agg(jsonb_build_object(
      'assignment_id',a.assignment_id,'version',a.version,'job_number',(case when public.can_read_full_walls_production() then r.data else public.employee_wall_projection(r.data) end)->>'job','project',(case when public.can_read_full_walls_production() then r.data else public.employee_wall_projection(r.data) end)->>'project',
      'model',(case when public.can_read_full_walls_production() then r.data else public.employee_wall_projection(r.data) end)->>'type','table_id',a.table_id,'wall_height',a.wall_height,'planned_lf',a.planned_lf,
      'actual_poured_lf',a.actual_poured_lf,'stage',a.stage,'setup_progress',a.setup_progress,
      'setup_start_at',a.setup_start_at,'pour_at',a.pour_at,'strip_at',a.strip_at,'needs_review',a.needs_review,
      'permissions',jsonb_build_object('setup',public.walls_production_permission('setup'),'pour',public.walls_production_permission('pour'),'strip',public.walls_production_permission('strip'))
    ) order by a.setup_start_at,a.table_id)
    from public.walls_production_assignments a
    join public.schedule_records r on r.collection=a.schedule_collection and r.record_id=a.wall_record_id
    where (public.can_read_full_walls_production() or r.division='walls') and a.stage<>'cancelled' and a.strip_at::date>=current_date-7 and a.setup_start_at::date<=current_date+45),'[]'::jsonb)
    else '[]'::jsonb end,
    'generated_at',now()
  );
end;
$$;

-- Response projections close write-return and old assistant-history read paths as well.
create or replace function public.employee_production_row_projection(p_kind text,p_data jsonb)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select case when p_kind in ('assignment','issue') and not exists(select 1 from public.schedule_records r where r.collection='walls' and r.division='walls' and r.record_id=p_data->>'wall_record_id') then '{}'::jsonb else public.employee_scalar_fields(p_data,case p_kind
    when 'assignment' then array['assignment_id','wall_record_id','table_id','wall_height','planned_lf','setup_start_at','pour_at','strip_at','stage','setup_progress','pre_pour_ready','actual_poured_lf','schedule_production_date','schedule_total_lf','needs_review','review_reason','notes','version']
    when 'issue' then array['issue_id','assignment_id','wall_record_id','table_id','category','description','status','reported_at','resolved_at']
    when 'table' then array['table_id','label','capacity_lf','sort_order','enabled','version'] else array[]::text[] end) end;
$$;
revoke all on function public.employee_production_row_projection(text,jsonb) from public,anon,authenticated;

create or replace function public.can_read_full_agent_action(p_action_type text,p_parameters jsonb)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and (public.is_operations_admin()
    or not exists(select 1 from public.app_employee_access a where a.user_id=auth.uid())
    or (p_action_type in ('advance_production_stage','update_setup_progress') and public.can_read_full_walls_production())
    or (p_action_type='set_inventory_count' and exists(select 1 from public.inventory_items i
      where i.item_id::text=p_parameters->>'item_id' and public.can_read_full_inventory(i.division_key,i.inventory_area))));
$$;
revoke all on function public.can_read_full_agent_action(text,jsonb) from public,anon;
grant execute on function public.can_read_full_agent_action(text,jsonb) to authenticated;

create or replace function public.employee_agent_action_projection(p_data jsonb)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare v_action text:=p_data->>'action_type';v_parameters jsonb:=p_data->'parameters';v_allowed boolean:=false;v_keys text[];
begin
  if public.can_read_full_agent_action(v_action,v_parameters) then return p_data; end if;
  if v_action='set_inventory_count' then
    select exists(select 1 from public.inventory_items i where i.item_id::text=v_parameters->>'item_id'
      and public.inventory_item_access(i.item_id,'adjust')) into v_allowed;
    v_keys:=array['item_id','expected_version','quantity'];
  elsif v_action in ('advance_production_stage','update_setup_progress') then
    v_allowed:=public.walls_production_permission(case when v_action='update_setup_progress' or v_parameters->>'new_stage' in ('setup_in_progress','setup_complete','ready_for_pour') then 'setup'
      when v_parameters->>'new_stage' in ('poured','curing') then 'pour' else 'strip' end) and exists(select 1 from public.walls_production_assignments a join public.schedule_records r on r.collection='walls' and r.record_id=a.wall_record_id where a.assignment_id::text=v_parameters->>'assignment_id' and r.division='walls');
    v_keys:=array['assignment_id','expected_version','new_stage','setup_progress','actual_lf','pre_pour_ready','note'];
  end if;
  if not v_allowed then
    return public.employee_scalar_fields(p_data,array['action_id','action_type','status','created_at','expires_at','confirmed_at','executed_at']);
  end if;
  return public.employee_scalar_fields(p_data,array['action_id','action_type','summary','status','created_at','expires_at','confirmed_at','executed_at','error_message'])
    ||jsonb_build_object('parameters',public.employee_scalar_fields(v_parameters,v_keys));
end;
$$;
revoke all on function public.employee_agent_action_projection(jsonb) from public,anon,authenticated;

-- Outbox payload and old assistant results may embed unprojected historical rows.
-- No frontend reads these raw tables; business/audit rows themselves remain untouched.
drop policy if exists "Employee projection only" on public.inventory_alert_outbox;
create policy "Employee projection only" on public.inventory_alert_outbox as restrictive for select to authenticated using (
  exists(select 1 from public.inventory_items i where i.item_id=inventory_alert_outbox.item_id and public.can_read_full_inventory(i.division_key,i.inventory_area)));
drop policy if exists "Employee projection only" on public.operations_agent_actions;
create policy "Employee projection only" on public.operations_agent_actions as restrictive for select to authenticated using (public.can_read_full_agent_action(action_type,parameters));

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
  return case when public.can_read_full_walls_production() then to_jsonb(v_row) else public.employee_production_row_projection('assignment',to_jsonb(v_row)) end;
end;
$$;

create or replace function public.update_walls_production_setup_progress(p_assignment_id uuid,p_setup_progress integer,p_note text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_production_assignments%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.walls_production_permission('setup') then raise exception 'Setup permission required'; end if;
  if p_setup_progress is null or p_setup_progress<1 or p_setup_progress>99 then raise exception 'Setup progress must be between 1 and 99 percent'; end if;
  update public.walls_production_assignments set setup_progress=p_setup_progress,
    notes=case when trim(coalesce(p_note,''))<>'' then concat_ws(E'\n',nullif(notes,''),trim(p_note)) else notes end
    where assignment_id=p_assignment_id and stage='setup_in_progress' returning * into v_row;
  if not found then raise exception 'Only setup in progress can receive a progress update'; end if;
  insert into public.walls_production_events(assignment_id,event_type,previous_stage,new_stage,detail,actor_email)
    values(p_assignment_id,'setup_progress','setup_in_progress','setup_in_progress',jsonb_build_object('setup_progress',p_setup_progress,'note',coalesce(p_note,'')),v_actor);
  return case when public.can_read_full_walls_production() then to_jsonb(v_row) else public.employee_production_row_projection('assignment',to_jsonb(v_row)) end;
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
    if v_row.version is distinct from p_expected_version then raise exception 'Production assignment version conflict'; end if;
    if v_row.stage<>'planned' then raise exception 'Started production must be preserved; only planned assignments can be rescheduled'; end if;
    update public.walls_production_assignments set wall_record_id=p_wall_record_id,table_id=p_table_id,wall_height=p_wall_height,planned_lf=p_planned_lf,
      setup_start_at=p_setup_start_at,pour_at=p_pour_at,strip_at=p_strip_at,notes=coalesce(p_notes,''),needs_review=false,review_reason=''
      where assignment_id=p_assignment_id returning * into v_row;
    insert into public.walls_production_events(assignment_id,event_type,previous_stage,new_stage,detail,actor_email) values(v_row.assignment_id,'assignment_updated','planned','planned',jsonb_build_object('planned_lf',p_planned_lf,'table_id',p_table_id),v_actor);
  end if;
  return case when public.can_read_full_walls_production() then to_jsonb(v_row) else public.employee_production_row_projection('assignment',to_jsonb(v_row)) end;
end;
$$;

create or replace function public.cancel_walls_production_assignment(
  p_assignment_id uuid,
  p_reason text default 'Entered by mistake'
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_old public.walls_production_assignments%rowtype;
  v_row public.walls_production_assignments%rowtype;
  v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
  v_reason text:=trim(coalesce(p_reason,''));
begin
  if not public.walls_production_permission('assign') then
    raise exception 'Table-assignment permission required';
  end if;
  if length(v_reason)<3 then
    raise exception 'A short cancellation reason is required';
  end if;

  select * into v_old
  from public.walls_production_assignments
  where assignment_id=p_assignment_id
  for update;

  if not found then raise exception 'Production assignment not found'; end if;
  if v_old.stage<>'planned' then
    raise exception 'Started production history cannot be deleted; only planned assignments can be removed';
  end if;
  if exists (
    select 1 from public.walls_production_issues
    where assignment_id=p_assignment_id and status='open'
  ) then
    raise exception 'Resolve the production hold before removing this assignment';
  end if;

  update public.walls_production_assignments
  set stage='cancelled',
      notes=concat_ws(E'\n',nullif(notes,''),'Removed from active production plan: '||v_reason),
      needs_review=false,
      review_reason='',
      version=version+1,
      updated_at=now(),
      updated_by=v_actor
  where assignment_id=p_assignment_id
  returning * into v_row;

  insert into public.walls_production_events(
    assignment_id,event_type,previous_stage,new_stage,detail,actor_email
  ) values (
    p_assignment_id,'assignment_cancelled',v_old.stage,'cancelled',jsonb_build_object('reason',v_reason),v_actor
  );

  return case when public.can_read_full_walls_production() then to_jsonb(v_row) else public.employee_production_row_projection('assignment',to_jsonb(v_row)) end;
end;
$$;

create or replace function public.upsert_walls_production_table(p_table_id text,p_label text,p_capacity_lf numeric,p_enabled boolean,p_notes text default '',p_expected_version bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.walls_production_tables%rowtype;v_actor text:=lower(coalesce(auth.jwt()->>'email',''));
begin
  if not public.walls_production_permission('plan') then raise exception 'Production-plan permission required'; end if;
  insert into public.walls_production_tables(table_id,label,capacity_lf,sort_order,enabled,notes,updated_by)
  values(trim(p_table_id),trim(p_label),p_capacity_lf,coalesce((select max(sort_order)+1 from public.walls_production_tables),1),coalesce(p_enabled,true),coalesce(p_notes,''),v_actor)
  on conflict(table_id) do update set label=excluded.label,capacity_lf=excluded.capacity_lf,enabled=excluded.enabled,notes=excluded.notes,updated_at=now(),updated_by=v_actor,version=public.walls_production_tables.version+1
    where p_expected_version is null or public.walls_production_tables.version=p_expected_version
  returning * into v_row;
  if not found then raise exception 'Production table version conflict'; end if;
  return case when public.can_read_full_walls_production() then to_jsonb(v_row) else public.employee_production_row_projection('table',to_jsonb(v_row)) end;
end;
$$;

create or replace function public.report_walls_production_issue(p_assignment_id uuid,p_category text,p_description text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_assignment public.walls_production_assignments%rowtype;v_issue public.walls_production_issues%rowtype;
begin
  if not public.walls_production_permission('issue') then raise exception 'Issue-reporting permission required'; end if;
  select * into v_assignment from public.walls_production_assignments where assignment_id=p_assignment_id;
  if not found then raise exception 'Production assignment not found'; end if;
  insert into public.walls_production_issues(assignment_id,wall_record_id,table_id,category,description)
    values(p_assignment_id,v_assignment.wall_record_id,v_assignment.table_id,p_category,trim(p_description)) returning * into v_issue;
  insert into public.walls_production_events(assignment_id,event_type,previous_stage,new_stage,detail)
    values(p_assignment_id,'issue_reported',v_assignment.stage,v_assignment.stage,jsonb_build_object('issue_id',v_issue.issue_id,'category',p_category));
  return case when public.can_read_full_walls_production() then to_jsonb(v_issue) else public.employee_production_row_projection('issue',to_jsonb(v_issue)) end;
end;
$$;

create or replace function public.resolve_walls_production_issue(p_issue_id bigint,p_resolution_note text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_issue public.walls_production_issues%rowtype;
begin
  if not public.walls_production_permission('plan') then raise exception 'Production-plan permission required'; end if;
  update public.walls_production_issues set status='resolved',resolved_at=now(),resolved_by_user_id=auth.uid(),resolved_by_email=lower(coalesce(auth.jwt()->>'email','')),resolution_note=coalesce(p_resolution_note,'') where issue_id=p_issue_id and status='open' returning * into v_issue;
  if not found then raise exception 'Open production issue not found'; end if;
  return case when public.can_read_full_walls_production() then to_jsonb(v_issue) else public.employee_production_row_projection('issue',to_jsonb(v_issue)) end;
end;
$$;

create or replace function public.create_operations_agent_proposal(
  p_request_text text,p_action_type text,p_parameters jsonb,p_summary text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_action public.operations_agent_actions%rowtype;v_item public.inventory_items%rowtype;v_assignment public.walls_production_assignments%rowtype;
v_stage text;v_required text;v_quantity integer;v_progress integer;v_actual numeric;v_expected bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(btrim(coalesce(p_request_text,''))) not between 1 and 4000 then raise exception 'Request text is required'; end if;
  if length(btrim(coalesce(p_summary,''))) not between 1 and 1000 then raise exception 'Action summary is required'; end if;
  if length(coalesce(p_idempotency_key,'')) not between 8 and 200 then raise exception 'Valid idempotency key required'; end if;
  if p_action_type not in ('set_inventory_count','advance_production_stage','update_setup_progress') then raise exception 'Unsupported agent action'; end if;

  if p_action_type='set_inventory_count' then
    v_quantity:=(p_parameters->>'quantity')::integer;v_expected:=(p_parameters->>'expected_version')::bigint;
    select * into v_item from public.inventory_items where item_id=(p_parameters->>'item_id')::bigint;
    if not found then raise exception 'Inventory item not found'; end if;
    if not public.inventory_item_access(v_item.item_id,'adjust') then raise exception 'Inventory count access required'; end if;
    if v_quantity is null or v_quantity<0 then raise exception 'Quantity must be zero or a positive whole number'; end if;
    if v_expected is null then raise exception 'Inventory version is required'; end if;
    if v_item.version<>v_expected then raise exception 'Inventory version conflict; refresh before proposing the change'; end if;
  elsif p_action_type='advance_production_stage' then
    v_stage:=p_parameters->>'new_stage';v_expected:=(p_parameters->>'expected_version')::bigint;
    if v_stage is null or v_stage not in ('setup_in_progress','setup_complete','poured','curing','stripped') then raise exception 'Unsupported production stage'; end if;
    select * into v_assignment from public.walls_production_assignments where assignment_id=(p_parameters->>'assignment_id')::uuid;
    if not found then raise exception 'Production assignment not found'; end if;
    if v_expected is null or v_assignment.version<>v_expected then raise exception 'Production assignment changed; refresh before proposing the change'; end if;
    if not ((v_assignment.stage='planned' and v_stage='setup_in_progress') or
      (v_assignment.stage='setup_in_progress' and v_stage='setup_complete') or
      (v_assignment.stage='ready_for_pour' and v_stage='poured') or
      (v_assignment.stage='poured' and v_stage='curing') or
      (v_assignment.stage='curing' and v_stage='stripped')) then raise exception 'Only the immediate next routine production stage can be proposed'; end if;
    v_required:=case when v_stage in ('setup_in_progress','setup_complete','ready_for_pour') then 'setup' when v_stage in ('poured','curing') then 'pour' else 'strip' end;
    if not public.walls_production_permission(v_required) then raise exception 'Production stage permission required'; end if;
    if v_stage='poured' then
      v_actual:=(p_parameters->>'actual_lf')::numeric;
      if v_actual is null or v_actual<=0 or v_actual>v_assignment.planned_lf then raise exception 'Actual poured LF must be positive and cannot exceed planned LF'; end if;
    end if;
  else
    v_progress:=(p_parameters->>'setup_progress')::integer;v_expected:=(p_parameters->>'expected_version')::bigint;
    select * into v_assignment from public.walls_production_assignments where assignment_id=(p_parameters->>'assignment_id')::uuid;
    if not found then raise exception 'Production assignment not found'; end if;
    if v_expected is null or v_assignment.version<>v_expected then raise exception 'Production assignment changed; refresh before proposing the change'; end if;
    if not public.walls_production_permission('setup') then raise exception 'Setup permission required'; end if;
    if v_assignment.stage<>'setup_in_progress' or v_progress not between 1 and 99 then raise exception 'Setup progress must be 1-99 for setup in progress'; end if;
  end if;

  insert into public.operations_agent_actions(requested_by_user_id,requested_by_email,request_text,action_type,parameters,summary,idempotency_key)
  values(auth.uid(),lower(coalesce(auth.jwt()->>'email','')),btrim(p_request_text),p_action_type,p_parameters,btrim(p_summary),p_idempotency_key)
  on conflict(requested_by_user_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key
  returning * into v_action;
  return public.employee_agent_action_projection(to_jsonb(v_action));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Agent action parameters are invalid';
end;
$$;

create or replace function public.execute_operations_agent_action(p_action_id uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_action public.operations_agent_actions%rowtype;v_item public.inventory_items%rowtype;v_assignment public.walls_production_assignments%rowtype;
v_result jsonb;v_expected bigint;v_error text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_confirmation is distinct from 'CONFIRM' then raise exception 'Explicit confirmation required'; end if;
  select * into v_action from public.operations_agent_actions where action_id=p_action_id for update;
  if not found or v_action.requested_by_user_id is distinct from auth.uid() then raise exception 'Pending agent action not found'; end if;
  if v_action.status<>'pending' then raise exception 'Agent action is no longer pending'; end if;
  if v_action.expires_at<=now() then
    update public.operations_agent_actions set status='expired',error_message='Confirmation window expired' where action_id=p_action_id;
    return jsonb_build_object('ok',false,'status','expired','message','This action expired. Ask the assistant to prepare it again.');
  end if;
  begin
    v_expected:=(v_action.parameters->>'expected_version')::bigint;
    if v_action.action_type='set_inventory_count' then
      select * into v_item from public.inventory_items where item_id=(v_action.parameters->>'item_id')::bigint for update;
      if not found or v_item.version is distinct from v_expected then raise exception 'Inventory changed after this preview. No action was taken.'; end if;
      v_result:=public.set_inventory_count(v_item.item_id,v_expected,(v_action.parameters->>'quantity')::integer);
    elsif v_action.action_type='advance_production_stage' then
      select * into v_assignment from public.walls_production_assignments where assignment_id=(v_action.parameters->>'assignment_id')::uuid for update;
      if not found or v_assignment.version is distinct from v_expected then raise exception 'Production assignment changed after this preview. No action was taken.'; end if;
      v_result:=public.advance_walls_production_stage(
        v_assignment.assignment_id,v_action.parameters->>'new_stage',nullif(v_action.parameters->>'setup_progress','')::integer,
        nullif(v_action.parameters->>'actual_lf','')::numeric,coalesce((v_action.parameters->>'pre_pour_ready')::boolean,false),coalesce(v_action.parameters->>'note','')
      );
    else
      select * into v_assignment from public.walls_production_assignments where assignment_id=(v_action.parameters->>'assignment_id')::uuid for update;
      if not found or v_assignment.version is distinct from v_expected then raise exception 'Production assignment changed after this preview. No action was taken.'; end if;
      v_result:=public.update_walls_production_setup_progress(v_assignment.assignment_id,(v_action.parameters->>'setup_progress')::integer,coalesce(v_action.parameters->>'note',''));
    end if;
    update public.operations_agent_actions set status='executed',confirmed_at=now(),executed_at=now(),result=v_result,error_message=null where action_id=p_action_id returning * into v_action;
    return jsonb_build_object('ok',true,'status','executed','action',public.employee_agent_action_projection(to_jsonb(v_action)));
  exception when others then
    get stacked diagnostics v_error=message_text;
    update public.operations_agent_actions set status='failed',confirmed_at=now(),error_message=left(v_error,1000) where action_id=p_action_id returning * into v_action;
    return jsonb_build_object('ok',false,'status','failed','message',v_error,'action',public.employee_agent_action_projection(to_jsonb(v_action)));
  end;
end;
$$;

create or replace function public.reject_operations_agent_action(p_action_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_action public.operations_agent_actions%rowtype;
begin
  update public.operations_agent_actions set status='rejected'
  where action_id=p_action_id and requested_by_user_id=auth.uid() and status='pending'
  returning * into v_action;
  if not found then raise exception 'Pending agent action not found'; end if;
  return jsonb_build_object('ok',true,'status','rejected','action',public.employee_agent_action_projection(to_jsonb(v_action)));
end;
$$;

-- The capture command is another response path to an existing frozen baseline.
create or replace function public.employee_forecast_baseline_projection(p_data jsonb)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select public.employee_scalar_fields(p_data,array['week_start','frozen_at'])||jsonb_build_object(
    'baseline_planned_lf',coalesce(sum(case when jsonb_typeof(d->'plannedLf')='number' then (d->>'plannedLf')::numeric else 0 end),0),
    'baseline_assignment_count',count(*),
    'baseline_detail',coalesce(jsonb_agg(public.employee_scalar_fields(d,array['assignmentId','wallRecordId','tableId','tableLabel','wallHeight','plannedLf','pourDate'])
      ||jsonb_build_object('job',public.employee_wall_projection(r.data)->'job','model',public.employee_wall_projection(r.data)->'type')),'[]'::jsonb))
  from jsonb_array_elements(case when jsonb_typeof(p_data->'baseline_detail')='array' then p_data->'baseline_detail' else '[]'::jsonb end) d
  join public.schedule_records r on r.collection='walls' and r.division='walls' and r.record_id=d->>'wallRecordId';
$$;
revoke all on function public.employee_forecast_baseline_projection(jsonb) from public,anon,authenticated;

create or replace function public.capture_walls_production_weekly_forecast(
  p_week_start date,
  p_source text default 'manual'
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_week date:=date_trunc('week',p_week_start::timestamp)::date;
  v_actor text:=lower(coalesce(auth.jwt()->>'email','system'));
  v_total numeric:=0;
  v_count integer:=0;
  v_detail jsonb:='[]'::jsonb;
  v_row public.walls_production_weekly_forecasts%rowtype;
begin
  -- Owner/cron/service execution has no Auth UID; client-role calls must have one.
  if auth.uid() is null and (coalesce(current_setting('role',true),'') in ('authenticated','anon') or coalesce(auth.jwt()->>'role','') in ('authenticated','anon')) then
    raise exception 'Authentication required';
  end if;
  if auth.uid() is not null and not public.walls_production_permission('plan') then
    raise exception 'Production-plan permission required';
  end if;

  select coalesce(sum(a.planned_lf),0),count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'assignmentId',a.assignment_id,
      'wallRecordId',a.wall_record_id,
      'job',coalesce(r.data->>'job',a.wall_record_id),
      'model',coalesce(r.data->>'type',''),
      'tableId',a.table_id,
      'tableLabel',coalesce(t.label,a.table_id),
      'wallHeight',a.wall_height,
      'plannedLf',a.planned_lf,
      'pourDate',a.pour_at::date
    ) order by a.pour_at,a.table_id,a.assignment_id),'[]'::jsonb)
  into v_total,v_count,v_detail
  from public.walls_production_assignments a
  join public.schedule_records r on r.collection='walls' and r.record_id=a.wall_record_id
  left join public.walls_production_tables t on t.table_id=a.table_id
  where a.stage<>'cancelled' and a.pour_at::date between v_week and v_week+6;

  insert into public.walls_production_weekly_forecasts(
    week_start,baseline_planned_lf,baseline_assignment_count,baseline_detail,frozen_by,source
  ) values(
    v_week,v_total,v_count,v_detail,v_actor,left(coalesce(nullif(trim(p_source),''),'manual'),80)
  ) on conflict (week_start) do nothing;

  select * into v_row from public.walls_production_weekly_forecasts where week_start=v_week;
  return case when auth.uid() is null or public.can_read_full_walls_production() then to_jsonb(v_row) else public.employee_forecast_baseline_projection(to_jsonb(v_row)) end;
end;
$$;

commit;
