-- Read-only, opt-in employee view of an approved division pack. No grants/data change.
-- Generated with Supabase CLI 2.122.0. Production application requires approval.
begin;

-- Privileged code lives outside the exposed public API schema. The public RPC
-- is SECURITY INVOKER; both direct and wrapped calls enforce the same authority.
create schema if not exists employee_pack_private;
revoke all on schema employee_pack_private from public,anon,authenticated;
grant usage on schema employee_pack_private to authenticated;

-- Never stringify an object/array from a frozen JSON snapshot into a text field.
create or replace function employee_pack_private.pack_text(p_data jsonb,p_key text)
returns text language sql immutable security invoker set search_path=pg_catalog as $$
  select case when jsonb_typeof(p_data->p_key)='string' then p_data->>p_key else '' end;
$$;
revoke all on function employee_pack_private.pack_text(jsonb,text) from public,anon,authenticated;

create or replace function employee_pack_private.approved_crew_packs(p_week_start date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare
  v_pack public.weekly_planner_packs%rowtype;
  v_sections jsonb;
  v_result jsonb:=jsonb_build_object('permissions',jsonb_build_object('view',true,'edit',false,'approve',false,'publish',false),'packs','[]'::jsonb);
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' or not exists (
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
  -- Some operational writers do not invalidate is_active. Compare the current
  -- source exactly once; this pure internal hash never returns underlying data
  -- or invokes generation/rebuild. Do not mistake stored approval for freshness.
  if v_pack.source_fingerprint is distinct from public.weekly_planner_source_fingerprint(p_week_start) then return v_result; end if;
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
revoke all on function employee_pack_private.approved_crew_packs(date) from public,anon,authenticated;
grant execute on function employee_pack_private.approved_crew_packs(date) to authenticated;

create or replace function public.get_employee_approved_crew_packs(p_week_start date)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select employee_pack_private.approved_crew_packs(p_week_start);
$$;
revoke all on function public.get_employee_approved_crew_packs(date) from public,anon,authenticated;
grant execute on function public.get_employee_approved_crew_packs(date) to authenticated;

-- No changes to weekly_planner_permission, its RLS, admin/supervisor RPCs,
-- app_employee_access rows, or weekly_planner_access rows are made here.
commit;
