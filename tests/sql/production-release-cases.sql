\set ON_ERROR_STOP on
-- Run after fixture and the ACTUAL migration, in the same psql session.
do $$
declare
  payload jsonb; pair text[]; rejected boolean; count_before integer; result jsonb;
  id constant uuid := '11111111-1111-1111-1111-111111111111';
  cases integer := 0;
begin
  foreach pair slice 1 in array array[
    ['planned','setup_in_progress'], ['setup_in_progress','setup_complete'],
    ['setup_complete','ready_for_pour'], ['ready_for_pour','poured'],
    ['poured','curing'], ['curing','stripped']
  ] loop
    for payload in select value from jsonb_array_elements('[
      {}, {"planReview":null}, {"planReview":{}},
      {"planReview":{"stages":{}}},
      {"planReview":{"stages":{"approvedProduction":{}}}},
      {"planReview":{"stages":{"approvedProduction":{"status":null}}}},
      {"planReview":{"stages":{"approvedProduction":{"status":""}}}},
      {"planReview":{"stages":{"approvedProduction":{"status":"Not Started"}}}}
    ]'::jsonb) loop
      update public.schedule_records set data=payload;
      update public.walls_production_assignments set stage=pair[1];
      select count(*) into count_before from public.walls_production_events;
      rejected:=false;
      begin
        perform public.advance_walls_production_stage(id,pair[2],1,50,true,'fixture');
      exception when raise_exception then
        if sqlerrm<>'Job is not released for production' then raise; end if;
        rejected:=true;
      end;
      if not rejected then raise exception 'FAIL: accepted missing/incomplete release: %, %',pair,payload; end if;
      if (select stage from public.walls_production_assignments where assignment_id=id)<>pair[1]
        or (select count(*) from public.walls_production_events)<>count_before then
        raise exception 'FAIL: rejected transition changed assignment or audit events';
      end if;
      cases:=cases+1;
    end loop;
    update public.schedule_records set data='{"planReview":{"stages":{"approvedProduction":{"status":"Complete"}}}}';
    result:=public.advance_walls_production_stage(id,pair[2],1,50,true,'fixture');
    if result->>'stage'<>pair[2] or (select count(*) from public.walls_production_events)<>count_before+1 then
      raise exception 'FAIL: valid release failed transition/event check: %',pair;
    end if;
    cases:=cases+1;
  end loop;
  -- Missing parent schedule data must also fail closed, not just missing JSON evidence.
  -- The minimal fixture deliberately allows this orphan to exercise the RPC boundary.
  delete from public.schedule_records where collection='walls' and record_id='fixture-job';
  update public.walls_production_assignments set stage='planned';
  select count(*) into count_before from public.walls_production_events;
  rejected:=false;
  begin
    perform public.advance_walls_production_stage(id,'setup_in_progress');
  exception when raise_exception then
    if sqlerrm<>'Job is not released for production' then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'FAIL: missing schedule row accepted'; end if;
  if (select stage from public.walls_production_assignments where assignment_id=id)<>'planned'
    or (select count(*) from public.walls_production_events)<>count_before then
    raise exception 'FAIL: missing schedule row rejection changed assignment or audit events';
  end if;
  cases:=cases+1;
  insert into public.schedule_records values
    ('walls','fixture-job','{"planReview":{"stages":{"approvedProduction":{"status":"Complete"}}}}');
  -- Permission and stage checks must remain authoritative even with valid release.
  update public.walls_production_assignments set stage='planned';
  perform set_config('test.production_permission','false',true);
  rejected:=false;
  begin
    perform public.advance_walls_production_stage(id,'setup_in_progress');
  exception when raise_exception then
    if sqlerrm<>'Production stage permission required' then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'FAIL: permission denial ignored'; end if;
  perform set_config('test.production_permission','true',true);
  rejected:=false;
  begin
    perform public.advance_walls_production_stage(id,'poured',1,50,true);
  exception when raise_exception then
    if sqlerrm<>'Production stages must advance in order' then raise; end if;
    rejected:=true;
  end;
  if not rejected then raise exception 'FAIL: stage order ignored'; end if;
  raise notice 'PASS: % release cases plus permission and stage-order controls',cases;
end;
$$;
rollback;
