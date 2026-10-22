/** Real PostgreSQL, synthetic fixtures only. All records are rolled back per case. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'superior_workflow_test');
const admin={sub:'00000000-0000-4000-8000-000000000001',email:'test-admin@superiorwallsnd.com',role:'authenticated'};
const reader={sub:'00000000-0000-4000-8000-000000000002',email:'test-viewer@superiorwallsnd.com',role:'authenticated'};
const tables=['walls_production_assignments','walls_production_events','inventory_items','inventory_events','inventory_alert_outbox','walls_installation_jobs','walls_installation_activities','walls_installation_resources','walls_installation_activity_assignments','walls_installation_events','weekly_planner_sections','weekly_planner_section_people','weekly_planner_assignments','weekly_planner_section_revisions','weekly_planner_audit','weekly_planner_packs'];
async function transaction(run){
 const c=new pg.Client();await c.connect();
 try{await c.query('begin');await c.query('set local role authenticated');await identity(c,admin);await run(c);}
 finally{await c.query('rollback');await c.end();}
}
async function identity(c,claims){await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);}
async function rpc(c,name,args){return (await c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value;}
async function state(c){
 // Read as the fixture owner solely for an exhaustive before/after assertion.
 await c.query('reset role');
 try{return (await c.query('select jsonb_build_object('+tables.map(t=>`'${t}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${t} t)`).join(',')+') as value')).rows[0].value;}
 finally{await c.query('set local role authenticated');}
}
async function rejects(c,action,pattern,label){
 const before=await state(c);await c.query('savepoint expected_failure');let error;
 try{await action();}catch(e){error=e;}
 await c.query('rollback to savepoint expected_failure');await c.query('release savepoint expected_failure');
 assert.ok(error,`${label}: operation unexpectedly succeeded`);assert.match(error.message,pattern,label);
 assert.deepEqual(await state(c),before,`${label}: records, children and audit events unchanged`);
}
async function guards(c,name,args,versionIndex,pattern,{omit=false,approval=false}={}){
 const version=Number(args[versionIndex]);
 for(const token of [null,version-1]){const bad=[...args];bad[versionIndex]=token;await rejects(c,()=>rpc(c,name,bad),pattern,`${name} rejects ${token===null?'NULL':'stale'} version`);}
 if(omit)await rejects(c,()=>rpc(c,name,args.slice(0,-1)),pattern,`${name} rejects omitted version`);
 await identity(c,reader);await rejects(c,()=>rpc(c,name,args),/access required|permission required/i,`${name} keeps reader authorization`);await identity(c,admin);
 const result=await rpc(c,name,args);
 if(approval)assert.equal(result.status,'approved');else assert.equal(Number(result.version??result.schedule_version??result.activity?.version),version+1,`${name} accepts exact version once`);
 if(!approval)await rejects(c,()=>rpc(c,name,args),pattern,`${name} rejects previous token after save`);
}
async function job(c){const id='TEST-VERSION-'+randomUUID();await c.query('select test_workflow.patch(\'walls\',$1,$2::jsonb)',[id,JSON.stringify({job:id,lf:100,lfByHeight:{h8:100}})]);return id;}
async function activity(c,type='site_preparation',resources=null){const id=await job(c);const args=[null,id,type,'2026-11-23','07:00','09:00','planned',resources===null?null:JSON.stringify(resources),'TEST original'];return {row:await rpc(c,'save_walls_installation_activity',args),args};}

test('production reschedule requires token; new assignment still permits omission',()=>transaction(async c=>{
 const id=await job(c),table='TEST-VERSION-'+randomUUID();await rpc(c,'upsert_walls_production_table',[table,table,100,true]);
 const args=[null,id,table,8,60,'2026-11-23 07:00','2026-11-23 15:00','2026-11-24 07:00','TEST original'];
 const row=await rpc(c,'upsert_walls_production_assignment',args);args[0]=row.assignment_id;args[8]='TEST rescheduled';args.push(row.version);
 await guards(c,'upsert_walls_production_assignment',args,9,/version conflict/i,{omit:true});
}));
test('inventory correction rejects null and stale tokens without count/audit effects',()=>transaction(async c=>{
 await c.query('reset role');const row=(await c.query("insert into public.inventory_items(titan_code,description,category,quantity,reorder_threshold) values($1,'TEST only inventory','RM Misc. SW',20,5) returning *",['TEST-'+randomUUID()])).rows[0];await c.query('set local role authenticated');
 await guards(c,'set_inventory_item',[row.item_id,row.version,10,5,'units'],1,/version conflict/i);
}));
test('inventory count-only correction also requires its mandatory version',()=>transaction(async c=>{
 await c.query('reset role');const row=(await c.query("insert into public.inventory_items(titan_code,description,category,quantity,reorder_threshold) values($1,'TEST only inventory','RM Misc. SW',20,5) returning *",['TEST-'+randomUUID()])).rows[0];await c.query('set local role authenticated');
 await guards(c,'set_inventory_count',[row.item_id,row.version,10],1,/version conflict/i);
}));
test('installation save protects existing activities and resource assignments',()=>transaction(async c=>{
 const {row,args}=await activity(c,'site_preparation',[{resource_type:'crew',resource_name:'TEST original crew'}]);args[0]=row.activity_id;args[7]=JSON.stringify([{resource_type:'crew',resource_name:'TEST replacement crew'}]);args.push(row.version);
 await guards(c,'save_walls_installation_activity',args,9,/activity changed/i,{omit:true});
}));
test('installation resource readiness requires exact version',()=>transaction(async c=>{
 const {row}=await activity(c,'site_preparation',[{resource_type:'crew',resource_name:'TEST original crew'}]);
 const resource=(await c.query('select * from public.walls_installation_resources where activity_id=$1',[row.activity_id])).rows[0];
 await guards(c,'update_walls_installation_resource',[resource.resource_assignment_id,resource.version,'confirmed','ready','TEST leader',''],1,/assignment changed/i);
}));
test('installation scope replacement requires exact version',()=>transaction(async c=>{
 const row=await rpc(c,'save_walls_installation_activity',[null,'TEST-E2E-WALL-001','loading_hauling','2026-11-23','07:00','09:00','planned']);
 const scopes=(await c.query("select assignment_id,load_record_id from public.walls_installation_load_assignments where load_record_id='TEST-E2E-LOAD-001'")).rows;
 assert.equal(scopes.length,1,'full lifecycle synthetic delivered scope fixture exists');
 await guards(c,'set_walls_installation_activity_assignments',[row.activity_id,row.version,JSON.stringify(scopes)],1,/activity changed/i);
}));
async function planner(c){
 await rpc(c,'generate_weekly_planner',['2026-12-07']);
 return (await c.query("select * from public.weekly_planner_sections where week_start='2026-12-07' order by section_key limit 1")).rows[0];
}
test('planner save protects section, staff and assignment draft from null/stale versions',()=>transaction(async c=>{
 const row=await planner(c);await guards(c,'save_weekly_planner_section',[row.section_id,row.schedule_version,'TEST leader','[{"name":"TEST leader","is_leader":true}]','[]'],1,/version conflict/i);
}));
test('planner approval requires exact reviewed version',()=>transaction(async c=>{
 let row=await planner(c);row=await rpc(c,'save_weekly_planner_section',[row.section_id,row.schedule_version,'TEST leader','[{"name":"TEST leader","is_leader":true}]','[]']);
 await guards(c,'approve_weekly_planner_section',[row.section_id,row.schedule_version],1,/version conflict/i,{approval:true});
}));
