// Only existing read RPCs, executed with the caller's authenticated client.
// Do not replace these with raw-table queries or an elevated client.
export const scheduleCollections = Object.freeze([
  'walls', 'jobs', 'billing', 'loads', 'deliveryHistory', 'qcHistory', 'audit', 'historyArchive',
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const unavailable = (status = 'unavailable') => ({ status, read_only: true });

async function read(client, name, parameters) {
  try {
    return await client.rpc(name, parameters);
  } catch {
    // A transport failure is not an empty dataset or an authorization decision.
    return { data: null, error: { message: 'Context source unavailable' } };
  }
}

function optionalContext(result) {
  if (result.error || !isObject(result.data)) return unavailable();
  if (result.data.authorized !== true) return unavailable('not_authorized');
  return { ...result.data, status: 'available', read_only: true };
}

export function scheduleContext(result) {
  if (result.error || !isObject(result.data?.payload?.data)) return unavailable();
  const snapshot = result.data;
  const data = snapshot.payload.data;
  const collections = {};
  const coverage = {};
  for (const key of scheduleCollections) {
    // Preserve exactly the records returned by the permission-filtered RPC.
    // Never rehydrate empty restricted collections from another source.
    if (!Array.isArray(data[key])) {
      coverage[key] = { status: 'unavailable' };
      continue;
    }
    collections[key] = data[key];
    coverage[key] = { status: 'available', returned_count: data[key].length };
  }
  return {
    status: 'available', read_only: true,
    source: 'get_schedule_snapshot', revision: snapshot.revision,
    updated_at: snapshot.updated_at, schema_version: snapshot.payload.schemaVersion,
    scope: 'Caller-visible records only; empty collections may be permission-filtered, not company-wide zeroes.',
    collections, coverage,
  };
}

export const contextLimits = Object.freeze({ source_bytes: 32 * 1024, total_bytes: 96 * 1024 });
const byteSize = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const countKeys = ['sections', 'people', 'assignments', 'availability', 'resources', 'conflicts',
  'weeks', 'jobs', 'day_cards', 'resource_conflicts', 'daily', ...scheduleCollections];

function recordCounts(value) {
  if (Array.isArray(value)) return { records: value.length };
  if (isObject(value?.coverage)) {
    return Object.fromEntries(scheduleCollections.filter((key) => Number.isInteger(value.coverage[key]?.returned_count))
      .map((key) => [key, value.coverage[key].returned_count]));
  }
  const records = isObject(value?.collections) ? value.collections : value;
  return Object.fromEntries(countKeys.filter((key) => Array.isArray(records?.[key]))
    .map((key) => [key, records[key].length]));
}

export function boundContext(context) {
  const bounded = { ...context };
  const omitted = new Set();
  const omittedCollections = [];
  const master = context.master_schedule;
  if (isObject(master?.collections)) {
    bounded.master_schedule = { ...master, collections: { ...master.collections }, coverage: { ...master.coverage } };
    for (const [key, records] of Object.entries(master.collections)) {
      const size = byteSize(records);
      if (size <= contextLimits.source_bytes) continue;
      delete bounded.master_schedule.collections[key];
      bounded.master_schedule.coverage[key] = {
        status: 'omitted', reason: 'collection_size_limit', returned_count: records.length,
        omitted_count: records.length, original_bytes: size,
      };
      omittedCollections.push(key);
    }
    if (omittedCollections.length) {
      bounded.master_schedule.status = 'partial';
      bounded.master_schedule.omitted_collections = omittedCollections;
    }
  }
  const sizes = Object.fromEntries(Object.entries(bounded).filter(([key]) => key !== 'reporting')
    .map(([key, value]) => [key, byteSize(value)]));
  const omit = (key, reason) => {
    omitted.add(key);
    bounded[key] = {
      status: 'omitted', read_only: true, reason, original_bytes: byteSize(context[key]),
      omitted_counts: recordCounts(context[key]),
    };
  };
  for (const [key, size] of Object.entries(sizes)) {
    if (key !== 'master_schedule' && size > contextLimits.source_bytes) omit(key, 'source_size_limit');
  }
  const coverage = () => {
    bounded.context_coverage = {
      status: omitted.size || omittedCollections.length ? 'partial' : 'within_size_limits',
      limits: contextLimits, omitted_sources: [...omitted],
      omitted_master_collections: omittedCollections,
      note: 'Counts describe caller-returned records only, not company-wide totals. Omitted sources contain no record details.',
    };
  };
  coverage();
  // Drop whole largest sources, not a misleading prefix of rows. No model input
  // exceeds the overall byte budget; other normal-size sources remain intact.
  for (const key of Object.keys(sizes).sort((a, b) => sizes[b] - sizes[a])) {
    if (byteSize(bounded) <= contextLimits.total_bytes) break;
    if (omitted.has(key)) continue;
    omit(key, 'total_context_size_limit');
    coverage();
  }
  return bounded;
}

export function plannerWeekContext(result, weekStart) {
  if (result.error || !isObject(result.data) || result.data.permissions?.view !== true) return unavailable();
  const data = result.data;
  // Do not copy published pack snapshots, cross-week recent packs or audit.
  const fields = ['week', 'sections', 'people', 'assignments', 'availability', 'resources', 'conflicts'];
  return {
    ...Object.fromEntries(fields.filter((key) => key in data).map((key) => [key, data[key]])),
    status: 'available', read_only: true, week_start: weekStart,
    current_source_fingerprint: data.current_source_fingerprint,
    scope: 'Existing whole-week view authorization; current reporting week only.',
  };
}

export function reportingClock(now = new Date()) {
  // Match the existing production actual-event reporting timezone, not the browser clock.
  const timezone = 'America/Chicago';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((value) => value.type === type).value;
  return { generated_at: now.toISOString(), timezone, today: `${part('year')}-${part('month')}-${part('day')}` };
}

export async function loadAuthorizedContext(client, now = new Date()) {
  const reporting = reportingClock(now);
  const shiftDay = (days) => new Date(Date.parse(`${reporting.today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const dayOfWeek = new Date(`${reporting.today}T12:00:00Z`).getUTCDay();
  const monday = shiftDay(-((dayOfWeek + 6) % 7));
  const installationRange = { p_from: shiftDay(-7), p_to: shiftDay(45) };
  const [base, planner, installation, schedule, forecast, installationSnapshot, plannerSnapshot] = await Promise.all([
    read(client, 'get_operations_agent_context'),
    read(client, 'get_weekly_planner_agent_context'),
    read(client, 'get_walls_installation_agent_context'),
    read(client, 'get_schedule_snapshot'),
    read(client, 'get_walls_production_weekly_forecast', { p_week_start: reporting.today }),
    read(client, 'get_walls_installation_snapshot', installationRange),
    read(client, 'get_weekly_planner_snapshot', { p_week_start: monday }),
  ]);
  // The existing base-context RPC remains the mandatory authorization gate.
  if (base.error || !isObject(base.data) || base.data.access?.authorized !== true) {
    return { context: null, error: base.error ?? { message: 'Authorized operations context unavailable' } };
  }
  return {
    error: null,
    context: boundContext({
      access: base.data.access,
      generated_at: base.data.generated_at ?? null,
      inventory: base.data.inventory ?? [],
      production: base.data.production ?? [],
      reporting,
      production_week: forecast.error || !isObject(forecast.data) ? unavailable() : {
        ...forecast.data, status: 'available', read_only: true,
      },
      weekly_planner: optionalContext(planner),
      planner_current_week: plannerWeekContext(plannerSnapshot, monday),
      walls_installation: optionalContext(installation),
      master_schedule: scheduleContext(schedule),
      installation_workspace: installationSnapshot.error || !isObject(installationSnapshot.data)
        || installationSnapshot.data.permissions?.view !== true ? unavailable() : {
          ...installationSnapshot.data, status: 'available', read_only: true,
          date_range: { from: installationRange.p_from, to: installationRange.p_to },
        },
    }),
  };
}
