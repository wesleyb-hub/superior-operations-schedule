import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='supabase/migrations/20261025133923_employee_approved_crew_packs.sql';
const sql=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const functions=[...sql.matchAll(/create or replace function\s+([\w.]+)\([^]*?as \$\$([^]*?)\$\$;/gi)];
assert.deepEqual(functions.map(x=>x[1]),[
 'employee_pack_private.pack_text','employee_pack_private.approved_crew_packs','public.get_employee_approved_crew_packs'
]);
const outside=sql.replace(/--[^\n]*/g,'').replace(/create or replace function[^]*?\$\$[^]*?\$\$;/gi,'');
for(const statement of outside.split(';').map(s=>s.trim()).filter(Boolean)){
 assert.match(statement,/^(begin|commit|create schema if not exists employee_pack_private|revoke all on (schema employee_pack_private|function (employee_pack_private|public)\.)|grant (usage on schema employee_pack_private|execute on function (employee_pack_private|public)\.))/i,`Unexpected top-level SQL: ${statement}`);
}
assert.doesNotMatch(sql,/\b(insert into|update public\.|delete from|alter table|create policy|drop policy|grant select|weekly_planner_permission\s*\()\b/i,'No new underlying planner/data grants or business writes');
assert.match(functions[1][2],/auth\.uid\(\) is null/);
assert.match(functions[1][2],/is_anonymous/);
assert.match(functions[1][2],/a\.enabled/);
assert.match(functions[1][2],/a\.division_key='walls' and a\.inventory_area='production'/);
assert.match(functions[1][2],/'weekly-planner'=any\(a\.allowed_views\)/);
assert.doesNotMatch(functions[1][2],/is_operations_admin|user_metadata|to_jsonb\(/,'No broad bypass, user-editable authority, raw row serialization');
assert.match(functions[1][2],/w\.status='approved'/);
assert.equal([...functions[1][2].matchAll(/public\.weekly_planner_source_fingerprint\(p_week_start\)/g)].length,1,'Current source compared exactly once');
assert.doesNotMatch(functions[1][2],/get_weekly_planner_snapshot|rebuild_weekly_planner_conflicts|generate_weekly_planner/,'No snapshots, mutation or recomputation of planner rows');
assert.match(functions[1][2],/s\.status='approved' and x#>>'\{section,status\}'='approved'/);
assert.match(functions[1][2],/s\.schedule_version::text=x#>>'\{section,schedule_version\}'/);
assert.match(functions[0][2],/jsonb_typeof\(p_data->p_key\)='string'/);
assert.match(sql,/public\.get_employee_approved_crew_packs\(p_week_start date\)\s+returns jsonb language sql stable security invoker set search_path=pg_catalog/);
assert.match(sql,/revoke all on function public\.get_employee_approved_crew_packs\(date\) from public,anon,authenticated/);
console.log('PASS: isolated employee approved-pack source/privilege/allowlist contract');
