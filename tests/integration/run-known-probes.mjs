// Baseline records explicit expected failures, never silently reports them fixed.
// Fix branch uses --strict: every regression must then PASS without exceptions.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGDATABASE,'superior_workflow_test');
const strict=process.argv.includes('--strict');
const sql=name=>['psql',['-X','--set','ON_ERROR_STOP=1','-f','tests/integration/probes/'+name+'.sql']];
const probes=[
 ['missing-release',...sql('walls-null-release-regression'),/absent plan review fails closed \(operation unexpectedly succeeded\)/],
 ['null-revision',...sql('null-revision-regression'),/missing master revision cannot bypass stale-write protection \(operation unexpectedly succeeded\)/],
 ['named-table',...sql('named-table-planner'),/invalid input syntax for type integer: "TEST-NAMED-TABLE-A"/],
 ['allocation-race','node',['tests/integration/probes/allocation-concurrency.mjs'],/Concurrent allocations exceeded authoritative 100 LF: 120/],
];
const output='artifacts/disposable-workflow';mkdirSync(output,{recursive:true});const results=[];
for(const [name,command,args,expected]of probes){
 const r=spawnSync(command,args,{encoding:'utf8',timeout:45000});const log=(r.stdout||'')+(r.stderr||'');writeFileSync(output+'/'+name+'.log',log);
 const passed=r.status===0,known=!passed&&expected.test(log);results.push({name,status:passed?'PASS':known?'KNOWN FAILURE — NOT FIXED':'UNEXPECTED FAILURE',exit:r.status});
 console.log(name+': '+results.at(-1).status);
 if(strict? !passed:!known)throw Error(name+': '+log);
}
writeFileSync(output+'/regression-probes.json',JSON.stringify({mode:strict?'strict fixed-code regression':'baseline known failures (not fixes)',results},null,2));
