-- Controlled write-capable Operations Assistant pilot.
-- Every model-proposed write remains pending until the requesting user explicitly confirms it.
-- Prepared by Scout for Wes Borgen

begin;

create table if not exists public.operations_agent_actions (
  action_id uuid primary key default gen_random_uuid(),
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  requested_by_email text not null,
  request_text text not null check (length(btrim(request_text)) between 1 and 4000),
  action_type text not null check (action_type in ('set_inventory_count','advance_production_stage','update_setup_progress')),
  parameters jsonb not null check (jsonb_typeof(parameters)='object'),
  summary text not null check (length(btrim(summary)) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending','executed','rejected','expired','failed')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '10 minutes',
  confirmed_at timestamptz,
  executed_at timestamptz,
  unique (requested_by_user_id,idempotency_key)
);

create index if not exists operations_agent_actions_requester_idx
  on public.operations_agent_actions(requested_by_user_id,created_at desc);

alter table public.operations_agent_actions enable row level security;
revoke all on public.operations_agent_actions from anon;
revoke insert,update,delete on public.operations_agent_actions from authenticated;
grant select on public.operations_agent_actions to authenticated;

drop policy if exists "Users view their Operations Assistant actions" on public.operations_agent_actions;
create policy "Users view their Operations Assistant actions" on public.operations_agent_actions
for select to authenticated using (requested_by_user_id=auth.uid() or public.is_operations_admin());

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
      'assignment_id',a.assignment_id,'version',a.version,'job_number',r.data->>'job','project',r.data->>'project',
      'model',r.data->>'type','table_id',a.table_id,'wall_height',a.wall_height,'planned_lf',a.planned_lf,
      'actual_poured_lf',a.actual_poured_lf,'stage',a.stage,'setup_progress',a.setup_progress,
      'setup_start_at',a.setup_start_at,'pour_at',a.pour_at,'strip_at',a.strip_at,'needs_review',a.needs_review,
      'permissions',jsonb_build_object('setup',public.walls_production_permission('setup'),'pour',public.walls_production_permission('pour'),'strip',public.walls_production_permission('strip'))
    ) order by a.setup_start_at,a.table_id)
    from public.walls_production_assignments a
    join public.schedule_records r on r.collection=a.schedule_collection and r.record_id=a.wall_record_id
    where a.stage<>'cancelled' and a.strip_at::date>=current_date-7 and a.setup_start_at::date<=current_date+45),'[]'::jsonb)
    else '[]'::jsonb end,
    'generated_at',now()
  );
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
  return to_jsonb(v_action);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Agent action parameters are invalid';
end;
$$;

create or replace function public.execute_operations_agent_action(p_action_id uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_action public.operations_agent_actions%rowtype;v_item public.inventory_items%rowtype;v_assignment public.walls_production_assignments%rowtype;
v_result jsonb;v_expected bigint;v_error text;
begin
  if p_confirmation<>'CONFIRM' then raise exception 'Explicit confirmation required'; end if;
  select * into v_action from public.operations_agent_actions where action_id=p_action_id for update;
  if not found or v_action.requested_by_user_id<>auth.uid() then raise exception 'Pending agent action not found'; end if;
  if v_action.status<>'pending' then raise exception 'Agent action is no longer pending'; end if;
  if v_action.expires_at<=now() then
    update public.operations_agent_actions set status='expired',error_message='Confirmation window expired' where action_id=p_action_id;
    return jsonb_build_object('ok',false,'status','expired','message','This action expired. Ask the assistant to prepare it again.');
  end if;
  begin
    v_expected:=(v_action.parameters->>'expected_version')::bigint;
    if v_action.action_type='set_inventory_count' then
      select * into v_item from public.inventory_items where item_id=(v_action.parameters->>'item_id')::bigint for update;
      if not found or v_item.version<>v_expected then raise exception 'Inventory changed after this preview. No action was taken.'; end if;
      v_result:=public.set_inventory_count(v_item.item_id,v_expected,(v_action.parameters->>'quantity')::integer);
    elsif v_action.action_type='advance_production_stage' then
      select * into v_assignment from public.walls_production_assignments where assignment_id=(v_action.parameters->>'assignment_id')::uuid for update;
      if not found or v_assignment.version<>v_expected then raise exception 'Production assignment changed after this preview. No action was taken.'; end if;
      v_result:=public.advance_walls_production_stage(
        v_assignment.assignment_id,v_action.parameters->>'new_stage',nullif(v_action.parameters->>'setup_progress','')::integer,
        nullif(v_action.parameters->>'actual_lf','')::numeric,coalesce((v_action.parameters->>'pre_pour_ready')::boolean,false),coalesce(v_action.parameters->>'note','')
      );
    else
      select * into v_assignment from public.walls_production_assignments where assignment_id=(v_action.parameters->>'assignment_id')::uuid for update;
      if not found or v_assignment.version<>v_expected then raise exception 'Production assignment changed after this preview. No action was taken.'; end if;
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

create or replace function public.reject_operations_agent_action(p_action_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_action public.operations_agent_actions%rowtype;
begin
  update public.operations_agent_actions set status='rejected'
  where action_id=p_action_id and requested_by_user_id=auth.uid() and status='pending'
  returning * into v_action;
  if not found then raise exception 'Pending agent action not found'; end if;
  return jsonb_build_object('ok',true,'status','rejected','action',to_jsonb(v_action));
end;
$$;

revoke all on function public.get_operations_agent_context(),public.create_operations_agent_proposal(text,text,jsonb,text,text),public.execute_operations_agent_action(uuid,text),public.reject_operations_agent_action(uuid) from public,anon;
grant execute on function public.get_operations_agent_context(),public.create_operations_agent_proposal(text,text,jsonb,text,text),public.execute_operations_agent_action(uuid,text),public.reject_operations_agent_action(uuid) to authenticated;

commit;
