-- Null-safe optimistic concurrency guard; all existing permissions and gates preserved.
-- Recreates the committed function with exactly one predicate change. No operational DML.
create or replace function public.save_schedule_snapshot(p_expected_revision bigint,p_snapshot jsonb,p_reason text default 'Saved')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_meta public.schedule_meta%rowtype; v_next bigint; v_actor text:=coalesce(auth.jwt()->>'email','authorized editor'); v_data jsonb;
begin
  if not public.can_edit_schedule() then raise exception 'Read-only account'; end if;
  select * into v_meta from public.schedule_meta where id=1 for update;
  if v_meta.revision is distinct from p_expected_revision then raise exception 'Revision conflict'; end if;
  perform public.enforce_schedule_gates(p_snapshot);
  perform public.replace_schedule_records(p_snapshot,v_actor);
  v_next:=v_meta.revision+1;
  update public.schedule_meta set revision=v_next,schema_version=35,updated_at=now(),updated_by=v_actor where id=1 returning * into v_meta;
  v_data:=public.compose_schedule_data();
  insert into public.schedule_revision_backups(revision,schema_version,payload,payload_fingerprint,created_by,reason)
  values(v_next,35,jsonb_build_object('schemaVersion',35,'data',v_data),md5(v_data::text),v_actor,coalesce(nullif(p_reason,''),'Saved')) on conflict (revision) do nothing;
  return jsonb_build_object('id',1,'revision',v_next,'updated_at',v_meta.updated_at,'updated_by',v_actor,'payload',jsonb_build_object('schemaVersion',35,'data',v_data));
end;
$$;
