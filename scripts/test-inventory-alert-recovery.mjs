import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliveryRequest, processAlert, processClaimedAlerts, sendToProvider, LEASE_MS } from '../supabase/functions/inventory-reorder-notify/worker.mjs';

const start = Date.parse('2026-10-22T00:00:00Z');
const config = { endpoint: 'https://synthetic.example.invalid/gateway', secret: 'synthetic-not-a-secret', recipients: ['synthetic@example.invalid'] };
const fixture = (id = 1) => ({ alert_id: id, delivery_status: 'sending', attempts: 1, claimed_at: new Date(start).toISOString(), delivery_protocol: 1, delivery_started_at: null, delivery_request: null, payload: { description: 'Synthetic <material>', updated_at: '2026-10-21T12:00:00Z' } });
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
      const builder = {
        eq: (key, value) => { filters.push([key, value]); return builder; },
        is: (key, value) => { filters.push([key, value, 'is']); return builder; },
        async select(columns) {
          assert.equal(columns, 'alert_id'); writes.push({ patch, filters });
          const action = fault(patch, writes.length, filters);
          if (action === 'throw') throw new Error('synthetic transport outage');
          if (action === 'error') return { data: null, error: { message: 'synthetic write outage' } };
          const data = [];
          for (const row of stored.values()) if (filters.every(([key, value, op]) => op === 'is' && value === null ? row[key] == null : row[key] === value)) {
            Object.assign(row, structuredClone(patch)); data.push({ alert_id: row.alert_id });
          }
          if (action === 'lost_ack') throw new Error('write committed but response lost');
          return { data, error: null };
        },
      };
      return builder;
    } };
  } };
}
function provider({ unknown = false, status = 200, body = { ok: true, id: 'synthetic-email-1' } } = {}) {
  const calls = []; let accepted = 0;
  return { calls, get accepted() { return accepted; }, fetch: async (url, options) => {
    assert.equal(url, config.endpoint);
    const request = JSON.parse(options.body); assert.equal(request.secret, config.secret); calls.push(request);
    // Intentionally NOT idempotent: any accidental replay sends a duplicate.
    if (unknown || body.ok === true) accepted += 1;
    if (unknown) throw new Error('accepted then response lost');
    return new Response(JSON.stringify(body), { status });
  } };
}

test('Gmail protocol is preserved; durable intent precedes send and secrets are never stored', async () => {
  const alert = fixture(); const db = database([alert]); const mail = provider();
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'sent'); assert.equal(mail.accepted, 1); assert.equal(mail.calls[0].alert_id, alert.alert_id);
  const row = db.stored.get(1); assert.equal(row.delivery_status, 'sent'); assert.equal(row.provider_message_id, 'synthetic-email-1');
  assert.deepEqual(row.delivery_request, buildDeliveryRequest(alert, config));
  assert.ok(row.delivery_request.html.includes('&lt;material&gt;'));
  assert.ok(!JSON.stringify(row).includes(config.secret)); assert.ok(!JSON.stringify(row).includes(config.endpoint));
  assert.ok(db.writes[0].filters.some(([key, value, op]) => key === 'delivery_started_at' && value === null && op === 'is'));
  assert.ok(db.writes.every(({ filters }) => filters.some(([key]) => key === 'attempts') && filters.some(([key]) => key === 'claimed_at')));
});

test('controlled_test content from hosted worker remains distinct without changing operational content', () => {
  const alert = fixture(); alert.payload.notification_type = 'controlled_test';
  const request = buildDeliveryRequest(alert, config);
  assert.equal(request.subject, 'TEST — Superior Operations inventory notification');
  assert.match(request.text, /No inventory count, reorder threshold, purchase status, or operational record was changed/);
  assert.match(request.html, /Controlled Test/); assert.equal(request.alert_id, alert.alert_id);
});

test('accepted mail plus unknown network outcome is quarantined after exactly one call', async () => {
  const alert = fixture(); const db = database([alert]); const mail = provider({ unknown: true });
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'failed'); assert.equal(result.retry_scheduled, false); assert.equal(mail.calls.length, 1); assert.equal(mail.accepted, 1);
  assert.equal(db.stored.get(1).next_attempt_at, 'infinity'); assert.match(db.stored.get(1).last_error, /outcome unknown/);
});

test('deadline bounds hung headers and body; timeout never authorizes retry', async () => {
  for (const stalledBody of [false, true]) {
    const time = clock(); let signal;
    const pending = sendToProvider({}, config, { ...time, fetch: async (_url, opts) => {
      signal = opts.signal;
      return stalledBody ? { ok: true, status: 200, json: () => new Promise(() => {}) } : await new Promise(() => {});
    } });
    await Promise.resolve(); time.fire();
    const result = await pending;
    assert.equal(result.sent, false); assert.notEqual(result.retryable, true); assert.equal(signal.aborted, true); assert.equal(time.timers.size, 0);
  }
});

test('5xx, rate limit and retryable hints cannot prove Gmail did not send: no replay', async () => {
  for (const status of [200, 429, 500]) {
    const alert = fixture(); const db = database([alert]); const mail = provider({ status, body: { ok: false, retryable: true } });
    const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
    assert.equal(result.status, 'failed'); assert.equal(result.retry_scheduled, false); assert.equal(mail.calls.length, 1);
    assert.equal(db.stored.get(1).next_attempt_at, 'infinity'); assert.match(db.stored.get(1).last_error, /retryable_hint=true/);
  }
});

test('malformed response or nonretryable rejection is retained for manual review', async () => {
  for (const body of [{}, { ok: false, retryable: false }]) {
    const alert = fixture(); const db = database([alert]); const mail = provider({ body });
    const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
    assert.equal(result.status, 'failed'); assert.equal(mail.calls.length, 1); assert.equal(db.stored.get(1).next_attempt_at, 'infinity');
  }
});

test('existing ok/duplicate response without id retains hosted Gmail fallback contract', async () => {
  const alert = fixture(); const db = database([alert]); const mail = provider({ body: { ok: true, duplicate: true } });
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'sent'); assert.equal(result.duplicate, true); assert.equal(db.stored.get(1).provider_message_id, 'gmail-alert-1');
});

test('dispatch-intent write failure prevents provider call and unstarted lease can recover safely', async () => {
  const alert = fixture(); let fail = true; const db = database([alert], () => fail ? 'error' : false); const mail = provider(); const time = clock();
  const first = await processAlert(db, alert, config, { ...time, fetch: mail.fetch });
  assert.equal(first.status, 'persistence_failed'); assert.equal(mail.calls.length, 0); assert.equal(db.writes.length, 3);
  assert.equal(db.stored.get(1).delivery_started_at, null);
  fail = false; time.advance(LEASE_MS); const row = db.stored.get(1); row.attempts += 1; row.claimed_at = new Date(time.now()).toISOString();
  const retry = await processAlert(db, structuredClone(row), config, { ...time, fetch: mail.fetch });
  assert.equal(retry.status, 'sent'); assert.equal(mail.accepted, 1);
});

test('lost dispatch-intent acknowledgement fails closed before any provider call', async () => {
  const alert = fixture(); const db = database([alert], (patch) => patch.delivery_started_at ? 'lost_ack' : false); const mail = provider();
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'persistence_failed'); assert.equal(mail.calls.length, 0); assert.ok(db.stored.get(1).delivery_started_at);
});

test('sent status write failure never reports sent and no stale replay sends another email', async () => {
  const alert = fixture(); let fail = true;
  const db = database([alert], (patch) => fail && patch.delivery_status === 'sent' ? 'error' : false); const mail = provider(); const time = clock();
  const first = await processAlert(db, alert, config, { ...time, fetch: mail.fetch });
  assert.equal(first.status, 'persistence_failed'); assert.equal(db.stored.get(1).delivery_status, 'sending');
  fail = false; time.advance(LEASE_MS); const row = db.stored.get(1); row.attempts += 1; row.claimed_at = new Date(time.now()).toISOString();
  // SQL normally quarantines this row without reclaiming; guard also fails closed if given one.
  const retry = await processAlert(db, structuredClone(row), config, { ...time, fetch: mail.fetch });
  assert.equal(retry.status, 'failed'); assert.equal(mail.accepted, 1); assert.equal(mail.calls.length, 1);
  assert.equal(db.stored.get(1).next_attempt_at, 'infinity');
});

test('lost sent acknowledgement never reports false success or sends twice', async () => {
  const alert = fixture(); const db = database([alert], (patch) => patch.delivery_status === 'sent' ? 'lost_ack' : false); const mail = provider();
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'persistence_failed'); assert.equal(db.stored.get(1).delivery_status, 'sent'); assert.equal(mail.accepted, 1);
});

test('concurrent duplicate processing of the same claimed row gets only one dispatch intent', async () => {
  const alert = fixture(); const db = database([alert]); const mail = provider(); const time = clock();
  const results = await Promise.all([processAlert(db, alert, config, { ...time, fetch: mail.fetch }), processAlert(db, alert, config, { ...time, fetch: mail.fetch })]);
  assert.equal(mail.calls.length, 1); assert.equal(results.filter((r) => r.status === 'sent').length, 1);
});

test('old owner cannot overwrite newer claim or send before acquiring fenced intent', async () => {
  const alert = fixture(); const newer = { ...alert, attempts: 2, claimed_at: new Date(start + LEASE_MS).toISOString() };
  const db = database([newer]); const mail = provider();
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'persistence_failed'); assert.equal(mail.calls.length, 0); assert.equal(db.stored.get(1).attempts, 2);
});

test('expired lease never records dispatch intent or calls provider', async () => {
  const time = clock(); time.advance(LEASE_MS); const alert = fixture(); const db = database([alert]); const mail = provider();
  const result = await processAlert(db, alert, config, { ...time, fetch: mail.fetch });
  assert.equal(result.status, 'lease_expired'); assert.equal(mail.calls.length, 0); assert.equal(db.writes.length, 0);
});

test('one persistence failure does not abandon the remaining batch', async () => {
  const bad = fixture(1); const good = fixture(2); const db = database([bad, good], (_patch, _count, filters) => filters.some(([key, value]) => key === 'alert_id' && value === 1) ? 'error' : false); const mail = provider();
  const results = await processClaimedAlerts(db, [bad, good], config, { ...clock(), fetch: mail.fetch });
  assert.deepEqual(results.map((r) => r.status), ['persistence_failed', 'sent']); assert.equal(mail.accepted, 1);
});

test('missing recovery protocol fails closed without provider activity', async () => {
  const alert = fixture(); delete alert.delivery_protocol; const db = database([alert]); const mail = provider();
  const result = await processAlert(db, alert, config, { ...clock(), fetch: mail.fetch });
  assert.equal(result.status, 'migration_required'); assert.equal(mail.calls.length, 0);
});
