-- Frozen weekly production baselines and read-only planned-versus-actual reporting.
-- Additive only: existing schedules, assignments, events, permissions, and operating records are preserved.
-- Prepared by Scout for Wes Borgen

create table if not exists public.walls_production_weekly_forecasts (
  week_start date primary key,
  baseline_planned_lf numeric not null default 0 check (baseline_planned_lf >= 0),
  baseline_assignment_count integer not null default 0 check (baseline_assignment_count >= 0),
  baseline_detail jsonb not null default '[]'::jsonb,
  frozen_at timestamptz not null default now(),
  frozen_by text not null default 'system',
  source text not null default 'automatic'
);

alter table public.walls_production_weekly_forecasts enable row level security;

drop policy if exists "Authorized users view weekly production forecasts" on public.walls_production_weekly_forecasts;
create policy "Authorized users view weekly production forecasts"
on public.walls_production_weekly_forecasts for select to authenticated
using (public.walls_production_permission('view'));

revoke all on public.walls_production_weekly_forecasts from anon;
revoke insert,update,delete on public.walls_production_weekly_forecasts from authenticated;
grant select on public.walls_production_weekly_forecasts to authenticated;

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
  return to_jsonb(v_row);
end;
$$;

create or replace function public.capture_current_walls_production_weekly_forecast()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_today date:=(now() at time zone 'America/Chicago')::date;
begin
  return public.capture_walls_production_weekly_forecast(
    date_trunc('week',v_today::timestamp)::date,
    'automatic-week-start'
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

  select coalesce(sum(a.planned_lf),0) into v_current
  from public.walls_production_assignments a
  where a.stage<>'cancelled' and a.pour_at::date between v_week and v_week+6;

  select coalesce(sum(e.actual_lf),0) into v_actual
  from public.walls_production_events e
  where e.event_type='stage_changed' and e.new_stage='poured'
    and (e.occurred_at at time zone 'America/Chicago')::date between v_week and v_week+6;

  return jsonb_build_object(
    'weekStart',v_week,
    'weekEnd',v_week+6,
    'baseline',case when v_baseline.week_start is null then null else to_jsonb(v_baseline) end,
    'currentPlannedLf',v_current,
    'actualPouredLf',v_actual,
    'daily',coalesce((
      select jsonb_agg(jsonb_build_object(
        'date',d.day::date,
        'plannedLf',coalesce((select sum(a.planned_lf) from public.walls_production_assignments a where a.stage<>'cancelled' and a.pour_at::date=d.day::date),0),
        'actualLf',coalesce((select sum(e.actual_lf) from public.walls_production_events e where e.event_type='stage_changed' and e.new_stage='poured' and (e.occurred_at at time zone 'America/Chicago')::date=d.day::date),0)
      ) order by d.day)
      from generate_series(v_week::timestamp,(v_week+6)::timestamp,interval '1 day') d(day)
    ),'[]'::jsonb),
    'assignments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignmentId',a.assignment_id,
        'wallRecordId',a.wall_record_id,
        'job',coalesce(r.data->>'job',a.wall_record_id),
        'model',coalesce(r.data->>'type',''),
        'project',coalesce(r.data->>'project',r.data->>'development',''),
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
      where a.stage<>'cancelled' and (
        a.pour_at::date between v_week and v_week+6 or x.actual_date between v_week and v_week+6
      )
    ),'[]'::jsonb),
    'generatedAt',now()
  );
end;
$$;

revoke all on function public.capture_walls_production_weekly_forecast(date,text),public.capture_current_walls_production_weekly_forecast(),public.get_walls_production_weekly_forecast(date) from public,anon;
grant execute on function public.capture_walls_production_weekly_forecast(date,text),public.get_walls_production_weekly_forecast(date) to authenticated;

select public.capture_walls_production_weekly_forecast(
  date_trunc('week',(now() at time zone 'America/Chicago')::date::timestamp)::date,
  'implementation-baseline'
);

do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='walls-production-weekly-baseline';
    perform cron.schedule(
      'walls-production-weekly-baseline',
      '5 * * * *',
      'select public.capture_current_walls_production_weekly_forecast();'
    );
  end if;
end $$;

comment on table public.walls_production_weekly_forecasts is 'Immutable Superior Walls weekly planned-LF baselines used for forecast accuracy reporting.';
comment on function public.get_walls_production_weekly_forecast(date) is 'Returns frozen baseline, current plan, recorded actual LF, daily totals, and assignment detail for a selected production week.';
