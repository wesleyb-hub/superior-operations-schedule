// Static scope guard; real role/owner behavior is tested in disposable PostgreSQL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const file = 'supabase/migrations/20261023150216_planner_conflict_rebuild_internal_only.sql';
const sql = fs.readFileSync(new URL(file, root), 'utf8');
assert.equal(sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().toLowerCase(),
  'revoke execute on function public.rebuild_weekly_planner_conflicts(date) from public, anon, authenticated;',
  'migration must only remove direct client EXECUTE on the one existing helper');

const migrations = fs.readdirSync(new URL('supabase/migrations/', root)).filter(f => f.endsWith('.sql')).sort();
const functions = new Map();
for (const file of migrations) {
  const text = fs.readFileSync(new URL('supabase/migrations/' + file, root), 'utf8');
  for (const match of text.matchAll(/create or replace function\s+public\.(\w+)\([\s\S]*?\bAS\s+(\$\w*\$)[\s\S]*?\2;/gi))
    functions.set(match[1], match[0]);
}
const callers = [...functions].filter(([name, text]) => name !== 'rebuild_weekly_planner_conflicts' && /\brebuild_weekly_planner_conflicts\s*\(/i.test(text));
assert.deepEqual(callers.map(([name]) => name).sort(), [
  'approve_weekly_planner_section', 'generate_weekly_planner', 'save_weekly_planner_inputs', 'save_weekly_planner_section'
]);
for (const [name, text] of callers) {
  assert.match(text, /security definer/i, name + ' must invoke the internal helper with its owner');
  assert.match(text, /if not public\.weekly_planner_permission\('(?:edit|approve)'/i, name + ' must retain an explicit write/approval gate');
}
function scan(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) scan(path);
    else if (/\.(?:[cm]?js|ts|html)$/.test(entry.name))
      assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /rebuild_weekly_planner_conflicts/, 'client/edge code must not call the internal-only helper');
  }
}
assert.doesNotMatch(fs.readFileSync(new URL('index.html', root), 'utf8'), /rebuild_weekly_planner_conflicts/);
scan(new URL('supabase/functions/', root));
console.log('PASS: single-helper ACL reduction only; four guarded SECURITY DEFINER callers; no frontend/edge direct caller.');
