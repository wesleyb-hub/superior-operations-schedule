import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { wallCompletionContext, completionAnswer, boundContext, contextLimits, loadAuthorizedContext, reportingClock, scheduleCollections, scheduleContext } from '../supabase/functions/operations-agent/context.mjs';

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
    get_weekly_planner_snapshot: { data: {
      permissions: { view: true }, week: { week_start: '2026-10-19', source_stale: true },
      sections: [{ section_id: 'section-1', section_name: 'Installation' }],
      people: [{ section_id: 'section-1', employee_name: 'Synthetic Employee', is_leader: true }],
      assignments: [{ section_id: 'section-1', work_date: '2026-10-20', assignment_text: 'Synthetic site preparation' }],
      availability: [{ employee_name: 'Synthetic Employee', confirmed: false }], resources: [], conflicts: [],
      packs: [{ snapshot: 'excluded pack' }], recent_packs: ['excluded older week'], audit: ['excluded audit'],
    } },
    get_walls_installation_snapshot: { data: { permissions: { view: true }, day_cards: [{ card_id: 'catchup-1', work_date: '2026-10-20' }], jobs: [], resource_conflicts: [] } },
    get_weekly_planner_agent_context: { data: { authorized: true, weeks: [] } },
    get_walls_installation_agent_context: { data: { authorized: true, jobs: [] } },
    get_schedule_snapshot: { data: snapshot },
    get_walls_production_weekly_forecast: { data: { daily: [{ date: '2026-10-20', plannedLf: 200, actualLf: 80 }] } },
    ...overrides,
  };
  return { calls, rpc(name, parameters) { calls.push({ name, parameters }); const result = results[name]; if (result instanceof Error) throw result; return Promise.resolve(result); } };
}

test('reads all seven allowlisted sources with same caller client and preserves live values', async () => {
  const mock = client();
  const { context, error } = await loadAuthorizedContext(mock, now);
  assert.equal(error, null);
  assert.equal(mock.calls.length, 7);
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
    get_weekly_planner_snapshot: { error: { message: 'Weekly Planner access required' }, data: { people: [{ secret: true }] } },
    get_walls_installation_snapshot: { data: { permissions: { view: false }, day_cards: [{ secret: true }] } },
    get_schedule_snapshot: { data: snapshot, error: { message: 'Denied' } },
    get_walls_production_weekly_forecast: { error: { message: 'Production access required' } },
  }), now);
  assert.equal(context.weekly_planner.status, 'not_authorized');
  for (const key of ['walls_installation', 'master_schedule', 'production_week', 'installation_workspace', 'planner_current_week']) assert.equal(context[key].status, 'unavailable');
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


test('current week supplies named employees and assignments without pack or audit payloads', async () => {
  const mock = client();
  const { context } = await loadAuthorizedContext(mock, now);
  assert.deepEqual(mock.calls.find(({ name }) => name === 'get_weekly_planner_snapshot').parameters, { p_week_start: '2026-10-19' });
  assert.equal(context.planner_current_week.people[0].employee_name, 'Synthetic Employee');
  assert.equal(context.planner_current_week.assignments[0].assignment_text, 'Synthetic site preparation');
  assert.equal(context.planner_current_week.week.source_stale, true);
  assert.equal(context.planner_current_week.availability[0].confirmed, false);
  assert.equal(context.planner_current_week.packs, undefined);
  assert.equal(JSON.stringify(context).includes('excluded'), false);
  assert.equal(context.context_coverage.status, 'within_size_limits');
});

test('planner week denial or absent view permission never supplies employee detail', async () => {
  for (const result of [{ data: { permissions: { view: false }, people: [{ employee_name: 'secret' }] } }, { data: null }, new Error('transport')]) {
    const { context } = await loadAuthorizedContext(client({ get_weekly_planner_snapshot: result }), now);
    assert.equal(context.planner_current_week.status, 'unavailable');
    assert.equal(context.planner_current_week.people, undefined);
  }
});

test('current-week Monday respects Chicago Sunday/Monday boundaries and DST', async () => {
  for (const [instant, monday] of [
    ['2026-10-19T04:59:00Z', '2026-10-12'], ['2026-10-19T05:00:00Z', '2026-10-19'],
    ['2026-03-08T08:01:00Z', '2026-03-02'], ['2026-03-09T05:00:00Z', '2026-03-09'],
    ['2026-11-01T07:01:00Z', '2026-10-26'], ['2026-11-02T06:00:00Z', '2026-11-02'],
  ]) {
    const mock = client();
    const { context } = await loadAuthorizedContext(mock, new Date(instant));
    assert.equal(context.planner_current_week.week_start, monday);
    assert.equal(mock.calls.find(({ name }) => name === 'get_weekly_planner_snapshot').parameters.p_week_start, monday);
  }
});

test('oversized master collection is omitted whole while normal jobs, walls and billing survive', async () => {
  const giant = 'SENSITIVE_LARGE_RECORD'.repeat(10000);
  const oversized = { ...snapshot, payload: { data: { ...data, audit: [{ note: giant }, { note: 'second record' }] } } };
  const { context } = await loadAuthorizedContext(client({ get_schedule_snapshot: { data: oversized } }), now);
  assert.equal(context.master_schedule.status, 'partial');
  assert.equal(context.master_schedule.coverage.audit.reason, 'collection_size_limit');
  assert.equal(context.master_schedule.coverage.audit.omitted_count, 2);
  assert.equal(context.master_schedule.coverage.audit.returned_count, 2);
  assert.equal(context.master_schedule.collections.audit, undefined);
  assert.deepEqual(context.master_schedule.collections.jobs, data.jobs);
  assert.deepEqual(context.master_schedule.collections.walls, data.walls);
  assert.deepEqual(context.master_schedule.collections.billing, data.billing);
  assert.deepEqual(context.master_schedule.omitted_collections, ['audit']);
  assert.equal(context.planner_current_week.people[0].employee_name, 'Synthetic Employee');
  assert.equal(context.context_coverage.status, 'partial');
  assert.deepEqual(context.context_coverage.omitted_sources, []);
  assert.deepEqual(context.context_coverage.omitted_master_collections, ['audit']);
  const encoded = new TextEncoder().encode(JSON.stringify(context));
  assert.ok(encoded.length <= contextLimits.total_bytes);
  assert.equal(JSON.stringify(context).includes('SENSITIVE_LARGE_RECORD'), false);
});

test('overall cap omits complete sources, not prefixes, and accounts for UTF-8 bytes', () => {
  const source = { jobs: [{ note: 'x'.repeat(26000) }, { id: 'last-row' }] };
  const input = { reporting: reportingClock(now), first: source, second: source, third: source, fourth: source, small: [{ id: 'keep' }] };
  const bounded = boundContext(input);
  assert.ok(new TextEncoder().encode(JSON.stringify(bounded)).length <= contextLimits.total_bytes);
  assert.ok(bounded.context_coverage.omitted_sources.length > 0);
  for (const key of ['first', 'second', 'third', 'fourth']) {
    if (bounded[key].status === 'omitted') {
      assert.equal(bounded[key].reason, 'total_context_size_limit');
      assert.equal(bounded[key].omitted_counts.jobs, 2);
      assert.equal(bounded[key].jobs, undefined);
    } else assert.deepEqual(bounded[key], source);
  }
  assert.deepEqual(bounded.small, input.small);
  assert.equal(input.first.jobs.length, 2);
  const unicode = boundContext({ reporting: reportingClock(now), inventory: [{ note: '界'.repeat(12000) }] });
  assert.equal(unicode.inventory.status, 'omitted');
  assert.equal(unicode.inventory.omitted_counts.records, 1);
  assert.ok(unicode.inventory.original_bytes > contextLimits.source_bytes);
});


test('aggregate cap can omit master source with counts including already omitted collections', () => {
  const records = Object.fromEntries(scheduleCollections.map((key) => [key, [{ note: 'x'.repeat(20000) }]]));
  records.audit = [{ note: 'x'.repeat(40000) }, { id: 'second' }];
  const master = scheduleContext({ data: { ...snapshot, payload: { data: records } } });
  const output = boundContext({ reporting: reportingClock(now), master_schedule: master });
  assert.equal(output.master_schedule.status, 'omitted');
  assert.equal(output.master_schedule.reason, 'total_context_size_limit');
  assert.equal(output.master_schedule.omitted_counts.audit, 2);
  assert.equal(output.master_schedule.omitted_counts.jobs, 1);
  assert.ok(new TextEncoder().encode(JSON.stringify(output)).length <= contextLimits.total_bytes);
  assert.equal(master.collections.audit.length, 2);
});


test('normal master collections together may exceed per-source cap without losing detail', () => {
  const records = { jobs: [{ note: 'j'.repeat(20000) }], walls: [{ note: 'w'.repeat(20000) }] };
  const master = scheduleContext({ data: { ...snapshot, payload: { data: records } } });
  const output = boundContext({ reporting: reportingClock(now), master_schedule: master });
  assert.equal(output.master_schedule.status, 'available');
  assert.deepEqual(output.master_schedule.collections, records);
  assert.equal(output.context_coverage.status, 'within_size_limits');
});

const completionSnapshot = (walls, extra = {}) => ({ data: { revision: 7, payload: { data: { walls, ...extra } } } });
const octoberClock = reportingClock(new Date('2026-10-21T12:00:00Z'));
test('monthly completion matches Hub including month-only and inactive records, without other collection duplicates', () => {
  const walls = [
    { id: 'a', lf: 100.12, completedDate: '2026-10-01', completedMonth: '2026-09' },
    { id: 'b', lf: '200.34', completedMonth: '2026-10', archived: true, status: 'Inactive' },
    { id: 'c', lf: 15, completedDate: '2026-10-21' },
    { id: 'd', lf: 20, completedDate: '2026-10-22' },
    { id: 'e', lf: 900, completedDate: '2026-09-30', completedMonth: '2026-10' },
    { id: 'f', lf: 900, productionDate: '2026-10-10', status: 'poured' },
    { id: 'g', lf: 900, completedDate: '2026-11-01' },
  ];
  const result = wallCompletionContext(completionSnapshot(walls, { historyArchive: walls, billing: walls }), octoberClock);
  assert.equal(result.lf_completed, 335.46);
  assert.equal(result.completed_jobs, 4);
  assert.equal(result.month_only_jobs, 1);
  assert.equal(result.month_only_lf, 200.34);
  assert.equal(result.future_dated_lf, 20);
  assert.equal(result.dated_through_today_lf, 115.12);
});
test('completion clock respects Chicago midnight, month boundary and year rollover', () => {
  for (const [utc, expected] of [['2026-11-01T04:59:59Z', '2026-10'], ['2026-11-01T05:00:00Z', '2026-11'], ['2027-01-01T05:59:59Z', '2026-12'], ['2027-01-01T06:00:00Z', '2027-01']]) {
    assert.equal(wallCompletionContext(completionSnapshot([]), reportingClock(new Date(utc))).month, expected);
  }
});
test('completion summary survives omitted wall details and does not use weekly or visible production numbers', async () => {
  const walls = Array.from({ length: 100 }, (_, i) => ({ id: `synthetic-${i}`, completedMonth: '2026-10', lf: 1.25, notes: 'x'.repeat(1000) }));
  const { context } = await loadAuthorizedContext(client({ get_schedule_snapshot: completionSnapshot(walls) }), now);
  assert.equal(context.master_schedule.coverage.walls.status, 'omitted');
  assert.equal(context.wall_completion_month.lf_completed, 125);
  context.production_week.actualPouredLf = 11;
  context.production = [{ actualLf: 22 }];
  const answer = completionAnswer('how many linear feet of walls were completed for october so far', context);
  assert.match(answer, /125\.00 LF/);
  assert.doesNotMatch(answer, /11\.00|22\.00/);
  assert.match(answer, /completion month only/);
});
test('denied, missing, malformed and omitted summaries cannot produce a partial monthly total', () => {
  for (const result of [{ error: { message: 'denied' }, data: completionSnapshot([]).data }, {}, completionSnapshot([null])]) {
    const metric = wallCompletionContext(result, octoberClock);
    assert.notEqual(metric.status, 'available');
    assert.equal(metric.lf_completed, undefined);
    assert.match(completionAnswer('how many LF of walls were completed this month?', { reporting: octoberClock, wall_completion_month: metric }), /cannot verify/);
  }
  assert.match(completionAnswer('how many LF of walls were completed this month?', { reporting: octoberClock, wall_completion_month: { status: 'omitted' } }), /cannot verify/);
});
test('shortcut never intercepts other periods, filtered questions, comparisons or writes', () => {
  const context = { reporting: octoberClock, wall_completion_month: wallCompletionContext(completionSnapshot([]), octoberClock) };
  for (const question of ['how many LF of walls were completed for September so far', 'how many LF of walls were completed for October 2025', 'how many LF of walls were completed for October for customer X', 'mark walls completed this month', 'how many LF of walls were completed for October and September']) assert.equal(completionAnswer(question, context), null);
  assert.match(completionAnswer('how many LF of walls were completed for October 2026 so far?', context), /0\.00 LF/);
  assert.match(completionAnswer('how many LF of walls were completed this month?', context), /authorized schedule/);
});
test('future-dated completions are explicitly not a verified through-today total', () => {
  const metric = wallCompletionContext(completionSnapshot([{ lf: 55, completedDate: '2026-10-31' }]), octoberClock);
  assert.match(completionAnswer('how many LF of walls were completed this month?', { reporting: octoberClock, wall_completion_month: metric }), /55\.00 LF dated after today; it is not a verified through-today total/);
});


test('normalized aggregate matches actual frontend helpers for legacy LF and dates without mutating snapshot', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const helperSource = html.slice(html.indexOf('const WALL_HEIGHTS='), html.indexOf('function wallLfSummary'))
    + html.slice(html.indexOf('function normalizeDate(value)'), html.indexOf('function parseDate(s)'))
    + html.slice(html.indexOf('function iso(d)'), html.indexOf('function addDays(s,n)'));
  const runtime = vm.createContext({});
  vm.runInContext(helperSource, runtime);
  const walls = [
    { lf: 10, lfByHeight: { h4: 25, h8: 15 }, lfUnassigned: 2, completedDate: '10/15/2026' },
    { lf: 80, lfByHeight: { h9: 50 }, completedDate: '2026-10-21T23:30:00Z' },
    { lf: -4, lfByHeight: { h5: 12 }, completedDate: '2026-10-1' },
    { lf: 'invalid', completedMonth: '2026-10' },
    { lf: 7, completedDate: '46306' },
    { lf: 100, completedDate: 'not a date', completedMonth: '2026-09' },
  ];
  const original = structuredClone(walls);
  runtime.walls = structuredClone(walls);
  const expected = vm.runInContext(`walls.map(w => ({...normalizeWallLF(w), completedDate: normalizeDate(w.completedDate)})).filter(w => (w.completedDate ? w.completedDate.slice(0,7) : w.completedMonth) === '2026-10').reduce((n,w) => n + Number(w.lf || 0), 0)`, runtime);
  const actual = wallCompletionContext(completionSnapshot(walls), octoberClock);
  assert.equal(actual.lf_completed, expected);
  assert.equal(actual.future_dated_jobs, 0);
  assert.deepEqual(walls, original);
});
