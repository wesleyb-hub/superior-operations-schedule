-- Disposable PostgreSQL test database ONLY. Not a Supabase migration.
-- Minimal dependencies for the actual production RPC; no live services or credentials.
\set ON_ERROR_STOP on
begin;
create schema auth;
create function auth.jwt() returns jsonb language sql as $$ select '{"email":"fixture@example.invalid"}'::jsonb $$;
create function public.walls_production_permission(text) returns boolean language sql as $$
  select coalesce(current_setting('test.production_permission', true),'true')='true'
$$;
create table public.schedule_records(collection text,record_id text,data jsonb);
create table public.walls_production_assignments(
 assignment_id uuid primary key,wall_record_id text,stage text,planned_lf numeric,
 setup_progress integer default 0,pre_pour_ready boolean default false,
 actual_poured_lf numeric,notes text default ''
);
create table public.walls_production_issues(assignment_id uuid,status text);
create table public.walls_production_events(
 assignment_id uuid,event_type text,previous_stage text,new_stage text,actual_lf numeric,
 detail jsonb,actor_email text
);
insert into public.schedule_records values ('walls','fixture-job','{}');
insert into public.walls_production_assignments(assignment_id,wall_record_id,stage,planned_lf)
 values ('11111111-1111-1111-1111-111111111111','fixture-job','planned',100);
