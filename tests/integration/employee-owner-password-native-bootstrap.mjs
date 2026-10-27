// UNEXECUTED PRIVATE CI SOURCE: bootstrap business + owner-password schema into a fresh, real local
// Supabase instance. Never replace native Auth objects or insert Auth records.
// The orchestrator must create exactly four synthetic users through native Admin
// Auth first, pin the observed local CLI project/port, and destroy the instance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root=path.resolve(import.meta.dirname,'../..');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const expectedMigrationCount=43;
const finalMigration='20261027112125_mixed_employee_password_scope.sql';
const digest=value=>createHash('sha256').update(value).digest('hex');

function betweenUnique(source,start,end){
  assert.equal(source.split(start).length,2,`Expected one baseline start marker: ${start}`);
  assert.equal(source.split(end).length,2,`Expected one baseline end marker: ${end}`);
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert.ok(to>from,'Baseline markers must remain in reviewed order');
  return source.slice(from,to);
}

function nativeSafeBaseline(source){
  // Marker-bounded extraction deliberately excludes the disposable suite's
  // roles, auth schema/table/helpers, default-ACL shim and Auth fixture inserts.
  const business=betweenUnique(source,'CREATE TABLE public.app_user_roles (','CREATE PUBLICATION supabase_realtime;');
  const emptySchedule=betweenUnique(source,'INSERT INTO public.schedule_state(id,payload,updated_by)','INSERT INTO auth.users VALUES');
  const candidate=business+'\n'+emptySchedule;
  const uncommented=candidate.replace(/--[^\n]*/g,'');
  assert.doesNotMatch(uncommented,/\b(?:create|alter|drop)\s+(?:role|schema|publication)\b/i);
  assert.doesNotMatch(uncommented,/\b(?:create|alter|drop)\s+(?:table|function|view|trigger)\s+auth\./i);
  assert.doesNotMatch(uncommented,/\b(?:insert\s+into|update|delete\s+from)\s+auth\./i);
  assert.doesNotMatch(uncommented,/alter\s+default\s+privileges|set_config\(/i);
  assert.equal((uncommented.match(/\binsert\s+into\b/gi)||[]).length,1,'Only the empty schedule seed may be inserted by baseline');
  assert.match(emptySchedule,/VALUES\s*\(1,'\{"walls":\[\],"jobs":\[\],"billing":\[\],"loads":\[\],"audit":\[\],"historyArchive":\[\],"deliveryHistory":\[\],"qcHistory":\[\]\}'/);
  assert.match(business,/GRANT ALL ON public\.schedule_state TO service_role;\s*$/);
  return candidate;
}

async function nativeFingerprint(client){
  const helpers=(await client.query(`
    select p.oid::regprocedure::text as signature,md5(pg_get_functiondef(p.oid)) as definition_md5
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='auth' and p.proname in ('uid','jwt','role') and p.pronargs=0 order by p.proname
  `)).rows;
  const defaults=(await client.query(`
    select r.rolname as owner,n.nspname as schema,d.defaclobjtype,d.defaclacl::text as acl
    from pg_default_acl d join pg_roles r on r.oid=d.defaclrole
    left join pg_namespace n on n.oid=d.defaclnamespace
    where d.defaclnamespace=0 or n.nspname in ('public','auth','extensions')
    order by r.rolname,n.nspname nulls first,d.defaclobjtype
  `)).rows;
  const roles=(await client.query(`
    select rolname,rolcanlogin,rolbypassrls,rolinherit,rolreplication,rolsuper
    from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname
  `)).rows;
  // These are synthetic identifiers only; password/hash/token columns are never read.
  const users=(await client.query('select id,email,is_anonymous from auth.users order by id')).rows;
  return {helpers,defaults,roles,users};
}

/**
 * @param {import('pg').Client} client Connected to the isolated native CLI DB.
 * @param {{ownerUid:string,employees:Array<{uid:string,username:string}>,keyId:string,audience:string}} identities
 * UIDs MUST come from native Auth Admin createUser, using addresses ending .invalid.
 * No hosted URLs, auth.users mutations, JWT stubs or production fixture identifiers.
 */
export async function bootstrapOwnerPasswordDatabase(client,{ownerUid,employees,keyId,audience}){
  assert.equal(employees?.length,3);
  assert.deepEqual(employees.map(x=>x.profile??'pilot'),['pilot','pilot','mixed']);
  const employeeUid=employees[0].uid;
  assert.ok(employees.every(x=>uuid.test(x.uid)&&/^[a-z][a-z0-9._-]{2,31}$/.test(x.username)));
  assert.equal(new Set([ownerUid,...employees.map(x=>x.uid)]).size,4);
  assert.equal(keyId,"employee-password-native-test");
  assert.equal(audience,"https://auth.example.invalid/functions/v1/employee-password");
  const connection=client?.connectionParameters;
  assert.ok(connection&&['127.0.0.1','localhost','::1'].includes(connection.host),'Refusing a non-loopback native database');
  assert.equal(connection.database,'postgres','Expected the isolated native Supabase postgres database');
  assert.ok(Number.isInteger(Number(connection.port))&&Number(connection.port)>0,'Expected an explicit local database port');
  assert.ok(uuid.test(ownerUid)&&uuid.test(employeeUid)&&ownerUid!==employeeUid,'Distinct native-created Auth owner and employee UIDs are required');

  // Every check below is read-only and runs before any business-schema changes.
  const environment=(await client.query(`select current_database() as database,
    current_setting('server_version_num')::integer as version,
    to_regclass('auth.users') is not null and to_regclass('auth.identities') is not null
      and to_regclass('auth.sessions') is not null and to_regclass('auth.refresh_tokens') is not null as native_tables,
    to_regprocedure('auth.uid()') is not null and to_regprocedure('auth.jwt()') is not null
      and to_regprocedure('auth.role()') is not null as native_helpers,
    to_regnamespace('extensions') is not null as extension_schema,
    to_regnamespace('employee_password') is not null or to_regnamespace('employee_pack_private') is not null as employee_schema
  `)).rows[0];
  assert.equal(environment.database,'postgres');
  assert.ok(environment.version>=170000&&environment.version<180000,'Expected native PostgreSQL 17');
  assert.ok(environment.native_tables&&environment.native_helpers&&environment.extension_schema,'Native Supabase Auth/schema must already exist');
  assert.equal(environment.employee_schema,false,'Requires a fresh native instance without employee schema');
  const existing=(await client.query(`
    select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    and (c.relname like 'schedule_%' or c.relname like 'inventory_%' or c.relname like 'walls_%'
      or c.relname like 'weekly_planner_%' or c.relname like 'operations_%'
      or c.relname in ('app_user_roles','app_employee_access'))
  `)).rows;
  assert.equal(existing.length,0,'Requires zero preexisting application relations');
  const oldHelpers=(await client.query(`select to_regprocedure('public.get_app_access()') is not null
    or to_regprocedure('public.can_access_schedule()') is not null
    or to_regprocedure('public.can_edit_schedule()') is not null as present`)).rows[0].present;
  assert.equal(oldHelpers,false,'Requires zero preexisting application authorization helpers');
  const before=await nativeFingerprint(client);
  assert.equal(before.helpers.length,3,'All native Auth helpers must exist');
  assert.equal(before.roles.length,3,'All native API roles must already exist');
  assert.deepEqual(before.users.map(u=>u.id).sort(),[ownerUid,...employees.map(x=>x.uid)].sort(),'Native DB must contain exactly the four approved synthetic users');
  assert.ok(before.users.every(u=>u.is_anonymous===false&&typeof u.email==='string'&&u.email.endsWith('.invalid')),'Only nonanonymous synthetic .invalid Auth users are accepted');

  for(const employee of employees)assert.equal(before.users.find(x=>x.id===employee.uid)?.email,employee.username+'@company.example.invalid');
  const baseline=nativeSafeBaseline(await fs.readFile(path.join(root,'tests/integration/baseline.sql'),'utf8'));
  const migrations=(await fs.readdir(path.join(root,'supabase/migrations'))).filter(name=>name.endsWith('.sql')).sort();
  assert.equal(migrations.length,expectedMigrationCount,'Migration set changed; review before updating the native test');
  assert.equal(migrations.at(-1),finalMigration,'Expected the reviewed owner-password candidate as the last migration');
  const manifest=[];
  const sources=[];
  for(const filename of migrations){
    const sql=await fs.readFile(path.join(root,'supabase/migrations',filename),'utf8');
    const uncommented=sql.replace(/--[^\n]*/g,'');
    assert.doesNotMatch(uncommented,/\b(?:insert\s+into|update|delete\s+from)\s+auth\./i,'Repository migrations must not mutate native Auth records');
    assert.doesNotMatch(uncommented,/\b(?:create|alter|drop)\s+(?:table|function|view|trigger)\s+auth\./i,'Repository migrations must not replace native Auth objects');
    sources.push(sql);manifest.push({filename,sha256:digest(sql)});
  }

  await client.query('set search_path=public,extensions');
  // Realtime may be disabled in the minimal CLI stack. Business migrations still
  // reference its publication; create only this missing empty local publication.
  const publication=(await client.query("select exists(select 1 from pg_publication where pubname='supabase_realtime') as present")).rows[0].present;
  if(!publication)await client.query('create publication supabase_realtime');
  await client.query('begin');
  try{await client.query(baseline);await client.query('commit');}
  catch(error){await client.query('rollback');throw error;}
  // Original migrations own their transaction boundaries. Never rewrite them or
  // route the legacy shared date-prefix filenames through migration-history IDs.
  for(const sql of sources)await client.query(sql);

  await client.query('begin');
  try{
    await client.query("insert into public.app_user_roles(user_id,role,can_write) values($1,'management',true)",[ownerUid]);
    for(const employee of employees.filter(x=>x.profile!=='mixed'))await client.query(`insert into public.app_employee_access(
      user_id,profile_key,allowed_views,allowed_wall_subviews,enabled,
      inventory_can_view,inventory_can_adjust,inventory_can_manage,updated_by
    ) values($1,'walls_inventory_counter',array['overview','walls','inventory','weekly-planner'],
      array['production'],true,true,true,false,'SYNTHETIC native Auth test')`,[employee.uid]);
    const mixed=employees.find(x=>x.profile==='mixed');
    for(const [division,area] of [['walls','production'],['walls','install'],['boxes','production']])await client.query(`insert into public.app_employee_access(
      user_id,profile_key,legal_entity,division_key,inventory_area,allowed_views,allowed_wall_subviews,enabled,
      inventory_can_view,inventory_can_adjust,inventory_can_manage,updated_by
    ) values($1,'walls_production_inventory_qc_v1',$2,$3,$4,array['overview','walls','inventory','boxes','manholes','fence','block','qc','weekly-planner'],
      array['production','installation'],true,true,true,true,'SYNTHETIC native mixed test')`,
      [mixed.uid,division==='walls'?'Superior Walls of North Dakota, LLC':'Superior Precast Structures, LLC',division,area]);
    await client.query(`insert into public.walls_production_access(user_id,can_view,can_update_setup,can_record_pour,can_record_strip,can_report_issue,can_manage_assignments,can_manage_plan,enabled)
      values($1,true,true,true,true,true,true,true,true)`,[mixed.uid]);
    await client.query(`insert into public.walls_installation_access(user_id,can_view,can_manage,can_assign_resources,can_qc,can_record_field_progress,enabled)
      values($1,true,false,false,true,false,true)`,[mixed.uid]);
    await client.query('insert into employee_password.owners(user_id,enabled) values($1,true)',[ownerUid]);
    await client.query("update employee_password.settings set enabled=true,current_key_id=$1,audience=$2,identifier_domain='company.example.invalid',version=version+1",[keyId,audience]);
    for(const employee of employees)await client.query(`insert into employee_password.approved_records(record_id,auth_uid,username,auth_email,display_name,enabled,reviewed_by,reviewed_at,reviewed_grants)
      values($1,$2,$3,$4,'Synthetic native employee',true,$5,clock_timestamp(),employee_password.current_grants($2,$4))`,
      ['native-'+employee.username,employee.uid,employee.username,employee.username+'@company.example.invalid',ownerUid]);
    await client.query('commit');
  }catch(error){await client.query('rollback');throw error;}

  const after=await nativeFingerprint(client);
  assert.deepEqual(after,before,'Bootstrap must preserve native Auth users/helpers, native API roles and default privileges');
  const employee=(await client.query(`select profile_key,allowed_views,allowed_wall_subviews,enabled,
    inventory_can_view,inventory_can_adjust,inventory_can_manage from public.app_employee_access where user_id=$1`,[employeeUid])).rows[0];
  assert.deepEqual(employee,{profile_key:'walls_inventory_counter',allowed_views:['overview','walls','inventory','weekly-planner'],
    allowed_wall_subviews:['production'],enabled:true,inventory_can_view:true,inventory_can_adjust:true,inventory_can_manage:false});
  await client.query("notify pgrst,'reload schema'");
  return {migrationCount:migrations.length,baselineSha256:digest(baseline),migrations:manifest,nativeAuthPreserved:true,
    syntheticUsers:4,independentBusinessGrantsAdded:2,publicationCreated:!publication};
}
