// Prove every changed function is an exact prior definition with only the reviewed guards changed.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const directory=new URL('../supabase/migrations/',import.meta.url);
const files=fs.readdirSync(directory).filter(x=>x.endsWith('.sql')).sort();
const versionFile='20261022004702_mandatory_version_tokens_fail_closed.sql';
const agentFile='20261022004708_agent_confirmation_fail_closed.sql';
const extract=sql=>[...sql.replaceAll("\r\n","\n").matchAll(/create or replace function\s+public\.(\w+)\([\s\S]*?\bAS\s+(\$\w*\$)[\s\S]*?\2;/gi)].map(m=>[m[1],m[0]]);
const previous=new Map();
for(const file of files.filter(x=>x<versionFile))for(const [name,definition]of extract(fs.readFileSync(new URL(file,directory),'utf8')))previous.set(name,definition);
const versions=fs.readFileSync(new URL(versionFile,directory),'utf8'),agent=fs.readFileSync(new URL(agentFile,directory),'utf8');
const names=['upsert_walls_production_assignment','set_inventory_item','set_inventory_count','save_weekly_planner_section','approve_weekly_planner_section','set_walls_installation_activity_assignments','save_walls_installation_activity','update_walls_installation_resource'];
assert.deepEqual(extract(versions).map(([name])=>name),names);
for(const [name,definition]of extract(versions)){
 const old=previous.get(name);assert.ok(old,`${name} already exists`);
 const expected=old.replace(/(\w+\.(?:version|schedule_version))\s*<>\s*p_expected_version/gi,'$1 is distinct from p_expected_version');
 assert.notEqual(old,expected,`${name} must replace an existing mandatory check`);assert.equal(definition,expected,`${name}: only null semantics may change`);
}
const agentName='execute_operations_agent_action',old=previous.get(agentName);
const expected=old.replace("  if p_confirmation<>'CONFIRM'","  if auth.uid() is null then raise exception 'Authentication required'; end if;\n  if p_confirmation is distinct from 'CONFIRM'")
 .replace('v_action.requested_by_user_id<>auth.uid()','v_action.requested_by_user_id is distinct from auth.uid()')
 .replaceAll('v_item.version<>v_expected','v_item.version is distinct from v_expected')
 .replaceAll('v_assignment.version<>v_expected','v_assignment.version is distinct from v_expected');
assert.deepEqual(extract(agent),[[agentName,expected]]);
const prerequisite=versions.match(/do \$allocation_prerequisite\$[\s\S]*?\$allocation_prerequisite\$;/)?.[0];
assert.ok(prerequisite,'allocation prerequisite must be checked before replacing any function');
assert.ok(versions.indexOf(prerequisite)<versions.indexOf('create or replace function'));
assert.match(prerequisite,/pg_catalog\.pg_get_functiondef\(v_signature::regprocedure\)/);
assert.match(prerequisite,/validate_walls_production_assignment\(\)/);
assert.match(prerequisite,/upsert_walls_production_assignment\(uuid,text,text,numeric,numeric/);
assert.match(prerequisite,/position\('pg_advisory_xact_lock' in v_definition\)=0/);
assert.match(prerequisite,/position\('superior_walls_production_allocation:' in v_definition\)=0/);
assert.doesNotMatch(prerequisite,/\b(?:execute|insert|update|delete|grant|revoke)\b/i,'prerequisite is read-only');
for(const sql of [versions.replace(prerequisite,''),agent]){
 const outside=sql.replace(/--[^\n]*/g,'').replace(/create or replace function\s+public\.\w+\([\s\S]*?\bAS\s+(\$\w*\$)[\s\S]*?\1;/gi,'');
 assert.match(outside,/^\s*begin;\s*commit;\s*$/i,'no unrelated statements, permission or data changes');
}
console.log('PASS: nine existing definitions change only mandatory NULL guards; signatures, permissions, defaults and optional-token APIs unchanged');
