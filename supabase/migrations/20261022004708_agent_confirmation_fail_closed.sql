-- Fail closed for missing identity, confirmation, and stored preview version.
-- Definition-only repair: no actions, business records, roles, or ACLs are changed.
begin;

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
    return jsonb_build_object('ok',true,'status','executed','action',to_jsonb(v_action));
  exception when others then
    get stacked diagnostics v_error=message_text;
    update public.operations_agent_actions set status='failed',confirmed_at=now(),error_message=left(v_error,1000) where action_id=p_action_id returning * into v_action;
    return jsonb_build_object('ok',false,'status','failed','message',v_error,'action',to_jsonb(v_action));
  end;
end;
$$;

commit;
