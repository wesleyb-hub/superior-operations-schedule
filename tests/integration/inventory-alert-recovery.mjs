// Fresh local PostgreSQL only. Uses synthetic rows; never invokes an Edge Function/provider.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const host = process.env.PGHOST ?? '127.0.0.1';
const database = process.env.PGDATABASE ?? 'superior_workflow_test';
assert.ok(['127.0.0.1', 'localhost'].includes(host), 'Refusing nonlocal test DB');
assert.equal(database, 'superior_workflow_test', 'Refusing non-test DB');
const { default: pg } = await import(process.env.TEST_PG_MODULE ?? 'pg');
const config = { host, database, user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD, port: Number(process.env.PGPORT ?? 5432) };
const root = path.resolve(import.meta.dirname, '../..');
const admin = new pg.Client(config); const a = new pg.Client(config); const b = new pg.Client(config);
await admin.connect();
try {
  assert.equal((await admin.query("select count(*)::int as n from information_schema.tables where table_schema='public'")).rows[0].n, 0, 'Requires fresh empty disposable database');
  const baseline = (await fs.readFile(path.join(root, 'tests/integration/baseline.sql'), 'utf8')).replace(/^\\.*$/gm, '');
  await admin.query(baseline);
  const migrations = (await fs.readdir(path.join(root, 'supabase/migrations'))).filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations.filter((name) => !name.endsWith('_inventory_alert_recovery.sql'))) {
    await admin.query(await fs.readFile(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
  const item = (await admin.query("insert into public.inventory_items(titan_code,description,category) values('SYNTHETIC-RETRY','Synthetic retry test','RM Misc. SW') returning item_id")).rows[0].item_id;
  const insert = async (extra = {}) => {
    const fields = { item_id: item, payload: { description: 'Synthetic retry test' }, ...extra };
    const columns = Object.keys(fields);
    return (await admin.query(`insert into public.inventory_alert_outbox(${columns.join(',')}) values(${columns.map((_, i) => `$${i + 1}`).join(',')}) returning *`, Object.values(fields))).rows[0];
  };
  const legacy = await insert({ delivery_status: 'failed', attempts: 1, last_error: 'Original synthetic provider failure' });
  const before = (await admin.query('select to_jsonb(a) as row from inventory_alert_outbox a where alert_id=$1', [legacy.alert_id])).rows[0].row;
  const security = async () => (await admin.query("select proname,prosecdef,proconfig,proacl::text from pg_proc where oid in ('public.claim_inventory_alerts(bigint,integer)'::regprocedure,'public.mark_inventory_ordered(bigint,bigint)'::regprocedure) order by proname")).rows;
  const securityBefore = await security();
  for (const name of migrations.filter((name) => name.endsWith('_inventory_alert_recovery.sql'))) {
    await admin.query(await fs.readFile(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
  const after = (await admin.query("select to_jsonb(a)-'delivery_key'-'delivery_request'-'delivery_started_at' as row from inventory_alert_outbox a where alert_id=$1", [legacy.alert_id])).rows[0].row;
  assert.deepEqual(await security(), securityBefore, 'RPC ownership/access settings must remain unchanged');
  assert.deepEqual(after, before, 'Applying migration must not rewrite existing alert records');
  console.log('PASS: all repository migrations apply; recovery migration preserves existing alert records');

  const auth = "select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)";
  await admin.query(auth); await a.connect(); await b.connect(); await a.query(auth); await b.query(auth);
  const claim = (client, id = null, limit = 10) => client.query('select * from claim_inventory_alerts($1,$2)', [id, limit]);
  const row = async (id) => (await admin.query('select *,next_attempt_at::text as next_text,claimed_at::text as claim_text from inventory_alert_outbox where alert_id=$1', [id])).rows[0];
  assert.equal((await claim(admin, legacy.alert_id)).rowCount, 0);
  let saved = await row(legacy.alert_id);
  assert.equal(saved.next_text, 'infinity'); assert.match(saved.last_error, /Original synthetic provider failure.*legacy delivery outcome/);
  assert.equal(saved.delivery_key, null);
  console.log('PASS: legacy attempted rows quarantine on sweep, preserve history and never resend');

  await admin.query('truncate inventory_alert_outbox restart identity');
  const pending1 = await insert(); const pending2 = await insert();
  await a.query('begin'); await b.query('begin');
  const owner1 = (await claim(a, null, 1)).rows;
  const owner2 = (await claim(b, null, 1)).rows;
  assert.equal(owner1.length, 1); assert.equal(owner2.length, 1); assert.notEqual(owner1[0].alert_id, owner2[0].alert_id);
  assert.deepEqual(new Set([owner1[0].alert_id, owner2[0].alert_id]), new Set([pending1.alert_id, pending2.alert_id]));
  assert.notEqual(owner1[0].delivery_key, owner2[0].delivery_key);
  await a.query('commit'); await b.query('commit');
  assert.equal((await claim(admin)).rowCount, 0, 'Active claims cannot be claimed a second time');
  console.log('PASS: two simultaneous SQL transactions claim distinct rows with SKIP LOCKED');

  const original = await row(pending1.alert_id);
  const snapshot = { from: 'synthetic@example.invalid', to: ['synthetic@example.invalid'], text: 'unchanged' };
  await admin.query("update inventory_alert_outbox set claimed_at=now()-interval '6 minutes',delivery_request=$2,delivery_started_at=now()-interval '10 minutes' where alert_id=$1", [pending1.alert_id, snapshot]);
  const stale = await row(pending1.alert_id);
  const recovered = (await claim(admin, pending1.alert_id)).rows[0];
  assert.equal(recovered.attempts, 2); assert.equal(recovered.delivery_key, original.delivery_key); assert.deepEqual(recovered.delivery_request, snapshot);
  const badWrite = await admin.query("update inventory_alert_outbox set delivery_status='sent' where alert_id=$1 and attempts=$2 and claimed_at=$3 and delivery_status='sending' returning alert_id", [stale.alert_id, stale.attempts, stale.claim_text]);
  assert.equal(badWrite.rowCount, 0, 'Old lease owner must be fenced out');
  console.log('PASS: stale claims recover with the same request/key; old-owner writes are rejected');

  await admin.query('truncate inventory_alert_outbox restart identity');
  const future = await insert({ delivery_status: 'failed', attempts: 1, delivery_key: 'synthetic-future', next_attempt_at: new Date(Date.now() + 3600000) });
  assert.equal((await claim(admin, future.alert_id)).rowCount, 0);
  await admin.query("update inventory_alert_outbox set next_attempt_at=now()-interval '1 minute' where alert_id=$1", [future.alert_id]);
  assert.equal((await claim(admin, future.alert_id)).rows[0].attempts, 2);
  for (const [key, attempts, age] of [['synthetic-expired', 2, '24 hours'], ['synthetic-exhausted', 6, '1 hour']]) {
    const blocked = await insert({ delivery_status: 'sending', attempts, delivery_key: key, claimed_at: new Date(Date.now() - 360000) });
    await admin.query(`update inventory_alert_outbox set delivery_started_at=now()-$2::interval where alert_id=$1`, [blocked.alert_id, age]);
    assert.equal((await claim(admin, blocked.alert_id)).rowCount, 0);
    saved = await row(blocked.alert_id); assert.equal(saved.delivery_status, 'failed'); assert.equal(saved.next_text, 'infinity');
  }
  console.log('PASS: due times, attempt limits and provider TTL are enforced by SQL; exhausted leases do not stay sending');

  const ordered = await insert({ delivery_status: 'sending', attempts: 1, delivery_key: 'synthetic-ordered', claimed_at: new Date(Date.now() - 360000) });
  await admin.query('update inventory_items set ordered=true where item_id=$1', [item]);
  assert.equal((await claim(admin, ordered.alert_id)).rowCount, 0); assert.equal((await row(ordered.alert_id)).delivery_status, 'suppressed');
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await admin.query("select has_function_privilege($1,'public.claim_inventory_alerts(bigint,integer)','EXECUTE') as allowed", [role])).rows[0].allowed, false);
  }
  assert.equal((await admin.query("select has_function_privilege('service_role','public.claim_inventory_alerts(bigint,integer)','EXECUTE') as allowed")).rows[0].allowed, true);
  assert.equal((await admin.query("select relrowsecurity from pg_class where oid='public.inventory_alert_outbox'::regclass")).rows[0].relrowsecurity, true);
  console.log('PASS: ordered material is suppressed; existing service-role-only RPC and RLS remain intact');

  const quarantine = await insert({ delivery_status: 'failed', attempts: 2, delivery_key: 'synthetic-quarantine', next_attempt_at: 'infinity', last_error: 'Manual review required: accepted outcome unknown' });
  const ordinary = await insert({ delivery_status: 'failed', attempts: 1, delivery_key: 'synthetic-ordinary', last_error: 'Original transient failure' });
  await admin.query("insert into inventory_user_access(email,can_manage) values('synthetic-manager@example.invalid',true)");
  const itemVersion = (await admin.query('select version from inventory_items where item_id=$1', [item])).rows[0].version;
  await admin.query("select set_config('request.jwt.claims','{\"role\":\"authenticated\",\"email\":\"synthetic-manager@example.invalid\"}',false)");
  await admin.query('set role authenticated');
  await admin.query('select mark_inventory_ordered($1,$2)', [item, itemVersion]);
  await admin.query('reset role'); await admin.query(auth);
  saved = await row(quarantine.alert_id);
  assert.equal(saved.delivery_status, 'failed'); assert.equal(saved.next_text, 'infinity'); assert.equal(saved.last_error, quarantine.last_error);
  saved = await row(ordinary.alert_id);
  assert.equal(saved.delivery_status, 'suppressed'); assert.match(saved.last_error, /Original transient failure.*marked ordered/);
  console.log('PASS: real authenticated mark-ordered RPC preserves terminal quarantine and prior failure history');
} finally {
  await Promise.allSettled([a.end(), b.end(), admin.end()]);
}
