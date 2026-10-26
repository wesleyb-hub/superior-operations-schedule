-- Local candidate only. Generated with Supabase CLI 2.122.0.
-- No identities, credentials, owner memberships or business grants are seeded.
-- Alias state does NOT revoke Auth sessions or business permissions. See the rollout runbook.
begin;

create schema employee_login;
revoke all on schema employee_login from public,anon,authenticated,service_role;
alter default privileges in schema employee_login revoke all on tables from public,anon,authenticated,service_role;
alter default privileges in schema employee_login revoke all on functions from public,anon,authenticated,service_role;

create table employee_login.owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);
create table employee_login.aliases (
  username text primary key check (username collate "C" ~ '^[a-z][a-z0-9._-]{2,31}$'
    and username not in ('admin','administrator','owner','root','system','support')),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  state text not null default 'setup_required' check(state in ('setup_required','active','pending','processing','failed')),
  code_hash text check(code_hash collate "C" ~ '^[a-f0-9]{64}$'),
  code_id uuid,
  expires_at timestamptz,
  claim_id uuid,
  confirm_email boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state='pending' and code_hash is not null and code_id is not null and expires_at is not null)
    or (state<>'pending' and code_hash is null and code_id is null and expires_at is null)),
  check (state<>'processing' or claim_id is not null)
);
create table employee_login.throttles (
  bucket_key text primary key check(bucket_key collate "C" ~ '^[a-f0-9]{64}$'),
  attempts integer not null check(attempts between 1 and 1001),
  expires_at timestamptz not null
);
create index employee_login_throttles_expiry on employee_login.throttles(expires_at);
create table employee_login.audit (
  event_id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event text not null check(event in ('sign_in','issue','redeem','disable')),
  outcome text not null check(outcome in ('succeeded','denied','failed')),
  confirm_email boolean not null default false,
  actor uuid references auth.users(id) on delete set null,
  target uuid references auth.users(id) on delete set null
);
create index employee_login_audit_time on employee_login.audit(occurred_at);
alter table employee_login.owners enable row level security;
alter table employee_login.aliases enable row level security;
alter table employee_login.throttles enable row level security;
alter table employee_login.audit enable row level security;
revoke all on all tables in schema employee_login from public,anon,authenticated,service_role;
revoke all on all sequences in schema employee_login from public,anon,authenticated,service_role;

-- The API role ACL is the primary boundary; this guard also rejects accidental grants.
-- PostgREST sets the actual SQL role; neither a submitted UID nor user_metadata is trusted.
create function employee_login.require_service()
returns void language plpgsql stable security invoker set search_path=pg_catalog as $$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception using errcode='42501',message='Access request unavailable';
  end if;
end;
$$;
create function employee_login.normalized(p_username text)
returns text language sql immutable security invoker set search_path=pg_catalog as $$
  select case when lower(btrim(p_username)) collate "C" ~ '^[a-z][a-z0-9._-]{2,31}$'
    and lower(btrim(p_username)) not in ('admin','administrator','owner','root','system','support') then lower(btrim(p_username)) else null end;
$$;
create function employee_login.owner_allowed(p_actor uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select p_actor is not null and exists(
    select 1 from employee_login.owners o join public.app_user_roles r on r.user_id=o.user_id
      join auth.users u on u.id=o.user_id
    where o.user_id=p_actor and o.enabled and r.can_write and not coalesce(u.is_anonymous,false)
  );
$$;
create function employee_login.target_allowed(p_uid uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select p_uid is not null
    and exists(select 1 from auth.users u where u.id=p_uid and not coalesce(u.is_anonymous,false))
    and exists(select 1 from public.app_employee_access a where a.user_id=p_uid and a.enabled)
    and not exists(select 1 from public.app_user_roles r where r.user_id=p_uid)
    and not exists(select 1 from employee_login.owners o where o.user_id=p_uid);
$$;

create function public.employee_login_check_owner(p_actor uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  perform employee_login.require_service();
  return employee_login.owner_allowed(p_actor);
end;
$$;
create function public.employee_login_list(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  perform employee_login.require_service();
  if not employee_login.owner_allowed(p_actor) then raise exception using errcode='42501',message='Access request unavailable'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('username',a.username,'user_id',a.user_id,
    'enabled',a.enabled and employee_login.target_allowed(a.user_id),'status',a.state) order by a.username)
    from employee_login.aliases a),'[]'::jsonb);
end;
$$;
create function public.employee_login_resolve(p_username text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  perform employee_login.require_service();
  return (select jsonb_build_object('user_id',a.user_id,'username',a.username)
    from employee_login.aliases a where a.username=employee_login.normalized(p_username)
      and a.enabled and a.state='active' and employee_login.target_allowed(a.user_id));
end;
$$;

-- Independent fixed-window buckets survive worker restarts. Always increment every
-- supplied bucket in sorted order, including denied attempts; no rollback-on-deny.
-- Edge first consumes a global bucket, then IP/username buckets to bound key churn.
create function public.employee_login_throttle(p_keys text[],p_limit integer,p_window_seconds integer)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_key text;v_count integer;v_allowed boolean:=true;v_now timestamptz:=clock_timestamp();
begin
  perform employee_login.require_service();
  if coalesce(cardinality(p_keys),0) not between 1 and 4 or p_limit is null or p_limit not between 1 and 1000
    or p_window_seconds is null or p_window_seconds not between 60 and 3600
    or exists(select 1 from unnest(p_keys) k where k is null or k collate "C" !~ '^[a-f0-9]{64}$') then
    raise exception using errcode='22023',message='Invalid throttle parameters';
  end if;
  for v_key in select distinct k from unnest(p_keys) k order by k loop
    insert into employee_login.throttles(bucket_key,attempts,expires_at)
    values(v_key,1,v_now+make_interval(secs=>p_window_seconds))
    on conflict(bucket_key) do update set
      attempts=case when employee_login.throttles.expires_at<=v_now then 1 else least(employee_login.throttles.attempts+1,1001) end,
      expires_at=case when employee_login.throttles.expires_at<=v_now then excluded.expires_at else employee_login.throttles.expires_at end
    returning attempts into v_count;
    if v_count>p_limit then v_allowed:=false; end if;
  end loop;
  -- Bounded retention cleanup; hashes are not kept as a long-lived IP history.
  delete from employee_login.throttles where expires_at<v_now-interval '1 day' and bucket_key in (
    select bucket_key from employee_login.throttles where expires_at<v_now-interval '1 day'
      order by expires_at limit 100 for update skip locked
  );
  return v_allowed;
end;
$$;

create function public.employee_login_issue(p_actor uuid,p_username text,p_code_hash text,p_code_id uuid,p_confirm_email boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_alias employee_login.aliases%rowtype;v_expires timestamptz;
begin
  perform employee_login.require_service();
  if not employee_login.owner_allowed(p_actor) then raise exception using errcode='42501',message='Access request unavailable'; end if;
  if p_code_hash is null or p_code_hash collate "C" !~ '^[a-f0-9]{64}$' or p_code_id is null or p_confirm_email is null then
    raise exception using errcode='22023',message='Access request unavailable';
  end if;
  select * into v_alias from employee_login.aliases where username=employee_login.normalized(p_username) for update;
  if not found or not v_alias.enabled or v_alias.state in ('processing','failed') or not employee_login.target_allowed(v_alias.user_id) then
    insert into employee_login.audit(event,outcome,actor,target) values('issue','denied',p_actor,v_alias.user_id);
    return null;
  end if;
  v_expires:=clock_timestamp()+interval '10 minutes';
  update employee_login.aliases set state='pending',code_hash=p_code_hash,code_id=p_code_id,expires_at=v_expires,
    claim_id=null,confirm_email=p_confirm_email,updated_at=clock_timestamp() where username=v_alias.username;
  insert into employee_login.audit(event,outcome,actor,target,confirm_email) values('issue','succeeded',p_actor,v_alias.user_id,p_confirm_email);
  return jsonb_build_object('username',v_alias.username,'expires_at',v_expires);
end;
$$;

-- Consume before any external Auth update. An interrupted/uncertain worker must
-- never make this code usable again. Processing/failed require inspected recovery.
create function public.employee_login_claim(p_username text,p_code_hash text,p_claim_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_alias employee_login.aliases%rowtype;
begin
  perform employee_login.require_service();
  if p_claim_id is null then return null; end if;
  select * into v_alias from employee_login.aliases where username=employee_login.normalized(p_username) for update;
  if not found or not v_alias.enabled or v_alias.state<>'pending' or v_alias.code_hash is distinct from p_code_hash
    or v_alias.expires_at<=clock_timestamp() or not employee_login.target_allowed(v_alias.user_id) then
    insert into employee_login.audit(event,outcome,target) values('redeem','denied',v_alias.user_id);
    return null;
  end if;
  update employee_login.aliases set state='processing',code_hash=null,code_id=null,expires_at=null,
    claim_id=p_claim_id,updated_at=clock_timestamp() where username=v_alias.username;
  return jsonb_build_object('user_id',v_alias.user_id,'confirm_email',v_alias.confirm_email);
end;
$$;
create function public.employee_login_finish(p_uid uuid,p_claim_id uuid,p_success boolean)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_alias employee_login.aliases%rowtype;v_success boolean;
begin
  perform employee_login.require_service();
  select * into v_alias from employee_login.aliases where user_id=p_uid for update;
  if not found or v_alias.state<>'processing' or p_claim_id is null or v_alias.claim_id is distinct from p_claim_id then return false; end if;
  v_success:=coalesce(p_success,false) and v_alias.enabled and employee_login.target_allowed(v_alias.user_id);
  update employee_login.aliases set state=case when v_success then 'active' else 'failed' end,
    confirm_email=false,updated_at=clock_timestamp() where user_id=p_uid;
  insert into employee_login.audit(event,outcome,target) values('redeem',case when v_success then 'succeeded' else 'failed' end,p_uid);
  return v_success;
end;
$$;
create function public.employee_login_disable(p_actor uuid,p_username text)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_alias employee_login.aliases%rowtype;
begin
  perform employee_login.require_service();
  if not employee_login.owner_allowed(p_actor) then raise exception using errcode='42501',message='Access request unavailable'; end if;
  select * into v_alias from employee_login.aliases where username=employee_login.normalized(p_username) for update;
  if not found or v_alias.state='processing' then
    insert into employee_login.audit(event,outcome,actor,target) values('disable','denied',p_actor,v_alias.user_id);
    return false;
  end if;
  update employee_login.aliases set enabled=false,state=case when v_alias.state='failed' then 'failed' else 'setup_required' end,
    code_hash=null,code_id=null,expires_at=null,
    claim_id=case when v_alias.state='failed' then v_alias.claim_id else null end,
    confirm_email=false,updated_at=clock_timestamp() where username=v_alias.username;
  insert into employee_login.audit(event,outcome,actor,target) values('disable','succeeded',p_actor,v_alias.user_id);
  return true;
end;
$$;
-- Only the Edge handler may call this after receiving Auth update's definitive
-- weak_password validation rejection. NEVER use for timeout/network/unknown errors.
-- The old code remains consumed; an owner must issue a fresh one.
create function public.employee_login_password_rejected(p_uid uuid,p_claim_id uuid)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_alias employee_login.aliases%rowtype;v_retryable boolean;
begin
  perform employee_login.require_service();
  select * into v_alias from employee_login.aliases where user_id=p_uid for update;
  if not found or v_alias.state<>'processing' or p_claim_id is null or v_alias.claim_id is distinct from p_claim_id then return false; end if;
  v_retryable:=v_alias.enabled and employee_login.target_allowed(p_uid);
  update employee_login.aliases set state=case when v_retryable then 'setup_required' else 'failed' end,
    claim_id=case when v_retryable then null else claim_id end,confirm_email=false,updated_at=clock_timestamp() where user_id=p_uid;
  insert into employee_login.audit(event,outcome,target) values('redeem','failed',p_uid);
  return v_retryable;
end;
$$;
create function public.employee_login_audit(p_event text,p_outcome text,p_actor uuid default null,p_target uuid default null)
returns void language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
  perform employee_login.require_service();
  -- Other lifecycle events are recorded atomically with their state transition.
  if p_event is distinct from 'sign_in' or p_outcome is null or p_outcome not in ('succeeded','denied','failed') then
    raise exception using errcode='22023',message='Invalid audit event';
  end if;
  insert into employee_login.audit(event,outcome,actor,target) values(p_event,p_outcome,p_actor,p_target);
end;
$$;

-- This is an identity check, NOT a permission grant. Existing role/projection
-- endpoints continue to decide what the signed-in user may read or change.
create function public.get_employee_login_access()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_uid uuid:=auth.uid();v_alias employee_login.aliases%rowtype;
begin
  if v_uid is null then raise exception using errcode='42501',message='Access request unavailable'; end if;
  select * into v_alias from employee_login.aliases where user_id=v_uid;
  if not found then return jsonb_build_object('managed',false,'enabled',false,'status','unmanaged','username',null); end if;
  return jsonb_build_object('managed',true,'enabled',v_alias.enabled and v_alias.state='active' and employee_login.target_allowed(v_uid),
    'status',case when not v_alias.enabled then 'disabled' else v_alias.state end,'username',v_alias.username);
end;
$$;

revoke all on all functions in schema employee_login from public,anon,authenticated,service_role;
revoke all on function public.employee_login_check_owner(uuid),public.employee_login_list(uuid),public.employee_login_resolve(text),
  public.employee_login_throttle(text[],integer,integer),public.employee_login_issue(uuid,text,text,uuid,boolean),
  public.employee_login_claim(text,text,uuid),public.employee_login_finish(uuid,uuid,boolean),public.employee_login_disable(uuid,text),
  public.employee_login_password_rejected(uuid,uuid),public.employee_login_audit(text,text,uuid,uuid),public.get_employee_login_access() from public,anon,authenticated,service_role;
grant execute on function public.employee_login_check_owner(uuid),public.employee_login_list(uuid),public.employee_login_resolve(text),
  public.employee_login_throttle(text[],integer,integer),public.employee_login_issue(uuid,text,text,uuid,boolean),
  public.employee_login_claim(text,text,uuid),public.employee_login_finish(uuid,uuid,boolean),public.employee_login_disable(uuid,text),
  public.employee_login_password_rejected(uuid,uuid),public.employee_login_audit(text,text,uuid,uuid) to service_role;
grant execute on function public.get_employee_login_access() to authenticated;

comment on schema employee_login is 'Private managed employee aliases and reset state; never expose via Data API. No passwords or tokens.';
comment on table employee_login.owners is 'Explicit approved credential operators only; can_write alone never grants membership.';
comment on function public.employee_login_disable(uuid,text) is 'Alias sign-in only. This does not revoke Auth tokens or business grants and is not employee offboarding.';
commit;
