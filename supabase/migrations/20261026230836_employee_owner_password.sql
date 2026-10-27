-- Disabled local-only owner password candidate. Generated with Supabase CLI 2.122.0.
-- Stores admission/challenge state only: no passwords, JWE, ciphertext, tokens or Auth writes.
begin;
create schema employee_password;
revoke all on schema employee_password from public,anon,authenticated,service_role;
alter default privileges in schema employee_password revoke all on tables from public,anon,authenticated,service_role;
alter default privileges in schema employee_password revoke all on functions from public,anon,authenticated,service_role;
create table employee_password.settings (
 singleton boolean primary key default true check(singleton),
 version bigint not null default 1 check(version>0),enabled boolean not null default false,
 current_key_id text check(current_key_id ~ '^[A-Za-z0-9_-]{1,80}$'),
 audience text check(length(audience) between 1 and 200),
 identifier_domain text check(identifier_domain=lower(identifier_domain) and length(identifier_domain)<=190 and identifier_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
 check(not enabled or (current_key_id is not null and audience is not null and identifier_domain is not null))
);
insert into employee_password.settings(singleton,enabled) values(true,false);
create table employee_password.owners (
 user_id uuid primary key references auth.users(id) on delete cascade,enabled boolean not null default false,
 created_at timestamptz not null default now()
);
create table employee_password.approved_records (
 record_id text primary key check(record_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 auth_uid uuid not null unique references auth.users(id) on delete restrict,
 username text not null unique check(username ~ '^[a-z][a-z0-9._-]{2,31}$' and username not in ('admin','administrator','owner','root','system','support')),
 auth_email text not null unique check(auth_email=lower(auth_email) and length(auth_email)<=254 and auth_email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$'),
 display_name text not null check(length(btrim(display_name)) between 1 and 80),
 version bigint not null default 1 check(version between 1 and 9007199254740991),
 enabled boolean not null default false,setup_completed boolean not null default false,
 reviewed_by uuid not null,reviewed_at timestamptz not null,
 reviewed_grants jsonb not null check(jsonb_typeof(reviewed_grants)='object'),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(split_part(auth_email,'@',1)=username)
);
create table employee_password.challenges (
 challenge_id uuid primary key default gen_random_uuid(),owner_id uuid not null,request_id uuid not null,
 record_id text not null references employee_password.approved_records(record_id) on delete restrict,
 auth_uid uuid not null,record_version bigint not null,record_fingerprint text not null check(record_fingerprint ~ '^[a-f0-9]{64}$'),
 settings_version bigint not null,action text not null check(action in ('initialize','reset')),
 audience text not null,key_id text not null,
 phase text not null default 'prepared' check(phase in ('prepared','applying','applied','rejected','needs_review')),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '120 seconds',
 consumed_at timestamptz,updated_at timestamptz not null default clock_timestamp(),
 unique(owner_id,request_id),check(expires_at>created_at and expires_at<=created_at+interval '121 seconds'),
 check((phase='prepared')=(consumed_at is null))
);
create table employee_password.target_locks (
 auth_uid uuid primary key,challenge_id uuid not null unique references employee_password.challenges(challenge_id) on delete restrict,
 created_at timestamptz not null default clock_timestamp()
);
create table employee_password.budgets (
 bucket text primary key check(bucket='global' or bucket ~ '^(owner|target):[a-f0-9-]{36}$'),
 starts_at timestamptz not null,attempts integer not null check(attempts between 1 and 121)
);
create table employee_password.audit (
 audit_id bigint generated always as identity primary key,actor_id uuid,record_id text,operation_id uuid,
 reviewed_version bigint,event text not null check(event in ('prepared','prepare_denied','applying','applied','rejected','needs_review','record_approved','record_revised')),
 occurred_at timestamptz not null default clock_timestamp()
);
create index employee_password_challenges_record on employee_password.challenges(record_id);
create index employee_password_audit_time on employee_password.audit(occurred_at);
alter table employee_password.settings enable row level security;
alter table employee_password.owners enable row level security;
alter table employee_password.approved_records enable row level security;
alter table employee_password.challenges enable row level security;
alter table employee_password.target_locks enable row level security;
alter table employee_password.budgets enable row level security;
alter table employee_password.audit enable row level security;
revoke all on all tables in schema employee_password from public,anon,authenticated,service_role;
revoke all on all sequences in schema employee_password from public,anon,authenticated,service_role;
create function employee_password.require_service() returns void language plpgsql stable security invoker set search_path=pg_catalog as $$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception using errcode='42501',message='Setup unavailable';
  end if;
end;
$$;
create function employee_password.owner_allowed(p_uid uuid) returns boolean language plpgsql stable security invoker set search_path=pg_catalog as $$
declare v_ok boolean;
begin
  if p_uid is null or not exists(select 1 from employee_password.owners where user_id=p_uid and enabled) then return false; end if;
  -- Explicit nonsecret native fields only. No password/hash/token columns read.
  select not u.is_anonymous and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    into v_ok from auth.users u where u.id=p_uid;
  return coalesce(v_ok,false);
exception when undefined_column or undefined_table then return false;
end;
$$;
create function employee_password.pilot_scope() returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
select '{"enabled":true,"preset":"walls_existing_employee_pilot_v1","division":"walls","production_views":["today","five_day","table_board","weekly_forecast"],"production_write":false,"inventory_counts":true,"inventory_manage":false,"inventory_other_mutations":false,"approved_walls_packs":true,"unapproved_packs":false,"management":false,"purchasing":false,"approvals":false,"other_divisions":[],"independent_grants":[]}'::jsonb;
$$;
create function employee_password.authority_fingerprint() returns text language sql stable security invoker set search_path=pg_catalog as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'functions',(select coalesce(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.proowner::regrole::text,p.prosecdef,p.proconfig,p.proacl::text,md5(pg_get_functiondef(p.oid))) order by p.oid::regprocedure::text),'[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','employee_pack_private','employee_password') and p.prokind='f'),
    'relations',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text) order by n.nspname,c.relname),'[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','employee_password') and c.relkind in ('r','p','v')),
    'policies',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by c.relname,p.polname),'[]'::jsonb)
      from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
    'grant_columns',(select coalesce(jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) order by c.relname,a.attnum),'[]'::jsonb)
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('app_employee_access','app_user_roles','inventory_user_access','walls_production_access','walls_installation_access','weekly_planner_access') and a.attnum>0 and not a.attisdropped)
  )::text,'UTF8')),'hex');
$$;
create function employee_password.current_grants(p_uid uuid,p_email text) returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select jsonb_build_object(
    'employee',coalesce((select jsonb_agg(to_jsonb(a) order by a.division_key,a.inventory_area) from public.app_employee_access a where a.user_id=p_uid),'[]'::jsonb),
    'roles',coalesce((select jsonb_agg(to_jsonb(a) order by a.user_id) from public.app_user_roles a where a.user_id=p_uid),'[]'::jsonb),
    'inventory',coalesce((select jsonb_agg(to_jsonb(a) order by a.division_key,a.inventory_area) from public.inventory_user_access a where a.email=lower(p_email)),'[]'::jsonb),
    'production',coalesce((select jsonb_agg(to_jsonb(a)) from public.walls_production_access a where a.user_id=p_uid),'[]'::jsonb),
    'installation',coalesce((select jsonb_agg(to_jsonb(a)) from public.walls_installation_access a where a.user_id=p_uid),'[]'::jsonb),
    'planner',coalesce((select jsonb_agg(to_jsonb(a)) from public.weekly_planner_access a where a.user_id=p_uid),'[]'::jsonb),
    'authority_fingerprint',employee_password.authority_fingerprint());
$$;
create function employee_password.scope_allowed(p_grants jsonb) returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare v_employee jsonb;
begin
  if jsonb_typeof(p_grants) is distinct from 'object' or jsonb_array_length(p_grants->'employee')<>1
    or p_grants->'roles'<>'[]'::jsonb or p_grants->'inventory'<>'[]'::jsonb or p_grants->'production'<>'[]'::jsonb
    or p_grants->'installation'<>'[]'::jsonb or p_grants->'planner'<>'[]'::jsonb then return false; end if;
  v_employee:=p_grants#>'{employee,0}';
  if (select array_agg(k order by k) from jsonb_object_keys(v_employee) k) is distinct from
    array['allowed_views','allowed_wall_subviews','created_at','division_key','enabled','inventory_area','inventory_can_adjust','inventory_can_manage','inventory_can_view','legal_entity','profile_key','updated_at','updated_by','user_id']::text[] then return false; end if;
  return v_employee->>'profile_key'='walls_inventory_counter'
    and v_employee->>'legal_entity'='Superior Walls of North Dakota, LLC'
    and v_employee->>'division_key'='walls' and v_employee->>'inventory_area'='production'
    and v_employee->'enabled'='true'::jsonb and v_employee->'inventory_can_view'='true'::jsonb
    and v_employee->'inventory_can_adjust'='true'::jsonb and v_employee->'inventory_can_manage'='false'::jsonb
    and v_employee->'allowed_wall_subviews'='["production"]'::jsonb
    and (select jsonb_agg(v order by v) from jsonb_array_elements_text(v_employee->'allowed_views') v)='["inventory","overview","walls","weekly-planner"]'::jsonb;
exception when others then return false;
end;
$$;
create function employee_password.lock_grants() returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
  -- Prevent additive-grant insertion phantoms until this short phase TX commits.
  -- No operational data tables are locked and no external call runs in this TX.
  lock table public.app_employee_access,public.app_user_roles,public.inventory_user_access,
    public.walls_production_access,public.walls_installation_access,public.weekly_planner_access in share mode;
end;
$$;
create function employee_password.settings_guard() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'Settings cannot be removed'; end if;
  if new.singleton is distinct from old.singleton or new.version<>old.version+1 then raise exception 'Settings version required'; end if;
  return new;
end;
$$;
create trigger employee_password_settings_guard before update or delete on employee_password.settings for each row execute function employee_password.settings_guard();
create function employee_password.native_target_allowed(p_uid uuid,p_email text,p_completed boolean)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog as $$
declare v_ok boolean;v_count integer;v_identity boolean;
begin
 -- Explicit nonsecret native state snapshots; not locks on Auth's independent transactions.
 select u.email=p_email and not u.is_anonymous and not u.is_sso_user
   and u.deleted_at is null and u.banned_until is null and coalesce(u.email_change,'')=''
   and u.raw_app_meta_data->>'provider'='email' and u.raw_app_meta_data->'providers'='["email"]'::jsonb
   and case when p_completed then u.email_confirmed_at is not null else
     u.email_confirmed_at is null and u.last_sign_in_at is null and u.recovery_sent_at is null end
   into v_ok from auth.users u where u.id=p_uid;
 if v_ok is distinct from true then return false; end if;
 select count(*),bool_and(i.provider='email' and i.identity_data->>'email'=p_email)
   into v_count,v_identity from auth.identities i where i.user_id=p_uid;
 return v_count=1 and v_identity and not exists(select 1 from auth.mfa_factors f where f.user_id=p_uid);
exception when undefined_column or undefined_table then return false;
end;
$$;
create function employee_password.record_fingerprint(p_record employee_password.approved_records) returns text
language sql immutable security invoker set search_path=pg_catalog as $$
 select encode(sha256(convert_to(to_jsonb(p_record)::text,'UTF8')),'hex');
$$;
create function employee_password.record_allowed(p_record employee_password.approved_records,p_settings employee_password.settings)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog as $$
declare v_actual jsonb;
begin
 if p_record.record_id is null or not p_record.enabled or p_record.reviewed_at>clock_timestamp()
   or p_settings.identifier_domain is null or split_part(p_record.auth_email,'@',2)<>p_settings.identifier_domain then return false; end if;
 v_actual:=employee_password.current_grants(p_record.auth_uid,p_record.auth_email);
 return employee_password.scope_allowed(v_actual) and v_actual=p_record.reviewed_grants
   and employee_password.native_target_allowed(p_record.auth_uid,p_record.auth_email,p_record.setup_completed);
end;
$$;
create function employee_password.record_guard() returns trigger language plpgsql security definer set search_path=pg_catalog set lock_timeout='2s' as $$
declare v_review employee_password.approved_records%rowtype;v_settings employee_password.settings%rowtype;
begin
 if tg_op<>'INSERT' then
   if tg_op='DELETE' then
     if exists(select 1 from employee_password.challenges where auth_uid=old.auth_uid) then raise exception 'Inspected reconciliation required'; end if;
     return old;
   end if;
   if new.record_id is distinct from old.record_id or new.auth_uid is distinct from old.auth_uid
     or new.username is distinct from old.username or new.auth_email is distinct from old.auth_email
     or new.created_at is distinct from old.created_at then raise exception 'Identity is immutable'; end if;
   if new.version<>old.version+1 or (old.setup_completed and not new.setup_completed) then raise exception 'Approved record version required'; end if;
   -- Only the exact in-flight success shape may advance completion under a target lock.
   -- Tables are inaccessible to service/browser callers; only finish exposes this change.
   if new.setup_completed and (to_jsonb(new)-array['version','setup_completed','updated_at'])=(to_jsonb(old)-array['version','setup_completed','updated_at'])
     and exists(select 1 from employee_password.target_locks l join employee_password.challenges c using(challenge_id)
       where l.auth_uid=old.auth_uid and c.auth_uid=old.auth_uid and c.phase='applying' and c.record_version=old.version
         and c.record_fingerprint=employee_password.record_fingerprint(old)) then
     new.updated_at:=clock_timestamp();return new;
   end if;
   if exists(select 1 from employee_password.target_locks where auth_uid=old.auth_uid) then raise exception 'Inspected reconciliation required'; end if;
   if new.setup_completed is distinct from old.setup_completed or new.reviewed_at<=old.reviewed_at then raise exception 'Fresh scope review required'; end if;
 elsif new.setup_completed then raise exception 'Initial approval required';
 end if;
 select * into v_settings from employee_password.settings where singleton for share;
 perform employee_password.lock_grants();
 v_review:=new;v_review.enabled:=true;
 if not employee_password.owner_allowed(new.reviewed_by) or not employee_password.record_allowed(v_review,v_settings) then raise exception 'Approved password record required'; end if;
 new.updated_at:=clock_timestamp();
 insert into employee_password.audit(actor_id,record_id,reviewed_version,event)
   values(new.reviewed_by,new.record_id,new.version,case when tg_op='INSERT' then 'record_approved' else 'record_revised' end);
 return new;
end;
$$;
create trigger employee_password_record_guard before insert or update or delete on employee_password.approved_records for each row execute function employee_password.record_guard();
create function employee_password.take_budget(p_bucket text,p_limit integer,p_window integer) returns boolean
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare v_now timestamptz:=clock_timestamp();v_count integer;
begin
 insert into employee_password.budgets(bucket,starts_at,attempts) values(p_bucket,v_now,1)
 on conflict(bucket) do update set attempts=case when employee_password.budgets.starts_at<=v_now-make_interval(secs=>p_window) then 1 else least(employee_password.budgets.attempts+1,121) end,
   starts_at=case when employee_password.budgets.starts_at<=v_now-make_interval(secs=>p_window) then v_now else employee_password.budgets.starts_at end returning attempts into v_count;
 return v_count<=p_limit;
end;
$$;
create function employee_password.record_payload(p_record employee_password.approved_records) returns jsonb
language sql immutable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('record_id',p_record.record_id,'version',p_record.version,'auth_uid',p_record.auth_uid,
   'auth_email',p_record.auth_email,'username',p_record.username,'setup_completed',p_record.setup_completed,'effective_scope',employee_password.pilot_scope());
$$;
create function public.employee_password_is_owner(p_owner_id uuid) returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
begin perform employee_password.require_service();return employee_password.owner_allowed(p_owner_id);end;
$$;
create function public.employee_password_readiness() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 perform employee_password.require_service();
 return (select jsonb_build_object('enabled',enabled,'current_key_id',current_key_id,'audience',audience,'identifier_domain',identifier_domain) from employee_password.settings where singleton);
end;
$$;
create function public.employee_password_preflight() returns boolean language plpgsql volatile security definer set search_path=pg_catalog set lock_timeout='2s' as $$
begin
 perform employee_password.require_service();
 return employee_password.take_budget('global',120,300);
end;
$$;
create function public.employee_password_owner_status() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_owner boolean:=employee_password.owner_allowed(auth.uid());
begin
 return jsonb_build_object('is_owner',v_owner,'available',v_owner and exists(select 1 from employee_password.settings where singleton and enabled));
end;
$$;
create function public.employee_password_owner_targets() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not employee_password.owner_allowed(auth.uid()) then raise exception using errcode='42501',message='Password administration unavailable'; end if;
 return coalesce((select jsonb_agg(x.row order by x.record_id) from (
   select r.record_id,jsonb_build_object('record_id',r.record_id,'version',r.version,'auth_uid',r.auth_uid,'display_name',r.display_name,
     'username',r.username,'setup_completed',r.setup_completed,'scope_label','Walls production / inventory counts / approved Walls crew packs',
     'status',coalesce(c.phase,case when s.enabled and employee_password.record_allowed(r,s) then 'ready' else 'unavailable' end)) as row
   from employee_password.approved_records r cross join employee_password.settings s
   left join employee_password.target_locks l on l.auth_uid=r.auth_uid left join employee_password.challenges c on c.challenge_id=l.challenge_id
   where s.singleton order by r.record_id limit 20
 )x),'[]'::jsonb);
end;
$$;
create function public.employee_password_prepare(p_owner_id uuid,p_record_id text,p_expected_version bigint,p_request_id uuid,p_action text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog set lock_timeout='2s' as $$
declare v_settings employee_password.settings%rowtype;v_record employee_password.approved_records%rowtype;
 v_challenge employee_password.challenges%rowtype;v_owner_budget boolean;v_target_budget boolean;
begin
 perform employee_password.require_service();
 if p_owner_id is null or p_request_id is null or p_record_id is null or p_record_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
   or p_expected_version is null or p_expected_version not between 1 and 9007199254740991 or p_action is null or p_action not in ('initialize','reset') then return '{"kind":"blocked"}'::jsonb; end if;
 select * into v_settings from employee_password.settings where singleton for update;
 perform 1 from employee_password.owners where user_id=p_owner_id for share;
 if not employee_password.owner_allowed(p_owner_id) or not v_settings.enabled then return '{"kind":"blocked"}'::jsonb; end if;
 select * into v_challenge from employee_password.challenges where owner_id=p_owner_id and request_id=p_request_id;
 if found then
   if v_challenge.record_id<>p_record_id or v_challenge.record_version<>p_expected_version or v_challenge.action<>p_action then return '{"kind":"blocked"}'::jsonb; end if;
   -- A replay never extends expiry or creates another nonce. Only a still-valid
   -- prepared challenge may return a fresh canonical record after the full fence.
   select * into v_record from employee_password.approved_records where record_id=p_record_id for update;
   if found and v_challenge.phase='prepared' and v_challenge.expires_at>clock_timestamp()
     and v_record.version=v_challenge.record_version and v_record.auth_uid=v_challenge.auth_uid
     and v_challenge.record_fingerprint=employee_password.record_fingerprint(v_record)
     and v_challenge.settings_version=v_settings.version and v_challenge.audience=v_settings.audience
     and v_challenge.key_id=v_settings.current_key_id and (v_challenge.action='reset')=v_record.setup_completed
     and not exists(select 1 from employee_password.target_locks where auth_uid=v_record.auth_uid) then
     perform employee_password.lock_grants();
     if employee_password.record_allowed(v_record,v_settings) then
       return jsonb_build_object('kind','replay','challenge_id',v_challenge.challenge_id,'phase',v_challenge.phase,
         'expires_at',v_challenge.expires_at,'audience',v_challenge.audience,'key_id',v_challenge.key_id,'record',employee_password.record_payload(v_record));
     end if;
   end if;
   return jsonb_build_object('kind','replay','challenge_id',v_challenge.challenge_id,'phase',v_challenge.phase,
     'expires_at',v_challenge.expires_at,'audience',v_challenge.audience,'key_id',v_challenge.key_id);
 end if;
 v_owner_budget:=employee_password.take_budget('owner:'||p_owner_id::text,10,600);
 if not v_owner_budget then return '{"kind":"blocked"}'::jsonb; end if;
 select * into v_record from employee_password.approved_records where record_id=p_record_id for update;
 if not found or v_record.version<>p_expected_version or exists(select 1 from employee_password.target_locks where auth_uid=v_record.auth_uid)
   or (p_action='reset')<>v_record.setup_completed then return '{"kind":"blocked"}'::jsonb; end if;
 v_target_budget:=employee_password.take_budget('target:'||v_record.auth_uid::text,5,600);
 if not v_target_budget then return '{"kind":"blocked"}'::jsonb; end if;
 perform employee_password.lock_grants();
 if not employee_password.record_allowed(v_record,v_settings) then return '{"kind":"blocked"}'::jsonb; end if;
 insert into employee_password.challenges(owner_id,request_id,record_id,auth_uid,record_version,record_fingerprint,settings_version,action,audience,key_id)
   values(p_owner_id,p_request_id,v_record.record_id,v_record.auth_uid,v_record.version,employee_password.record_fingerprint(v_record),v_settings.version,p_action,v_settings.audience,v_settings.current_key_id)
   returning * into v_challenge;
 insert into employee_password.audit(actor_id,record_id,operation_id,reviewed_version,event) values(p_owner_id,p_record_id,v_challenge.challenge_id,p_expected_version,'prepared');
 return jsonb_build_object('kind','prepared','challenge_id',v_challenge.challenge_id,'phase',v_challenge.phase,'expires_at',v_challenge.expires_at,
   'audience',v_challenge.audience,'key_id',v_challenge.key_id,'record',employee_password.record_payload(v_record));
end;
$$;
create function public.employee_password_consume(p_owner_id uuid,p_challenge_id uuid,p_record_id text,p_expected_version bigint,p_action text,p_audience text,p_key_id text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog set lock_timeout='2s' as $$
declare v_settings employee_password.settings%rowtype;v_record employee_password.approved_records%rowtype;v_challenge employee_password.challenges%rowtype;
begin
 perform employee_password.require_service();
 select * into v_settings from employee_password.settings where singleton for update;
 perform 1 from employee_password.owners where user_id=p_owner_id for share;
 if not employee_password.owner_allowed(p_owner_id) or not v_settings.enabled then return '{"kind":"blocked"}'::jsonb; end if;
 select * into v_record from employee_password.approved_records where record_id=p_record_id for update;
 if not found then return '{"kind":"blocked"}'::jsonb; end if;
 select * into v_challenge from employee_password.challenges where challenge_id=p_challenge_id and owner_id=p_owner_id for update;
 if not found or v_challenge.phase<>'prepared' or v_challenge.expires_at<=clock_timestamp()
   or v_challenge.record_id is distinct from p_record_id or v_challenge.record_version is distinct from p_expected_version
   or v_challenge.action is distinct from p_action or v_challenge.audience is distinct from p_audience or v_challenge.key_id is distinct from p_key_id
   or v_challenge.auth_uid<>v_record.auth_uid or v_challenge.record_version<>v_record.version
   or v_challenge.record_fingerprint<>employee_password.record_fingerprint(v_record)
   or v_challenge.settings_version<>v_settings.version or v_challenge.audience<>v_settings.audience or v_challenge.key_id<>v_settings.current_key_id
   or (v_challenge.action='reset')<>v_record.setup_completed
   or exists(select 1 from employee_password.target_locks where auth_uid=v_record.auth_uid) then return '{"kind":"blocked"}'::jsonb; end if;
 perform employee_password.lock_grants();
 if not employee_password.record_allowed(v_record,v_settings) or v_challenge.expires_at<=clock_timestamp() then return '{"kind":"blocked"}'::jsonb; end if;
 -- Recheck expiry after every potentially waiting lock/validation, immediately
 -- before the one-use claim. Lock contention must not extend nonce lifetime.
 -- One-use before external Auth effect, including durable target lock. No expiry unlock.
 insert into employee_password.target_locks(auth_uid,challenge_id) values(v_record.auth_uid,v_challenge.challenge_id);
 update employee_password.challenges set phase='applying',consumed_at=clock_timestamp(),updated_at=clock_timestamp() where challenge_id=v_challenge.challenge_id;
 insert into employee_password.audit(actor_id,record_id,operation_id,reviewed_version,event) values(p_owner_id,p_record_id,v_challenge.challenge_id,p_expected_version,'applying');
 return jsonb_build_object('kind','applying','operation_id',v_challenge.challenge_id,'record',employee_password.record_payload(v_record));
end;
$$;
create function public.employee_password_finish(p_owner_id uuid,p_operation_id uuid,p_phase text) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog set lock_timeout='2s' as $$
declare v_op employee_password.challenges%rowtype;v_record employee_password.approved_records%rowtype;
begin
 perform employee_password.require_service();
 if p_phase is null or p_phase not in ('applied','rejected','needs_review') then return false; end if;
 -- Same write order as prepare/consume avoids cross-phase deadlocks.
 perform 1 from employee_password.settings where singleton for update;
 select * into v_op from employee_password.challenges where challenge_id=p_operation_id and owner_id=p_owner_id;
 if not found then return false; end if;
 select * into v_record from employee_password.approved_records where record_id=v_op.record_id for update;
 select * into v_op from employee_password.challenges where challenge_id=p_operation_id and owner_id=p_owner_id for update;
 if v_op.phase<>'applying' or v_record.version<>v_op.record_version
   or not exists(select 1 from employee_password.target_locks where auth_uid=v_op.auth_uid and challenge_id=v_op.challenge_id) then return false; end if;
 -- Records a server-observed outcome, not permission for a new effect. Revocation
 -- after dispatch cannot erase an already successful native password mutation.
 if p_phase='applied' then
   if employee_password.record_fingerprint(v_record)<>v_op.record_fingerprint then return false; end if;
   update employee_password.approved_records set setup_completed=true,version=version+1,updated_at=clock_timestamp() where record_id=v_op.record_id;
 end if;
 update employee_password.challenges set phase=p_phase,updated_at=clock_timestamp() where challenge_id=v_op.challenge_id;
 if p_phase in ('applied','rejected') then delete from employee_password.target_locks where auth_uid=v_op.auth_uid and challenge_id=v_op.challenge_id; end if;
 insert into employee_password.audit(actor_id,record_id,operation_id,reviewed_version,event) values(p_owner_id,v_op.record_id,v_op.challenge_id,v_op.record_version,p_phase);
 return true;
end;
$$;
revoke all on all functions in schema employee_password from public,anon,authenticated,service_role;
revoke all on function public.employee_password_is_owner(uuid),public.employee_password_readiness(),public.employee_password_preflight(),public.employee_password_owner_status(),public.employee_password_owner_targets(),
 public.employee_password_prepare(uuid,text,bigint,uuid,text),public.employee_password_consume(uuid,uuid,text,bigint,text,text,text),public.employee_password_finish(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.employee_password_is_owner(uuid),public.employee_password_readiness(),public.employee_password_preflight(),public.employee_password_prepare(uuid,text,bigint,uuid,text),
 public.employee_password_consume(uuid,uuid,text,bigint,text,text,text),public.employee_password_finish(uuid,uuid,text) to service_role;
grant execute on function public.employee_password_owner_status(),public.employee_password_owner_targets() to authenticated;
comment on schema employee_password is 'Private existing-UID owner native password admission. No password, JWE, ciphertext, Auth token, email delivery or account/grant provisioning.';
comment on table employee_password.target_locks is 'Applying/needs_review locks never expire. Only verified applied or proven pre-effect weak-password rejection releases via finish.';
commit;
