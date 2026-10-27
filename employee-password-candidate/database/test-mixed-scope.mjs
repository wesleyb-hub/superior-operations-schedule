import assert from 'node:assert/strict';
import {MIXED_EMPLOYEE_SCOPE} from '../identity.mjs';
export async function runMixedPasswordScopeTests({client,report=console.log}){
 const uid='60000000-0000-4000-8000-000000000001',metadata={updated_at:'2026-10-27T00:00:00Z',updated_by:'synthetic'};
 const fixture={authority_fingerprint:'synthetic',roles:[],inventory:[],planner:[],employee:[],
 production:[{user_id:uid,...metadata,created_at:'2026-10-27T00:00:00Z',enabled:true,can_view:true,can_update_setup:true,can_record_pour:true,can_record_strip:true,can_report_issue:true,can_manage_assignments:true,can_manage_plan:true}],
 installation:[{user_id:uid,...metadata,enabled:true,can_view:true,can_qc:true,can_manage:false,can_assign_resources:false,can_record_field_progress:false}]};
 for(const [division_key,inventory_area] of [['walls','production'],['walls','install'],['boxes','production']])fixture.employee.push({user_id:uid,...metadata,created_at:'2026-10-27T00:00:00Z',profile_key:'walls_production_inventory_qc_v1',legal_entity:division_key==='walls'?'Superior Walls of North Dakota, LLC':'Superior Precast Structures, LLC',division_key,inventory_area,enabled:true,inventory_can_view:true,inventory_can_adjust:true,inventory_can_manage:true,allowed_views:['overview','walls','inventory','boxes','manholes','fence','block','qc','weekly-planner'],allowed_wall_subviews:['production','installation']});
 const allowed=async g=>(await client.query('select employee_password.scope_allowed($1::jsonb) as allowed',[JSON.stringify(g)])).rows[0].allowed;
 assert.equal(await allowed(fixture),true);
 const effective=(await client.query('select employee_password.effective_scope($1::jsonb) as scope',[JSON.stringify(fixture)])).rows[0].scope;
 assert.deepEqual(effective,MIXED_EMPLOYEE_SCOPE);
 let count=2;
 const rejects=async mutate=>{const f=structuredClone(fixture);mutate(f);assert.equal(await allowed(f),false);count++;};
 for(const area of ['roles','inventory','planner'])await rejects(f=>f[area].push({user_id:uid,can_write:true}));
 for(const group of ['production','installation','employee']){
  await rejects(f=>f[group].push(structuredClone(f[group][0])));
  await rejects(f=>f[group].pop());
  for(let index=0;index<fixture[group].length;index++)for(const [key,value] of Object.entries(fixture[group][index])){
   if(['created_at','updated_at','updated_by'].includes(key))continue;
   await rejects(f=>delete f[group][index][key]);
   await rejects(f=>{f[group][index][key]=typeof value==='boolean'?!value:Array.isArray(value)?[...value,'billing']:value+'-bad';});
  }
  await rejects(f=>f[group][0].unexpected_capability=true);
 }
 await rejects(f=>f.extra=[]);await rejects(f=>delete f.installation);await rejects(f=>f.employee=null);
 await rejects(f=>f.employee[1]=structuredClone(f.employee[0]));
 for(const group of ['production','installation','employee'])await rejects(f=>f[group][0].user_id='60000000-0000-4000-8000-000000000002');
 assert.equal((await client.query("select employee_password.effective_scope('{}'::jsonb) as scope")).rows[0].scope,null);count++;
 report(`PASS: ${count} mixed password SQL exact-scope/negative cases; canonical scope equals runtime profile`);
 return count;
}
