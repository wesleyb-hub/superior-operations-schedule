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

-- Compare the plan that was actually generated/reviewed, not volatile execution
-- state or the companywide source hash. Legacy generation already recorded this
-- baseline under the pack's approved fingerprint; never seed it from today's data.
-- No hashes, underlying rows, or diagnostics are exposed to an employee caller.
create or replace function employee_pack_private.production_plan_matches(p_week_start date,p_fingerprint text,p_published_at timestamptz)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog as $$
declare v_baseline jsonb;
begin
  if (select count(*) from public.weekly_planner_source_snapshots s
      where s.week_start=p_week_start and s.source_fingerprint=p_fingerprint)<>1 then return false; end if;
  select s.source_data->'walls_production' into v_baseline
  from public.weekly_planner_source_snapshots s
  where s.week_start=p_week_start and s.source_fingerprint=p_fingerprint
    and s.created_at<=p_published_at;
  if not found or jsonb_typeof(v_baseline) is distinct from 'array' then return false; end if;
  if (select count(distinct b->>'assignment_id') from jsonb_array_elements(v_baseline) b)
      <>jsonb_array_length(v_baseline) then return false; end if;

  -- Match every historical row to its present authoritative Walls target. Missing
  -- fields, wrong JSON types, cancellation, deletion, and changed plan values fail
  -- closed. JSON equality uses native numeric/timestamp serialization, not casts
  -- from malformed snapshot strings. No filter silently drops a baseline row.
  if exists (
    select 1 from jsonb_array_elements(v_baseline) b
    where jsonb_typeof(b) is distinct from 'object'
      or jsonb_typeof(b->'planned_lf') is distinct from 'number'
      or jsonb_typeof(b->'wall_height') is distinct from 'number'
      or b->>'stage' not in ('planned','setup_in_progress','setup_complete','ready_for_pour','poured','curing','stripped')
      or jsonb_typeof(b->'stage') is distinct from 'string'
      or jsonb_typeof(b->'needs_review') is distinct from 'boolean'
      or jsonb_typeof(b->'review_reason') is distinct from 'string'
      or not exists (
        select 1 from public.walls_production_assignments a
        join public.schedule_records r on r.collection=a.schedule_collection and r.record_id=a.wall_record_id and r.division='walls'
        where a.assignment_id::text=b->>'assignment_id' and a.stage<>'cancelled'
          and isfinite(a.setup_start_at) and isfinite(a.pour_at) and isfinite(a.strip_at)
          and a.setup_start_at::date<=p_week_start+4 and a.strip_at::date>=p_week_start
          and jsonb_build_array(b->'assignment_id',b->'schedule_collection',b->'wall_record_id',b->'table_id',
            b->'wall_height',b->'planned_lf',b->'setup_start_at',b->'pour_at',b->'strip_at')
            =jsonb_build_array(a.assignment_id,a.schedule_collection,a.wall_record_id,a.table_id,
              a.wall_height,a.planned_lf,a.setup_start_at,a.pour_at,a.strip_at)
          -- A new/changed explicit hold requires review. Clearing a previously
          -- approved hold or ordinary execution progress does not rewrite a plan.
          and (not a.needs_review or (b->'needs_review'='true'::jsonb and b->>'review_reason'=a.review_reason))
      )
  ) then return false; end if;

  -- Production assignments are constrained to the Walls collection, not other
  -- divisions. A corrupt newly-added target must not disappear through a JOIN.
  if exists (
    select 1 from public.walls_production_assignments a
    where a.stage<>'cancelled' and a.setup_start_at::date<=p_week_start+4 and a.strip_at::date>=p_week_start
      and not exists(select 1 from public.schedule_records r
        where r.collection=a.schedule_collection and r.record_id=a.wall_record_id and r.division='walls')
  ) then return false; end if;

  -- Equality in both directions detects additions (including a move into the
  -- week), not merely edits to IDs that happened to exist at generation time.
  return not exists (
    select 1 from public.walls_production_assignments a
    join public.schedule_records r on r.collection=a.schedule_collection and r.record_id=a.wall_record_id and r.division='walls'
    where a.stage<>'cancelled' and a.setup_start_at::date<=p_week_start+4 and a.strip_at::date>=p_week_start
      and not exists(select 1 from jsonb_array_elements(v_baseline) b where b->>'assignment_id'=a.assignment_id::text)
  );
end;
$$;
revoke all on function employee_pack_private.production_plan_matches(date,text,timestamptz) from public,anon,authenticated;

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
