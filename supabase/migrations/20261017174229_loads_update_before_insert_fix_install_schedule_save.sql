-- Avoid firing the delivery INSERT guard for existing load rows during Hub snapshots.
-- Existing loads are updated separately; only genuinely new loads reach INSERT.
-- No operational rows are changed by applying this function definition.
create or replace function public.replace_schedule_records(p_snapshot jsonb, p_actor text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_collection text;
begin
  foreach v_collection in array array['walls','jobs','billing','loads','historyArchive','deliveryHistory','qcHistory'] loop
    delete from public.schedule_records r where r.collection=v_collection and not exists (
      select 1 from jsonb_array_elements(coalesce(p_snapshot->v_collection,'[]'::jsonb)) with ordinality as x(item,ord)
      where coalesce(nullif(x.item->>'id',''),nullif(x.item->>'key',''),md5(x.item::text||':'||x.ord::text))=r.record_id
    );

    if v_collection='loads' then
      update public.schedule_records r
      set ordinal=x.ord::integer,
          division=nullif(coalesce(x.item->>'division',case when v_collection='walls' then 'walls' else null end),''),
          data=x.item,
          updated_at=now(),
          updated_by=p_actor
      from jsonb_array_elements(coalesce(p_snapshot->v_collection,'[]'::jsonb)) with ordinality as x(item,ord)
      where r.collection=v_collection
        and r.record_id=coalesce(nullif(x.item->>'id',''),nullif(x.item->>'key',''),md5(x.item::text||':'||x.ord::text));

      insert into public.schedule_records(collection,record_id,ordinal,division,data,updated_at,updated_by)
      select v_collection,
             coalesce(nullif(x.item->>'id',''),nullif(x.item->>'key',''),md5(x.item::text||':'||x.ord::text)),
             x.ord::integer,
             nullif(coalesce(x.item->>'division',case when v_collection='walls' then 'walls' else null end),''),
             x.item,now(),p_actor
      from jsonb_array_elements(coalesce(p_snapshot->v_collection,'[]'::jsonb)) with ordinality as x(item,ord)
      where not exists (
        select 1 from public.schedule_records r
        where r.collection=v_collection
          and r.record_id=coalesce(nullif(x.item->>'id',''),nullif(x.item->>'key',''),md5(x.item::text||':'||x.ord::text))
      );
    else
      insert into public.schedule_records(collection,record_id,ordinal,division,data,updated_at,updated_by)
      select v_collection,coalesce(nullif(x.item->>'id',''),nullif(x.item->>'key',''),md5(x.item::text||':'||x.ord::text)),x.ord::integer,
        nullif(coalesce(x.item->>'division',case when v_collection='walls' then 'walls' else null end),''),x.item,now(),p_actor
      from jsonb_array_elements(coalesce(p_snapshot->v_collection,'[]'::jsonb)) with ordinality as x(item,ord)
      on conflict (collection,record_id) do update set ordinal=excluded.ordinal,division=excluded.division,data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
    end if;
  end loop;

  insert into public.schedule_change_log(fingerprint,occurred_at,week_key,event_type,actor,detail,source_data)
  select md5(x.item::text),coalesce(nullif(x.item->>'timestamp','')::timestamptz,nullif(x.item->>'date','')::timestamptz,now()),
    x.item->>'weekKey',coalesce(nullif(x.item->>'type',''),'Schedule Change'),coalesce(nullif(x.item->>'user',''),p_actor),coalesce(x.item->>'detail',''),x.item
  from jsonb_array_elements(coalesce(p_snapshot->'audit','[]'::jsonb)) as x(item)
  where coalesce(x.item->>'detail','')<>'' on conflict (fingerprint) do nothing;

  delete from public.schedule_milestones where parent_type='wall' and not exists (
    select 1 from jsonb_array_elements(coalesce(p_snapshot->'walls','[]'::jsonb)) x(item) where x.item->>'id'=schedule_milestones.parent_id
  );
  insert into public.schedule_milestones(parent_type,parent_id,milestone_key,status,evidence_date,owner_role,data,updated_at,updated_by)
  select 'wall',w.item->>'id',stage.key,coalesce(nullif(stage.value->>'status',''),'Not Started'),
    case when coalesce(stage.value->>'date','') ~ '^\d{4}-\d{2}-\d{2}$' then (stage.value->>'date')::date else null end,
    case stage.key when 'structuralReview' then 'Engineering / Drafting' when 'approvedProduction' then 'Superior Walls Manager / Management' else 'Drafting / Project Coordination' end,
    stage.value,now(),p_actor
  from jsonb_array_elements(coalesce(p_snapshot->'walls','[]'::jsonb)) w(item)
  cross join lateral jsonb_each(coalesce(w.item#>'{planReview,stages}','{}'::jsonb)) stage
  where coalesce(w.item->>'id','')<>''
  on conflict (parent_type,parent_id,milestone_key) do update set status=excluded.status,evidence_date=excluded.evidence_date,owner_role=excluded.owner_role,data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by;

  insert into public.schedule_settings(setting_key,value,updated_at,updated_by)
  values ('migrationBackup',p_snapshot->'migrationBackup',now(),p_actor),('systemFlags',coalesce(p_snapshot->'systemFlags','{}'::jsonb),now(),p_actor)
  on conflict (setting_key) do update set value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
end;
$$;
