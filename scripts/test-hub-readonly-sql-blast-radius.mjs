import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const baseline=readFileSync(new URL('../supabase/migrations/20261025133736_employee_scoped_read_projections.sql',import.meta.url),'utf8');
const candidate=readFileSync(new URL('../supabase/migrations/20261027133019_hub_readonly_scope.sql',import.meta.url),'utf8');
const block=(text,name)=>text.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?\\$\\$;'))?.[0];
const guard="  if public.has_hub_readonly_profile() then raise exception 'Read-only account'; end if;\n";
for(const name of ['execute_operations_agent_action','reject_operations_agent_action'])test(name+' changes only one early reader guard',()=>{
 const before=block(baseline,name),after=block(candidate,name);assert.ok(before&&after);
 assert.equal(after,before.replace('begin\n','begin\n'+guard));
 assert.equal(after.split(guard).length-1,1);
});
test('proposal definition and current-week wrapper ACL remain unchanged',()=>{
 assert.equal(block(candidate,'create_operations_agent_proposal'),undefined);
 assert.ok(!candidate.includes('capture_current_walls_production_weekly_forecast'));
 const proposal=block(baseline,'create_operations_agent_proposal');
 const insert=proposal.indexOf('insert into public.operations_agent_actions');
 for(const gate of ['inventory_item_access','walls_production_permission(v_required)','walls_production_permission(\'setup\')'])assert.ok(proposal.indexOf(gate)>0&&proposal.indexOf(gate)<insert);
});
