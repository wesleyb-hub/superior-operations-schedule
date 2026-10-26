-- DISPOSABLE TEST DATABASE ONLY. Never run against a hosted project.
-- Minimal prerepository dependencies inferred from committed application migrations.
-- This is NOT an export of hosted schemas or a hosted privilege-fidelity test.
-- No credentials, auth sessions, employee rows, or business records are exported.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() <> 'superior_workflow_test' THEN
  RAISE EXCEPTION 'Refusing non-test database: %', current_database();
 END IF;
 IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='schedule_state') THEN
  RAISE EXCEPTION 'Requires fresh empty disposable database';
 END IF;
END $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
-- Public Supabase bootstrap compatibility: function EXECUTE defaults only.
-- Source: https://github.com/supabase/postgres/blob/develop/migrations/db/init-scripts/00000000000000-initial-schema.sql
-- Required for authenticated RLS policy helper calls. No hosted ACL export or table defaults.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
SET search_path=public,extensions;
-- Supabase's Auth provider is the only stub: callers set verified test identities
-- in a transaction. These functions do not verify JWTs or exercise GoTrue.
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE, is_anonymous boolean NOT NULL DEFAULT false);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT auth.jwt()->>'role'
$$;
CREATE TABLE public.app_user_roles (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 role text NOT NULL,
 can_write boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own app role" ON public.app_user_roles FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.app_user_roles TO authenticated;
GRANT ALL ON public.app_user_roles TO service_role;
-- Legacy authorization dependencies reconstructed from application expectations.
-- Actual committed migrations replace/consume these helpers below.
CREATE FUNCTION public.can_access_schedule() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT lower(coalesce(auth.jwt()->>'email','')) LIKE '%@superiorwallsnd.com'
$$;
CREATE FUNCTION public.can_edit_schedule() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM public.app_user_roles WHERE user_id=auth.uid() AND can_write)
$$;
CREATE TABLE public.schedule_state (
 id integer PRIMARY KEY CHECK(id=1),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by text
);
ALTER TABLE public.schedule_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company users can view all dashboards" ON public.schedule_state FOR SELECT TO authenticated USING(public.can_access_schedule());
CREATE POLICY "Approved editors can update schedule" ON public.schedule_state FOR UPDATE TO authenticated USING(public.can_edit_schedule()) WITH CHECK(public.can_edit_schedule());
GRANT SELECT,UPDATE ON public.schedule_state TO authenticated;
GRANT ALL ON public.schedule_state TO service_role;
CREATE PUBLICATION supabase_realtime;
-- Empty synthetic starting state and explicit, disposable test identities.
INSERT INTO public.schedule_state(id,payload,updated_by) VALUES (1,'{"walls":[],"jobs":[],"billing":[],"loads":[],"audit":[],"historyArchive":[],"deliveryHistory":[],"qcHistory":[]}','SYNTHETIC TEST baseline');
INSERT INTO auth.users VALUES
 ('00000000-0000-4000-8000-000000000001','test-admin@superiorwallsnd.com'),
 ('00000000-0000-4000-8000-000000000002','test-viewer@superiorwallsnd.com'),
 ('00000000-0000-4000-8000-000000000003','test-outsider@example.invalid');
INSERT INTO public.app_user_roles(user_id,role,can_write) VALUES
 ('00000000-0000-4000-8000-000000000001','management',true),
 ('00000000-0000-4000-8000-000000000002','viewer',false);
