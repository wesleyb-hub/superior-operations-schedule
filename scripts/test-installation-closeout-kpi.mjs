import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fn=source.match(/^function installationJobNeedsCloseout\(job\).*$/m)?.[0];
assert.ok(fn,'Actual frontend helper exists');
const needs=vm.runInNewContext(fn+';installationJobNeedsCloseout');
const activity=(status,type='field_closeout')=>({activity_type:type,status});
for(const [name,job,expected] of [
 ['fully installed without separately scheduled closeout',{overall_status:'Installation Complete',activities:[]},true],
 ['pending closeout outside visible activity date range',{overall_status:'Closeout Pending',activities:[]},true],
 ['verified field complete',{overall_status:'Field Complete',installation:{closeout:{field_complete:true}}},false],
 ['authoritative field-complete status takes precedence over stale activity view',{overall_status:'Field Complete',activities:[activity('planned')]},false],
 ['one completed partial run does not mean the full job is installed',{overall_status:'Installation In Progress',activities:[activity('completed','wall_installation')]},false],
 ['scheduled but not installed',{overall_status:'Scheduled',activities:[]},false],
 ['cancelled closeout does not create pending work',{overall_status:'Scheduled',activities:[activity('cancelled')]},false],
 ['finished closeout activity alone does not create pending work',{overall_status:'Scheduled',activities:[activity('completed')]},false],
 ['held job with explicit planned closeout',{overall_status:'On Hold',activities:[activity('planned')]},true],
 ['held job with active closeout',{overall_status:'On Hold',activities:[activity('in_progress')]},true],
 ['held job with held closeout',{overall_status:'On Hold',activities:[activity('on_hold')]},true],
 ['held job without explicit closeout remains in hold KPI only',{overall_status:'On Hold',installation:{closeout:{field_complete:true}},activities:[]},false],
 ['raw field flag cannot override authoritative incomplete closeout',{overall_status:'Installation Complete',installation:{closeout:{field_complete:true}}},true],
 ['missing snapshot fields do not imply completion',{},false],
])test(name,()=>assert.equal(needs(job),expected));
test('rendered metric counts current displayed jobs and describes its scope',()=>{
 assert.match(source,/closeout=fieldJobs\.filter\(installationJobNeedsCloseout\)\.length/);
 assert.match(source,/Displayed field jobs with installation complete or closeout pending/);
 assert.match(source,/>Jobs awaiting closeout<\/span>/);
});
