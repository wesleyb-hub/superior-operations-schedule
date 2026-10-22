// Exercise the real planner renderer, loader and realtime subscriber together.
// Transport and time are synthetic: this suite never contacts a database.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function renderWeeklyPlanner(');
const end = html.indexOf('async function weeklyPlannerRpc(', start);
assert.ok(start >= 0 && end > start, 'actual planner read/render/subscription functions exist');
const source = html.slice(start, end);
const tick = () => new Promise(resolve => setImmediate(resolve));
const success = marker => ({ data: { marker, sections: [] }, error: null });

function setup() {
  const calls = [], channels = [], timers = new Map();
  let clock = 0, timerId = 0, active = 0, maximumActive = 0, renders = 0;
  const view = {
    value: '',
    set innerHTML(value) { this.value = value; renders++; },
    get innerHTML() { return this.value; },
  };
  const context = {
    Promise, console: { error() {} }, hubSessionEpoch: 0,
    state: { week: '2026-10-26', view: 'weekly-planner', weeklyPlannerView: 'dashboard' },
    currentUser: { id: 'synthetic-admin' }, currentUserIsAdmin: true,
    weeklyPlanner: {}, weeklyPlannerReady: false, weeklyPlannerError: '',
    weeklyPlannerDraftError: '', weeklyPlannerErrorWeek: '',
    weeklyPlannerRealtimePromise: null, weeklyPlannerRealtimeDirty: false,
    weeklyPlannerLoadPromise: null, weeklyPlannerLoadToken: null,
    weeklyPlannerLoadWeek: '', weeklyPlannerLoadedWeek: '', weeklyPlannerBusy: false,
    weeklyPlannerChannel: null, weeklyPlannerChannelWeek: '', weeklyPlannerRefreshTimer: null,
    weeklyPlannerProgress: null, weeklyPlannerManualRefreshRequest: null,
    document: { body: { classList: { remove() {} } }, getElementById: () => view },
    // Presentation-only children and click binding are outside the read budget.
    // In particular, do not replace renderWeeklyPlanner or subscribeWeeklyPlanner.
    htmlSafe: String, plannerTabs: () => '', plannerHeader: () => '',
    plannerDashboard: () => '<p>Synthetic snapshot</p>', bindWeeklyPlanner() {},
    setTimeout(callback, delay) {
      timers.set(++timerId, { callback, due: clock + delay });
      return timerId;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  context.sb = {
    rpc(name, args) {
      assert.equal(name, 'get_weekly_planner_snapshot');
      active++;
      maximumActive = Math.max(maximumActive, active);
      return new Promise((resolve, reject) => {
        let settled = false;
        calls.push({
          name, args,
          resolve(result) {
            if (settled) return;
            settled = true; active--; resolve(result);
          },
          reject(error) {
            if (settled) return;
            settled = true; active--; reject(error);
          },
        });
      });
    },
    channel(name) {
      const channel = {
        name, handlers: [],
        on(event, filter, callback) { this.handlers.push({ event, filter, callback }); return this; },
        subscribe() { return this; },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel() {},
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  async function advance(delay = 450) {
    clock += delay;
    for (const [id, timer] of [...timers]) {
      if (timer.due > clock) continue;
      timers.delete(id);
      timer.callback();
    }
    await tick();
  }
  // Cycle through all three actual table subscriptions, across debounce windows.
  function notify(index = 0) {
    channels.at(-1).handlers[index % 3].callback({ eventType: 'UPDATE' });
  }
  async function renderAndLoad() {
    context.renderWeeklyPlanner();
    await tick();
    calls[0].resolve(success('initial'));
    await tick();
  }
  return {
    context, calls, channels, view, advance, notify, renderAndLoad,
    maximumActive: () => maximumActive, active: () => active, renders: () => renders,
  };
}

test('609 spaced realtime events behind a stalled initial render issue only one read, then one trailing read', async () => {
  const f = setup();
  f.context.renderWeeklyPlanner();
  await tick();
  for (let i = 0; i < 609; i++) {
    f.notify(i);
    await f.advance();
  }
  assert.equal(f.calls.length, 1);
  assert.equal(f.maximumActive(), 1);
  assert.equal(f.channels.length, 1, 're-rendering must not duplicate subscriptions');
  assert.equal(f.channels[0].handlers.length, 3);
  assert.equal(f.channels[0].handlers[0].filter.filter, 'week_start=eq.2026-10-26');

  f.calls[0].resolve(success('initial'));
  await tick();
  assert.equal(f.calls.length, 2, 'notifications still require one fresh post-event snapshot');
  f.calls[1].resolve(success('fresh'));
  await tick();
  await f.advance(60_000);
  assert.equal(f.calls.length, 2, 'settling/rendering must not schedule another refresh by itself');
  assert.equal(f.maximumActive(), 1);
  assert.equal(f.active(), 0);
  assert.equal(f.context.weeklyPlanner.marker, 'fresh');
  assert.equal(f.channels.length, 1);
});

for (const reject of [false, true]) {
  test(`realtime ${reject ? 'rejection' : 'error response'} pauses 609 later events and renders for that week`, async () => {
    const f = setup();
    await f.renderAndLoad();
    f.notify();
    await f.advance();
    assert.equal(f.calls.length, 2);
    const message = reject ? 'Synthetic 504 network failure' : 'Synthetic 500 statement timeout';
    if (reject) f.calls[1].reject(new Error(message));
    else f.calls[1].resolve({ error: { message } });
    await tick();
    for (let i = 0; i < 609; i++) {
      f.notify(i);
      await f.advance();
      f.context.renderWeeklyPlanner();
      await tick();
    }
    assert.equal(f.calls.length, 2, 'neither realtime nor rendering may silently retry failures');
    assert.equal(f.maximumActive(), 1);
    assert.equal(f.active(), 0);
    assert.equal(f.context.weeklyPlannerError, message);
    assert.match(f.view.innerHTML, /Try again/);
    assert.equal(f.channels.length, 1);
  });
}

test('1,000 successful planner re-renders reuse the snapshot and original realtime subscription', async () => {
  const f = setup();
  await f.renderAndLoad();
  for (let i = 0; i < 1000; i++) {
    f.context.renderWeeklyPlanner();
    await tick();
  }
  await f.advance(60_000);
  assert.equal(f.calls.length, 1);
  assert.equal(f.channels.length, 1);
  assert.equal(f.renders(), 1002, 'initial loading and completion renders also ran');
  assert.equal(f.context.weeklyPlannerReady, true);
  assert.equal(f.active(), 0);
});

test('failed initial render does not self-retry or retry on later redraws and notifications', async () => {
  const f = setup();
  f.context.renderWeeklyPlanner();
  await tick();
  f.calls[0].reject(new Error('Synthetic initial timeout'));
  await tick();
  for (let i = 0; i < 100; i++) {
    f.context.renderWeeklyPlanner();
    f.notify(i);
    await f.advance();
  }
  assert.equal(f.calls.length, 1);
  assert.equal(f.context.weeklyPlannerErrorWeek, f.context.state.week);
  assert.match(f.view.innerHTML, /Synthetic initial timeout/);
  assert.equal(f.channels.length, 1);
});

test('presentation exception after a snapshot is a latched failure, not a renderer-triggered request loop', async () => {
  const f = setup();
  f.context.plannerDashboard = () => { throw new Error('Synthetic child renderer failure'); };
  await f.renderAndLoad();
  for (let i = 0; i < 100; i++) {
    f.context.renderWeeklyPlanner();
    f.notify(i);
    await f.advance();
  }
  assert.equal(f.calls.length, 1);
  assert.match(f.context.weeklyPlannerError, /child renderer failure/);
  assert.equal(f.active(), 0);
});
