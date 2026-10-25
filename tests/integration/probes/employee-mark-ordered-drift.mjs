/** Disposable database only. Exercise the migration's real guarded return transplant. */
import pg from 'pg';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'superior_workflow_test');
const baseline=fs.readFileSync(new URL('../../../supabase/migrations/20261022004822_inventory_alert_recovery.sql',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../../../supabase/migrations/20261025133736_employee_scoped_read_projections.sql',import.meta.url),'utf8');
const source=baseline.match(/create or replace function public\.mark_inventory_ordered\([\s\S]*?\n\$\$;/)?.[0];
const guard=migration.match(/do \$employee_mark_ordered_projection\$[\s\S]*?\$employee_mark_ordered_projection\$;/)?.[0];
assert.ok(source);assert.ok(guard);
const oldReturn='return to_jsonb(v_item);';
const newReturn='return case when public.can_read_full_inventory(v_item.division_key,v_item.inventory_area) then to_jsonb(v_item) else public.employee_inventory_item_projection(to_jsonb(v_item)) end;';
// Reconstruct the known historical deployment using committed source only, not live data.
const live=source.replace("last_error=concat_ws(' | ',nullif(last_error,''),'Suppressed because material was marked ordered')","last_error='Suppressed because material was marked ordered'")
 .replace("delivery_status in ('pending','failed')\n      and next_attempt_at<>'infinity'::timestamptz;","delivery_status in ('pending','failed');").replaceAll('\n','\r\n');
const hash=body=>createHash('md5').update(body.replaceAll('\r\n','\n')).digest('hex');
const c=new pg.Client();await c.connect();
async function definition(){return (await c.query("select p.oid::text,pg_get_functiondef(p.oid) definition,p.prosrc body,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,p.proacl::text acl,p.prorettype::regtype::text returns from pg_proc p where p.oid='public.mark_inventory_ordered(bigint,bigint)'::regprocedure")).rows[0];}
async function transaction(run){await c.query('begin');try{await run();}finally{await c.query('rollback');}}
try{
 const initial=await definition();
 for(const [name,definitionSql,expectedHash,patchedHash] of [
  ['source',source,'1173dc423b5bf06c98fd3ba1fb61aa26','dd17a3ed3b95554e3672d96b09d4df82'],
  ['known live CRLF',live,'73e9d808081079b3aa3530ae8d6beba7','6e1834d14126799d61b4295671d4ee58']
 ])await transaction(async()=>{
  await c.query(definitionSql);
  await c.query('grant execute on function public.mark_inventory_ordered(bigint,bigint) to service_role');
  const before=await definition();assert.equal(hash(before.body),expectedHash,`${name} fixture matches exact accepted body`);
  await c.query(guard);const after=await definition();
  assert.equal(after.body,before.body.replace(oldReturn,newReturn),`${name}: ONLY exact return changes`);
  assert.equal(after.definition,before.definition.replace(oldReturn,newReturn),`${name}: definition preserves all other body bytes/settings`);
  assert.equal(hash(after.body),patchedHash,`${name}: exact projected hash`);
  assert.deepEqual({...after,body:before.body,definition:before.definition},before,`${name}: OID, owner, ACL, config and signature preserved`);
  await c.query(guard);assert.deepEqual(await definition(),after,`${name}: projected reapplication is exact no-op`);
  console.log(`PASS: mark ordered ${name} return-only projection, metadata preservation and idempotency`);
 });
 for(const [name,definitionSql,alter,pattern] of [
  ['unknown literal',source.replace('Suppressed because material was marked ordered','TEST unknown business semantics'),null,/unknown mark_inventory_ordered body/],
  ['standalone CR in literal',source.replace('Suppressed because material was marked ordered','Suppressed \rbecause material was marked ordered'),null,/unknown mark_inventory_ordered body/],
  ['unknown search_path',source,'alter function public.mark_inventory_ordered(bigint,bigint) set search_path=public',/owner\/signature\/config drift/],
  ['unknown owner',source,'alter function public.mark_inventory_ordered(bigint,bigint) owner to service_role',/owner\/signature\/config drift/],
  ['security invoker',source,'alter function public.mark_inventory_ordered(bigint,bigint) security invoker',/owner\/signature\/config drift/]
 ])await transaction(async()=>{
  await c.query(definitionSql);if(alter)await c.query(alter);const before=await definition();
  await c.query('savepoint before_guard');await assert.rejects(c.query(guard),pattern);await c.query('rollback to savepoint before_guard');
  assert.deepEqual(await definition(),before,`${name}: rejection leaves function exactly unchanged`);
  console.log(`PASS: mark ordered ${name} drift rejected unchanged`);
 });
 assert.deepEqual(await definition(),initial,'all synthetic variants roll back to original function');
}finally{await c.end();}
