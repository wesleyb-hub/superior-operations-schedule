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

// Mirrored pure normalization helpers; parity-tested against index.html to prevent drift.
const WALL_HEIGHTS=[
  {key:'h4',label:'4′'},{key:'h5',label:'5′'},{key:'h8',label:'8′'},{key:'h9',label:'9′'},{key:'h10',label:'10′'},{key:'h12',label:'12′'}
];
function nonnegativeNumber(value){const n=Number(value||0);return Number.isFinite(n)?Math.max(0,n):0}
function wallHeightBreakdown(w){const raw=w?.lfByHeight||{};return Object.fromEntries(WALL_HEIGHTS.map(h=>[h.key,nonnegativeNumber(raw[h.key])]))}
function wallHeightTotal(w){const b=wallHeightBreakdown(w);return WALL_HEIGHTS.reduce((n,h)=>n+b[h.key],0)}
function normalizeWallLF(w){
  const hadBreakdown=Boolean(w.lfByHeight&&typeof w.lfByHeight==='object');
  const breakdown=wallHeightBreakdown(w),heightTotal=WALL_HEIGHTS.reduce((n,h)=>n+breakdown[h.key],0);
  const legacyTotal=nonnegativeNumber(w.lf),explicitUnassigned=w.lfUnassigned!==undefined&&w.lfUnassigned!==null;
  const unassigned=explicitUnassigned?nonnegativeNumber(w.lfUnassigned):(hadBreakdown?Math.max(0,legacyTotal-heightTotal):legacyTotal);
  w.lfByHeight=breakdown;w.lfUnassigned=unassigned;w.lf=heightTotal+unassigned;return w
}
function normalizeDate(value){
  if(value===null||value===undefined)return'';
  let s=String(value).trim();
  if(!s)return'';

  let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m){
    const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
    const dt=new Date(Date.UTC(y,mo-1,d));
    return Number.isNaN(dt.getTime())?'':iso(dt)
  }

  m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m){
    const mo=Number(m[1]),d=Number(m[2]),y=Number(m[3]);
    const dt=new Date(Date.UTC(y,mo-1,d));
    if(Number.isNaN(dt.getTime())||dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d)return'';
    return iso(dt)
  }

  if(/^\d+(\.\d+)?$/.test(s)){
    const serial=Number(s);
    if(serial>20000&&serial<80000){
      const dt=new Date(Date.UTC(1899,11,30)+Math.floor(serial)*86400000);
      return Number.isNaN(dt.getTime())?'':iso(dt)
    }
  }

  const guess=new Date(s);
  if(!Number.isNaN(guess.getTime())){
    return iso(new Date(Date.UTC(guess.getFullYear(),guess.getMonth(),guess.getDate())))
  }
  return''
}
function iso(d){
  if(!(d instanceof Date)||Number.isNaN(d.getTime()))return'';
  return d.toISOString().slice(0,10)
}

// Match renderWallsMonthly / wallCompletionMonth, not production pour events.
// Compute from the complete caller-returned snapshot BEFORE detail size limits.
export function wallCompletionContext(result, reporting) {
  const walls = result.data?.payload?.data?.walls;
  if (result.error || !Array.isArray(walls)) return unavailable();
  const month = reporting.today.slice(0, 7);
  if (walls.some((wall) => !isObject(wall))) return unavailable('invalid_completion_records');
  const normalized = walls.map((wall) => ({ ...normalizeWallLF({ ...wall }), completedDate: normalizeDate(wall.completedDate) }));
  const matching = normalized.filter((wall) => wall &&
    (wall.completedDate ? String(wall.completedDate).slice(0, 7) : wall.completedMonth || '') === month);
  const values = matching.map((wall) => Number(wall.lf || 0));
  if (values.some((value) => !Number.isFinite(value))) return unavailable('invalid_completion_values');
  const monthOnly = matching.filter((wall) => !wall.completedDate);
  const future = matching.filter((wall) => wall.completedDate && wall.completedDate > reporting.today);
  const sum = (rows) => Number(rows.reduce((total, wall) => total + Number(wall.lf || 0), 0).toFixed(2));
  return {
    status: 'available', read_only: true, source: 'get_schedule_snapshot.walls',
    revision: result.data.revision, updated_at: result.data.updated_at,
    metric: 'Superior Walls Monthly Completion: LF Completed', month,
    as_of: reporting.today, timezone: reporting.timezone,
    scope: 'Complete caller-returned walls collection; not an assertion of company-wide access.',
    definition: 'Normalize wall LF and completion date exactly as the Hub; sum wall.lf where completedDate month, otherwise completedMonth, equals month. No active/status filter. Do not add production, forecast, billing or historyArchive rows.',
    completed_jobs: matching.length, lf_completed: sum(matching),
    month_only_jobs: monthOnly.length, month_only_lf: sum(monthOnly),
    future_dated_jobs: future.length, future_dated_lf: sum(future),
    dated_through_today_lf: sum(matching.filter((wall) => wall.completedDate && wall.completedDate <= reporting.today)),
    limitation: 'Hub monthly total includes month-only completion records and any future-dated completions. Month-only records have no verified completion day. This is not actual poured LF.',
  };
}

// Narrow, read-only shortcut for the unambiguous current-month KPI question.
// Other periods, job filters, comparisons and action requests remain with the model.
export function completionAnswer(message, context) {
  const today = context?.reporting?.today;
  if (!today) return null;
  const monthName = new Date(`${today.slice(0, 7)}-01T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
  const month = `(?:this month|${monthName}(?: ${today.slice(0, 4)})?)`;
  const pattern = new RegExp(`^how many (?:linear feet|lf) of (?:superior )?walls (?:were |have been )?completed (?:for |in )?${month}(?: so far| to date)?[?.!]*$`, 'i');
  if (!pattern.test(message.trim().replace(/\s+/g, ' '))) return null;
  const metric = context.wall_completion_month;
  if (metric?.status !== 'available') return 'I cannot verify the current month’s LF Completed because the authorized wall completion summary is unavailable. Weekly pours and partial production records are not a substitute.';
  const format = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let answer = `As of ${today} (${context.reporting.timezone}), the Hub’s recorded ${metric.month} **LF Completed is ${format(metric.lf_completed)} LF**, across ${metric.completed_jobs} wall jobs in your authorized schedule. This matches the Monthly Completion calculation, not weekly poured LF.`;
  if (metric.month_only_jobs) answer += ` ${metric.month_only_jobs} jobs (${format(metric.month_only_lf)} LF) have a completion month only, so their exact completion dates cannot be verified.`;
  if (metric.future_dated_jobs) answer += ` The monthly total includes ${format(metric.future_dated_lf)} LF dated after today; it is not a verified through-today total.`;
  answer += ` Source: get_schedule_snapshot.walls, revision ${metric.revision ?? 'unavailable'}.`;
  return answer;
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
      wall_completion_month: wallCompletionContext(schedule, reporting),
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
