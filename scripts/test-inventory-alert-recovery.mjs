import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliveryRequest, processAlert, processClaimedAlerts, sendToProvider, LEASE_MS, SAFE_RETRY_MS } from '../supabase/functions/inventory-reorder-notify/worker.mjs';

const start = Date.parse('2026-10-22T00:00:00Z');
const config = { from: 'synthetic@example.invalid', recipients: ['synthetic-recipient@example.invalid'], apiKey: 'stub-not-a-key' };
const fixture = (id = 1) => ({ alert_id: id, delivery_status: 'sending', attempts: 1, claimed_at: new Date(start).toISOString(), delivery_key: `inventory-reorder/synthetic-${id}`, payload: { description: 'Synthetic <material>', updated_at: '2026-10-21T12:00:00Z' } });
function clock() {
  let now = start;
  const timers = new Map(); let next = 0;
  return { now: () => now, advance: (ms) => { now += ms; }, sleep: async (ms) => { now += ms; },
    setTimer: (fn) => { timers.set(++next, fn); return next; }, clearTimer: (id) => timers.delete(id),
    fire: () => { for (const fn of [...timers.values()]) fn(); }, timers };
}
function database(rows, fault = () => false) {
  const stored = new Map(rows.map((row) => [row.alert_id, structuredClone(row)])); const writes = [];
  return { stored, writes, from(name) {
    assert.equal(name, 'inventory_alert_outbox');
    return { update(patch) {
      const filters = [];
      const builder = { eq: (key, value) => { filters.push([key, value]); return builder; }, async select(columns) {
        assert.equal(columns, 'alert_id'); writes.push({ patch, filters });
        const action = fault(patch, writes.length, filters);
        if (action === 'throw') throw new Error('synthetic transport outage');
        if (action === 'error') return { data: null, error: { message: 'synthetic write outage' } };
        const data = [];
        for (const row of stored.values()) if (filters.every(([key, value]) => row[key] === value)) {
          Object.assign(row, structuredClone(patch)); data.push({ alert_id: row.alert_id });
        }
        if (action === 'lost_ack') throw new Error('write committed but response lost');
        return { data, error: null };
      } };
      return builder;
    } };
  } };
}
function provider({ firstUnknown = false, rejectStatus = null, rejectName = null } = {}) {
  const accepted = new Map(); const calls = [];
  const fetch = async (_url, options) => {
    const key = options.headers['Idempotency-Key']; const body = options.body;
    calls.push({ key, body });
    if (rejectStatus) return new Response(JSON.stringify({ name: rejectName ?? 'synthetic_provider_error' }), { status: rejectStatus });
    if (accepted.has(key)) assert.equal(body, accepted.get(key).body, 'Retries must have identical payloads');
    else accepted.set(key, { body, id: `synthetic-email-${accepted.size + 1}` });
    if (firstUnknown && calls.length === 1) throw new Error('accepted then connection lost');
    return new Response(JSON.stringify({ id: accepted.get(key).id }), { status: 200 });
  };
  return { fetch, calls, accepted };
}

test('success freezes content before send and checks a fenced status write', async () => {
  const alert = fixture(); const db = database([alert]); const mail = provider();
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'sent'); assert.equal(mail.accepted.size, 1);
  const row = db.stored.get(1); assert.equal(row.delivery_status, 'sent'); assert.equal(row.provider_message_id, 'synthetic-email-1');
  assert.deepEqual(row.delivery_request, buildDeliveryRequest(alert, config));
  assert.ok(row.delivery_request.html.includes('&lt;material&gt;'));
  assert.ok(db.writes.every(({ filters }) => filters.some(([key]) => key === 'attempts') && filters.some(([key]) => key === 'claimed_at')));
});

test('provider acceptance followed by unknown network outcome retries without duplicate', async () => {
  const alert = fixture(); const db = database([alert]); const mail = provider({ firstUnknown: true });
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'sent'); assert.equal(mail.calls.length, 2); assert.equal(mail.accepted.size, 1);
  assert.equal(mail.calls[0].key, mail.calls[1].key);
});

test('deadline aborts hung provider and stalled body, preserving unknown outcome', async () => {
  for (const stalledBody of [false, true]) {
    const time = clock(); let signal;
    const pending = sendToProvider({}, 'synthetic-key', 'stub', { ...time, fetch: async (_url, opts) => {
      signal = opts.signal;
      return stalledBody ? { ok: true, status: 200, json: () => new Promise(() => {}) } : await new Promise(() => {});
    } });
    await Promise.resolve(); time.fire();
    const result = await pending;
    assert.equal(result.sent, false); assert.equal(result.retryable, true); assert.equal(signal.aborted, true); assert.equal(time.timers.size, 0);
  }
});

test('provider 5xx and 429 become scheduled failure rather than stuck sending', async () => {
  for (const status of [500, 429, 408]) {
    const alert = fixture(); const db = database([alert]); const mail = provider({ rejectStatus: status }); const time = clock();
    const result = await processAlert(db, alert, config, { ...time, fetch: mail.fetch });
    assert.equal(result.status, 'failed'); assert.equal(result.retry_scheduled, true); assert.equal(mail.calls.length, 3);
    assert.equal(db.stored.get(1).delivery_status, 'failed'); assert.ok(Date.parse(db.stored.get(1).next_attempt_at) > time.now());
  }
});

test('permanent provider rejection and payload conflict are quarantined, not retried', async () => {
  for (const [status, name] of [[422, 'validation_error'], [409, 'invalid_idempotent_request']]) {
    const alert = fixture(); const db = database([alert]); const mail = provider({ rejectStatus: status, rejectName: name });
    const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
    assert.equal(result.retry_scheduled, false); assert.equal(mail.calls.length, 1); assert.equal(db.stored.get(1).next_attempt_at, 'infinity');
  }
});

test('concurrent provider key conflict retries the same key', async () => {
  const alert = fixture(); const db = database([alert]); const mail = provider(); let calls = 0;
  const result = await processAlert(db, alert, config, { ...clock(), fetch: (...args) => ++calls === 1
    ? Promise.resolve(new Response(JSON.stringify({ name: 'concurrent_idempotent_requests' }), { status: 409 })) : mail.fetch(...args) });
  assert.equal(result.status, 'sent'); assert.equal(calls, 2); assert.equal(mail.accepted.size, 1);
});

test('request snapshot write failure prevents any provider call', async () => {
  const alert = fixture(); const db = database([alert], () => 'error'); const mail = provider();
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'persistence_failed'); assert.equal(mail.calls.length, 0); assert.equal(db.writes.length, 3);
});

test('sent status write failure recovers stale lease using same provider key and frozen payload', async () => {
  const alert = fixture(); let fail = true;
  const db = database([alert], (patch) => fail && patch.delivery_status === 'sent' ? 'error' : false);
  const mail = provider(); const time = clock();
  const first = await processAlert(db, alert, config, { ...time, fetch: mail.fetch });
  assert.equal(first.status, 'persistence_failed'); assert.equal(db.stored.get(1).delivery_status, 'sending');
  fail = false; time.advance(LEASE_MS);
  const row = db.stored.get(1); row.delivery_request = Object.fromEntries(Object.entries(row.delivery_request).reverse()); // Simulate jsonb key reordering.
  row.attempts += 1; row.claimed_at = new Date(time.now()).toISOString();
  const retry = await processAlert(db, structuredClone(row), { ...config, from: 'changed@example.invalid', recipients: ['changed@example.invalid'] }, { ...time, fetch: mail.fetch });
  assert.equal(retry.status, 'sent'); assert.equal(mail.accepted.size, 1); assert.equal(mail.calls.length, 2);
});

test('lost acknowledgement never produces false sent report or another email', async () => {
  const alert = fixture(); const db = database([alert], (patch) => patch.delivery_status === 'sent' ? 'lost_ack' : false); const mail = provider();
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'persistence_failed'); assert.equal(db.stored.get(1).delivery_status, 'sent'); assert.equal(mail.accepted.size, 1);
});

test('fenced old owner cannot send before snapshot persistence or overwrite a newer claim', async () => {
  const alert = fixture(); const newer = { ...alert, attempts: 2, claimed_at: new Date(start + LEASE_MS).toISOString() };
  const db = database([newer]); const mail = provider();
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'persistence_failed'); assert.equal(mail.calls.length, 0); assert.equal(db.stored.get(1).attempts, 2);
});

test('expired lease and expired idempotency window never send', async () => {
  for (const expiredWindow of [false, true]) {
    const time = clock(); time.advance(expiredWindow ? SAFE_RETRY_MS : LEASE_MS);
    const alert = { ...fixture(), delivery_request: buildDeliveryRequest(fixture(), config), delivery_started_at: new Date(start).toISOString() };
    if (expiredWindow) alert.claimed_at = new Date(time.now()).toISOString();
    const db = database([alert]); const mail = provider();
    const result = await processAlert(db, alert, config, { ...time, fetch: mail.fetch });
    assert.equal(result.status, expiredWindow ? 'failed' : 'lease_expired'); assert.equal(mail.calls.length, 0);
    if (expiredWindow) assert.equal(db.stored.get(1).next_attempt_at, 'infinity');
  }
});

test('sixth failed claim is terminal; provider success without ID remains unconfirmed', async () => {
  const alert = { ...fixture(), attempts: 6 }; const db = database([alert]);
  const result = await processAlert(db, alert, config, { ...clock(), fetch: async () => new Response('{}', { status: 200 }) });
  assert.equal(result.status, 'failed'); assert.equal(result.retry_scheduled, false); assert.equal(db.stored.get(1).next_attempt_at, 'infinity');
});

test('one persistence failure does not abandon the rest of a claimed batch', async () => {
  const bad = fixture(1); const good = fixture(2); const db = database([bad, good], (_patch, _count, filters) => filters.some(([key, value]) => key === 'alert_id' && value === 1) ? 'error' : false); const mail = provider();
  const results = await processClaimedAlerts(db, [bad, good], config, { ...clock(), fetch: mail.fetch });
  assert.deepEqual(results.map((r) => r.status), ['persistence_failed', 'sent']); assert.equal(mail.accepted.size, 1);
});

test('missing migration key fails closed without provider activity', async () => {
  const alert = fixture(); delete alert.delivery_key; const db = database([alert]); const mail = provider();
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'migration_required'); assert.equal(mail.calls.length, 0);
});
