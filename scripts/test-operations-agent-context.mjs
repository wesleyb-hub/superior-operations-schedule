import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadAuthorizedContext, reportingClock, scheduleCollections, scheduleContext } from '../supabase/functions/operations-agent/context.mjs';

const now = new Date('2026-10-21T02:00:00Z');
const base = { access: { authorized: true }, inventory: [{ item_id: 1, quantity: 0 }], production: [] };
const data = Object.fromEntries(scheduleCollections.map((key) => [key, []]));
data.walls = [{ id: 'wall-1', planReview: { approved: false } }];
data.jobs = [{ id: 'culvert-1', name: 'Synthetic culvert', products: [{ status: 'hold' }] }];
data.billing = [{ key: 'bill-1', status: 'Not Billed' }];
data.loads = [{ id: 'load-1', status: 'Loaded' }];
const snapshot = { revision: 42, updated_at: '2026-10-21T01:00:00Z', payload: { schemaVersion: 35, data: { ...data, migrationBackup: 'omit', systemFlags: 'omit' } } };
function client(overrides = {}) {
  const calls = [];
  const results = {
    get_operations_agent_context: { data: base },
    get_walls_installation_snapshot: { data: { permissions: { view: true }, day_cards: [{ card_id: 'catchup-1', work_date: '2026-10-20' }], jobs: [], resource_conflicts: [] } },
    get_weekly_planner_agent_context: { data: { authorized: true, weeks: [] } },
    get_walls_installation_agent_context: { data: { authorized: true, jobs: [] } },
    get_schedule_snapshot: { data: snapshot },
    get_walls_production_weekly_forecast: { data: { daily: [{ date: '2026-10-20', plannedLf: 200, actualLf: 80 }] } },
    ...overrides,
  };
  return { calls, rpc(name, parameters) { calls.push({ name, parameters }); const result = results[name]; if (result instanceof Error) throw result; return Promise.resolve(result); } };
}

test('reads all six allowlisted sources with same caller client and preserves live values', async () => {
  const mock = client();
  const { context, error } = await loadAuthorizedContext(mock, now);
  assert.equal(error, null);
  assert.equal(mock.calls.length, 6);
  assert.ok(mock.calls.every(({ name }) => name.startsWith('get_')));
  assert.deepEqual(mock.calls.find(({ name }) => name === 'get_walls_production_weekly_forecast'), { name: 'get_walls_production_weekly_forecast', parameters: { p_week_start: '2026-10-20' } });
  assert.deepEqual(context.master_schedule.collections, data);
  assert.equal(context.master_schedule.revision, 42);
  assert.equal(context.master_schedule.read_only, true);
  assert.equal(context.inventory[0].quantity, 0);
  assert.equal(context.installation_workspace.day_cards[0].card_id, 'catchup-1');
  assert.deepEqual(context.installation_workspace.date_range, { from: '2026-10-13', to: '2026-12-04' });
  assert.equal(context.production_week.daily[0].actualLf, 80);
  assert.equal(JSON.stringify(context).includes('migrationBackup'), false);
  assert.equal(JSON.stringify(context).includes('systemFlags'), false);
});

test('denied base authorization fails closed even when other sources return data', async () => {
  for (const result of [{ error: { message: 'Denied' } }, { data: null }, { data: { access: { authorized: false } } }, new Error('network')]) {
    const output = await loadAuthorizedContext(client({ get_operations_agent_context: result }), now);
    assert.equal(output.context, null);
    assert.ok(output.error);
  }
});

test('optional denial, RPC error and transport failure are not zero workloads', async () => {
  const { context } = await loadAuthorizedContext(client({
    get_weekly_planner_agent_context: { data: { authorized: false, weeks: [{ secret: true }] } },
    get_walls_installation_agent_context: new Error('network'),
    get_walls_installation_snapshot: { data: { permissions: { view: false }, day_cards: [{ secret: true }] } },
    get_schedule_snapshot: { data: snapshot, error: { message: 'Denied' } },
    get_walls_production_weekly_forecast: { error: { message: 'Production access required' } },
  }), now);
  assert.equal(context.weekly_planner.status, 'not_authorized');
  for (const key of ['walls_installation', 'master_schedule', 'production_week', 'installation_workspace']) assert.equal(context[key].status, 'unavailable');
  assert.equal(JSON.stringify(context).includes('secret'), false);
  assert.equal(context.master_schedule.collections, undefined);
});

test('permission-filtered empty collections stay empty and are not company-wide counts', () => {
  const restricted = { ...snapshot, payload: { data: { walls: [{ id: 'visible' }], jobs: [], billing: [], loads: [] } } };
  const context = scheduleContext({ data: restricted });
  assert.deepEqual(context.collections.billing, []);
  assert.equal(context.coverage.billing.returned_count, 0);
  assert.equal(context.coverage.audit.status, 'unavailable');
  assert.match(context.scope, /permission-filtered/);
  assert.equal(context.collections.audit, undefined);
});

test('missing and malformed schedule payloads never become an empty successful snapshot', () => {
  for (const value of [null, {}, { payload: { data: [] } }]) assert.equal(scheduleContext({ data: value }).status, 'unavailable');
});

test('trusted Chicago reporting dates handle midnight and both DST changes', () => {
  for (const [instant, day] of [
    ['2026-10-21T02:00:00Z', '2026-10-20'],
    ['2026-03-08T07:59:00Z', '2026-03-08'], ['2026-03-08T08:01:00Z', '2026-03-08'],
    ['2026-11-01T06:59:00Z', '2026-11-01'], ['2026-11-01T07:01:00Z', '2026-11-01'],
  ]) {
    const clock = reportingClock(new Date(instant));
    assert.equal(clock.today, day);
    assert.equal(clock.timezone, 'America/Chicago');
    assert.equal(clock.generated_at, new Date(instant).toISOString());
  }
});

test('Edge integration retains caller JWT, proposal-only allowlist and workflow constraints', async () => {
  const edge = await readFile(new URL('../supabase/functions/operations-agent/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /global: \{ headers: \{ authorization \} \}/);
  assert.match(edge, /loadAuthorizedContext\(client\)/);
  assert.doesNotMatch(edge, /SUPABASE_SERVICE_ROLE_KEY|execute_operations_agent_action/);
  assert.deepEqual([...edge.matchAll(/name: "(propose_[^"]+)"/g)].map((m) => m[1]), ['propose_inventory_count', 'propose_production_stage', 'propose_setup_progress']);
  assert.match(edge, /Every proposal requires a separate human confirmation/);
  assert.match(edge, /never call a tool for a scheduling or staffing change/);
  assert.match(edge, /Do not invent material quantities/);
  assert.match(edge, /not a second physical inspection/);
  assert.match(edge, /production_week.daily.actualLf/);
});
