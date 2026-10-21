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
  const installationRange = { p_from: shiftDay(-7), p_to: shiftDay(45) };
  const [base, planner, installation, schedule, forecast, installationSnapshot] = await Promise.all([
    read(client, 'get_operations_agent_context'),
    read(client, 'get_weekly_planner_agent_context'),
    read(client, 'get_walls_installation_agent_context'),
    read(client, 'get_schedule_snapshot'),
    read(client, 'get_walls_production_weekly_forecast', { p_week_start: reporting.today }),
    read(client, 'get_walls_installation_snapshot', installationRange),
  ]);
  // The existing base-context RPC remains the mandatory authorization gate.
  if (base.error || !isObject(base.data) || base.data.access?.authorized !== true) {
    return { context: null, error: base.error ?? { message: 'Authorized operations context unavailable' } };
  }
  return {
    error: null,
    context: {
      ...base.data,
      reporting,
      production_week: forecast.error || !isObject(forecast.data) ? unavailable() : {
        ...forecast.data, status: 'available', read_only: true,
      },
      weekly_planner: optionalContext(planner),
      walls_installation: optionalContext(installation),
      master_schedule: scheduleContext(schedule),
      installation_workspace: installationSnapshot.error || !isObject(installationSnapshot.data)
        || installationSnapshot.data.permissions?.view !== true ? unavailable() : {
          ...installationSnapshot.data, status: 'available', read_only: true,
          date_range: { from: installationRange.p_from, to: installationRange.p_to },
        },
    },
  };
}
