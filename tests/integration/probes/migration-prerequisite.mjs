/** Disposable database only: prove the version repair cannot implicitly install its prerequisite. */
import pg from 'pg';
import fs from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'superior_workflow_test');
const c=new pg.Client();await c.connect();
const baseline=fs.readFileSync(new URL('../../../supabase/migrations/20261014_006_walls_production_execution.sql',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../../../supabase/migrations/20261022004702_mandatory_version_tokens_fail_closed.sql',import.meta.url),'utf8');
const definitions=()=>c.query("select proname,pg_get_functiondef(p.oid) definition,proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by proname,p.oid");
try{
 const before=(await definitions()).rows;
 for(const name of ['validate_walls_production_assignment','upsert_walls_production_assignment']){
  const old=baseline.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?\\n\\$\\$;'))?.[0];assert.ok(old);
  await c.query('begin');
  try{
   // Simulate the earlier committed definition only inside this rollback fixture.
   await c.query(old);await c.query('savepoint before_migration');
   await assert.rejects(c.query(migration),/Apply serialize_production_allocation/);
   await c.query('rollback to savepoint before_migration');
  }finally{await c.query('rollback');}
  assert.deepEqual((await definitions()).rows,before,'fixture rollback restores every definition and function ACL');
  console.log('PASS: missing '+name+' allocation mutex blocks the follow-on migration');
 }
}finally{await c.end();}
