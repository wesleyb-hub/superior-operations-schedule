import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const bootstrap=fs.readFileSync(new URL('../tests/integration/employee-owner-password-native-bootstrap.mjs',import.meta.url),'utf8');
const runner=fs.readFileSync(new URL('../tests/integration/employee-owner-password-native.mjs',import.meta.url),'utf8');
const workflow=fs.readFileSync(new URL('../.github/workflows/employee-owner-password-native.yml',import.meta.url),'utf8');
test('native bootstrap pins the final reviewed migration and exact full migration count',()=>{
 const recovery=fs.readFileSync(new URL('../tests/integration/employee-native-recovery-bootstrap.mjs',import.meta.url),'utf8');
 const migrations=fs.readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort();
 assert.equal(Number(bootstrap.match(/expectedMigrationCount=(\d+)/)[1]),migrations.length);
 assert.equal(bootstrap.match(/finalMigration='([^']+)'/)[1],migrations.at(-1));
 assert.equal(Number(recovery.match(/expectedMigrationCount=(\d+)/)[1]),migrations.length);
 assert.equal(recovery.match(/finalMigration='([^']+)'/)[1],migrations.at(-1));
});
test('scoped native matrix isolates two profiles by two provisioning modes under original rate budget',()=>{
 assert.match(workflow,/provisioning: \[no-password, password\]/);assert.match(workflow,/scope: \[mixed, readonly\]/);
 assert.match(workflow,/NATIVE_SCOPED_PROFILE: \$\{\{ matrix.scope \}\}/);
 assert.match(workflow,/name: employee-owner-password-native-result-\$\{\{ matrix.scope \}\}-\$\{\{ matrix.provisioning \}\}/);
 assert.match(bootstrap,/assert.equal\(employees\?\.length,3\)/);
 assert.match(bootstrap,/filter\(x=>\(x.profile\?\?'pilot'\)==='pilot'\)/);
 assert.doesNotMatch(runner,/truncate[^;]*budgets|delete\s+from\s+employee_password.budgets|update\s+employee_password.budgets/i);
});
test('native reader fixture uses exact reader scope and authentic permission-error assertions',()=>{
 assert.match(bootstrap,/values\(\$1,'hub_readonly_v1'/);assert.match(bootstrap,/HUB_READONLY_SCOPE.business_views,HUB_READONLY_SCOPE.wall_subviews/);
 assert.match(runner,/access.full_read_access===true&&access.can_write===false&&access.is_admin===false/);
 assert.match(runner,/p_reason:'synthetic reader'/);assert.match(runner,/deniedSaveBody.message==='Read-only account'/);assert.match(runner,/deniedOwnerBody.code==='42501'/);
 assert.match(runner,/fullGrantSnapshot\(\)===baselineFullGrants/);
});
