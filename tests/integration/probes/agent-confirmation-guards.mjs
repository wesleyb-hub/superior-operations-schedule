/** Real SQL confirmation and replay guards; synthetic records, transaction rollback. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGDATABASE,'superior_workflow_test');
const admin={sub:'00000000-0000-4000-8000-000000000001',email:'test-admin@superiorwallsnd.com',role:'authenticated'};
const reader={sub:'00000000-0000-4000-8000-000000000002',email:'test-viewer@superiorwallsnd.com',role:'authenticated'};
async function identity(c,claims){await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);}
async function rpc(c,name,args){return (await c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value;}
async function transaction(run){const c=new pg.Client();await c.connect();try{await c.query('begin');await c.query('set local role authenticated');await identity(c,admin);await run(c);}finally{await c.query('rollback');await c.end();}}
async function owner(c,sql,args=[]){await c.query('reset role');try{return await c.query(sql,args);}finally{await c.query('set local role authenticated');}}
async function inventory(c){const {rows:[row]}=await owner(c,"insert into public.inventory_items(titan_code,description,category,quantity,reorder_threshold) values($1,'TEST agent only','RM Misc. SW',20,5) returning *",['TEST-'+randomUUID()]);return row;}
async function propose(c,type,parameters){return rpc(c,'create_operations_agent_proposal',['TEST explicit requested change',type,JSON.stringify(parameters),'TEST preview',randomUUID()]);}
async function inventoryProposal(c){const item=await inventory(c),action=await propose(c,'set_inventory_count',{item_id:item.item_id,expected_version:item.version,quantity:12});return {item,action};}
async function production(c){
 const id='TEST-AGENT-'+randomUUID(),table='TEST-AGENT-'+randomUUID();await c.query('select test_workflow.patch(\'walls\',$1,$2::jsonb)',[id,JSON.stringify({job:id,lf:100,lfByHeight:{h8:100},planReview:{stages:{approvedProduction:{status:"Complete"}}}})]);await rpc(c,'upsert_walls_production_table',[table,table,100,true]);return rpc(c,'upsert_walls_production_assignment',[null,id,table,8,100,'2026-11-30 07:00','2026-11-30 15:00','2026-12-01 07:00','TEST agent']);
}
async function snapshot(c){const {rows:[{value}]}=await owner(c,"select jsonb_build_object('actions',(select jsonb_agg(to_jsonb(t) order by action_id) from public.operations_agent_actions t),'inventory',(select jsonb_agg(to_jsonb(t) order by item_id) from public.inventory_items t),'inventory_events',(select jsonb_agg(to_jsonb(t) order by event_id) from public.inventory_events t),'production',(select jsonb_agg(to_jsonb(t) order by assignment_id) from public.walls_production_assignments t),'production_events',(select jsonb_agg(to_jsonb(t) order by event_id) from public.walls_production_events t)) as value");return value;}
async function rejects(c,run,pattern){const before=await snapshot(c);await c.query('savepoint expected_failure');let error;try{await run();}catch(e){error=e;}await c.query('rollback to savepoint expected_failure');await c.query('release savepoint expected_failure');assert.ok(error,'operation unexpectedly succeeded');assert.match(error.message,pattern);assert.deepEqual(await snapshot(c),before,'rejected call leaves action, target and audit unchanged');}
async function getAction(c,id){return (await owner(c,'select to_jsonb(t) value from public.operations_agent_actions t where action_id=$1',[id])).rows[0].value;}

test('agent rejects NULL, blank and wrong confirmation before any mutation',()=>transaction(async c=>{
 const {action}=await inventoryProposal(c);
 for(const confirmation of [null,'','confirm',' CONFIRM '])await rejects(c,()=>rpc(c,'execute_operations_agent_action',[action.action_id,confirmation]),/Explicit confirmation required/);
 assert.equal((await getAction(c,action.action_id)).status,'pending');
}));
test('agent rejects missing identity before lookup and another requester before mutation',()=>transaction(async c=>{
 const {action}=await inventoryProposal(c);await identity(c,{});
 await rejects(c,()=>rpc(c,'execute_operations_agent_action',[action.action_id,'CONFIRM']),/Authentication required/);
 await rejects(c,()=>rpc(c,'execute_operations_agent_action',[randomUUID(),'CONFIRM']),/Authentication required/);
 await identity(c,reader);await rejects(c,()=>rpc(c,'execute_operations_agent_action',[action.action_id,'CONFIRM']),/Pending agent action not found/);
 await identity(c,admin);assert.equal((await getAction(c,action.action_id)).status,'pending');
}));
test('agent exact confirmation applies inventory count once and rejects replay',()=>transaction(async c=>{
 const {item,action}=await inventoryProposal(c),result=await rpc(c,'execute_operations_agent_action',[action.action_id,'CONFIRM']);assert.equal(result.status,'executed');assert.equal(result.ok,true);
 const {rows:[current]}=await c.query('select * from public.inventory_items where item_id=$1',[item.item_id]);assert.equal(current.quantity,12);assert.equal(Number(current.version),Number(item.version)+1);
 await rejects(c,()=>rpc(c,'execute_operations_agent_action',[action.action_id,'CONFIRM']),/no longer pending/);
 assert.equal((await c.query('select count(*)::int count from public.inventory_events where item_id=$1',[item.item_id])).rows[0].count,1);
}));
test('agent stale and expired previews do not overwrite current inventory',()=>transaction(async c=>{
 const {item,action}=await inventoryProposal(c);await rpc(c,'set_inventory_count',[item.item_id,item.version,18]);
 const stale=await rpc(c,'execute_operations_agent_action',[action.action_id,'CONFIRM']);assert.equal(stale.status,'failed');assert.match(stale.message,/changed after this preview/);
 assert.equal((await c.query('select quantity from public.inventory_items where item_id=$1',[item.item_id])).rows[0].quantity,18);
 const next=await inventoryProposal(c);await owner(c,"update public.operations_agent_actions set expires_at=now()-interval '1 minute' where action_id=$1",[next.action.action_id]);
 const expired=await rpc(c,'execute_operations_agent_action',[next.action.action_id,'CONFIRM']);assert.equal(expired.status,'expired');assert.equal((await c.query('select quantity from public.inventory_items where item_id=$1',[next.item.item_id])).rows[0].quantity,20);
}));
test('agent valid production stage/progress remain available with explicit confirmation',()=>transaction(async c=>{
 let row=await production(c);let action=await propose(c,'advance_production_stage',{assignment_id:row.assignment_id,expected_version:row.version,new_stage:'setup_in_progress'});
 let result=await rpc(c,'execute_operations_agent_action',[action.action_id,'CONFIRM']);assert.equal(result.status,'executed');assert.equal(result.action.result.stage,'setup_in_progress');
 row=result.action.result;action=await propose(c,'update_setup_progress',{assignment_id:row.assignment_id,expected_version:row.version,setup_progress:50});
 result=await rpc(c,'execute_operations_agent_action',[action.action_id,'CONFIRM']);assert.equal(result.status,'executed');assert.equal(result.action.result.setup_progress,50);
 await rejects(c,()=>rpc(c,'execute_operations_agent_action',[action.action_id,'CONFIRM']),/no longer pending/);
}));
for(const type of ['set_inventory_count','advance_production_stage','update_setup_progress'])test(`agent ${type} rejects a stored preview missing its version`,()=>transaction(async c=>{
 let action,item,row;
 if(type==='set_inventory_count')({action,item}=await inventoryProposal(c));
 else{row=await production(c);if(type==='update_setup_progress')row=await rpc(c,'advance_walls_production_stage',[row.assignment_id,'setup_in_progress']);action=await propose(c,type,{assignment_id:row.assignment_id,expected_version:row.version,new_stage:'setup_in_progress',setup_progress:50});}
 // Fixture-only corruption simulates a legacy/incomplete pending preview. Never live data.
 await owner(c,"update public.operations_agent_actions set parameters=parameters-'expected_version' where action_id=$1",[action.action_id]);
 const before=await snapshot(c),result=await rpc(c,'execute_operations_agent_action',[action.action_id,'CONFIRM']);assert.equal(result.status,'failed');assert.match(result.message,/changed after this preview/);
 const after=await snapshot(c);delete before.actions;delete after.actions;assert.deepEqual(after,before,'missing version does not change target or its audit trail');
}));
