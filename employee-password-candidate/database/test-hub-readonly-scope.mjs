import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {HUB_READONLY_SCOPE} from '../identity.mjs';
export async function runHubReadonlyPasswordScopeTests({client,report=console.log}){
 const uid='60000000-0000-4000-8000-000000000091';
 const fixture={authority_fingerprint:'synthetic',roles:[],inventory:[],planner:[],production:[],installation:[],employee:[{
 user_id:uid,created_at:'2026-10-27T00:00:00Z',updated_at:'2026-10-27T00:00:00Z',updated_by:'synthetic',
 profile_key:'hub_readonly_v1',legal_entity:'Superior Walls of North Dakota, LLC',division_key:'walls',inventory_area:'production',
 enabled:true,inventory_can_view:true,inventory_can_adjust:false,inventory_can_manage:false,
 allowed_views:[...HUB_READONLY_SCOPE.business_views],allowed_wall_subviews:[...HUB_READONLY_SCOPE.wall_subviews]}]};
 const allowed=async g=>(await client.query('select employee_password.scope_allowed($1::jsonb) as allowed',[JSON.stringify(g)])).rows[0].allowed;
 assert.equal(await allowed(fixture),true);
 assert.deepEqual((await client.query('select employee_password.effective_scope($1::jsonb) as scope',[JSON.stringify(fixture)])).rows[0].scope,HUB_READONLY_SCOPE);
 let count=2;
 const rejects=async mutate=>{const f=structuredClone(fixture);mutate(f);assert.equal(await allowed(f),false);count++;};
 for(const group of ['roles','inventory','planner','production','installation'])await rejects(f=>f[group].push({user_id:uid,can_write:true}));
 for(const [key,value] of Object.entries(fixture.employee[0])){
  await rejects(f=>delete f.employee[0][key]);
  if(['created_at','updated_at','updated_by'].includes(key))continue;
  await rejects(f=>{f.employee[0][key]=typeof value==='boolean'?!value:Array.isArray(value)?[...value,'unexpected']:value+'-bad';});
 }
 for(const group of ['allowed_views','allowed_wall_subviews']){
  await rejects(f=>f.employee[0][group].pop());
  await rejects(f=>f.employee[0][group].push(f.employee[0][group][0]));
  const f=structuredClone(fixture);f.employee[0][group].reverse();assert.equal(await allowed(f),true);count++;
 }
 await rejects(f=>f.employee.push(structuredClone(f.employee[0])));
 await rejects(f=>f.employee=[]);await rejects(f=>f.employee=null);
 await rejects(f=>f.employee[0].unexpected_capability=true);
 await rejects(f=>f.extra=[]);await rejects(f=>delete f.installation);
 assert.equal((await client.query("select employee_password.effective_scope('{}'::jsonb) as scope")).rows[0].scope,null);count++;
 // Actual admission/owner list/challenge lifecycle on a fresh disposable native-state fixture.
 await client.query('begin');
 try{
  const owner='60000000-0000-4000-8000-000000000092',email='readerfixture@company.example.invalid';
  await client.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[uid,email,owner,'reader-owner@company.example.invalid']);
  await client.query("insert into auth.identities(user_id,provider,identity_data) values($1,'email',jsonb_build_object('email',$2::text))",[uid,email]);
  await client.query('insert into employee_password.owners(user_id,enabled) values($1,true)',[owner]);
  await client.query("update employee_password.settings set enabled=true,version=version+1,current_key_id='synthetic-reader-key',audience='https://local.example.invalid/employee-password',identifier_domain='company.example.invalid'");
  await client.query(`insert into public.app_employee_access(user_id,profile_key,legal_entity,division_key,inventory_area,allowed_views,allowed_wall_subviews,enabled,inventory_can_view,inventory_can_adjust,inventory_can_manage)
   values($1,'hub_readonly_v1','Superior Walls of North Dakota, LLC','walls','production',$2,$3,true,true,false,false)`,[uid,HUB_READONLY_SCOPE.business_views,HUB_READONLY_SCOPE.wall_subviews]);
  const before=(await client.query('select to_jsonb(a) as row from public.app_employee_access a where user_id=$1',[uid])).rows;
  await client.query(`insert into employee_password.approved_records(record_id,auth_uid,username,auth_email,display_name,enabled,reviewed_by,reviewed_at,reviewed_grants)
   values('synthetic-reader',$1,'readerfixture',$2,'Synthetic reader',true,$3,now(),employee_password.current_grants($1,$2))`,[uid,email,owner]);
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'authenticated',sub:owner})]);
  const rows=(await client.query('select public.employee_password_owner_targets() as targets')).rows[0].targets;
  assert.equal(rows.length,1);assert.equal(rows[0].status,'ready');assert.match(rows[0].scope_label,/All Hub business screens read-only/);assert.equal(rows[0].username,'readerfixture');
  await client.query('reset role');
  const service=async(sql,args)=>{await client.query('set local role service_role');try{return await client.query(sql,args);}finally{await client.query('reset role');}};
  const prepared=(await service("select public.employee_password_prepare($1,'synthetic-reader',1,$2,'initialize') as result",[owner,randomUUID()])).rows[0].result;
  assert.equal(prepared.kind,'prepared');assert.deepEqual(prepared.record.effective_scope,HUB_READONLY_SCOPE);
  const consumed=(await service("select public.employee_password_consume($1,$2,'synthetic-reader',1,'initialize',$3,$4) as result",[owner,prepared.challenge_id,prepared.audience,prepared.key_id])).rows[0].result;
  assert.equal(consumed.kind,'applying');
  // Simulates only native confirmation; GoTrue is explicitly outside this SQL fixture.
  await client.query('update auth.users set email_confirmed_at=now() where id=$1',[uid]);
  await service("select public.employee_password_finish($1,$2,'applied')",[owner,prepared.challenge_id]);
  assert.deepEqual((await client.query("select version,setup_completed from employee_password.approved_records where record_id='synthetic-reader'")).rows[0],{version:'2',setup_completed:true});
  assert.deepEqual((await client.query('select to_jsonb(a) as row from public.app_employee_access a where user_id=$1',[uid])).rows,before);
  // Any owner record is incompatible, even disabled, and marker never acquires owner authority.
  await client.query('insert into employee_password.owners(user_id,enabled) values($1,true)',[uid]);
  assert.equal((await client.query('select employee_password.owner_allowed($1) as allowed',[uid])).rows[0].allowed,false);
  assert.equal((await client.query("select employee_password.record_allowed(r,s) as allowed from employee_password.approved_records r cross join employee_password.settings s where r.record_id='synthetic-reader'")).rows[0].allowed,false);
  await client.query('update employee_password.owners set enabled=false where user_id=$1',[uid]);
  assert.equal((await client.query("select employee_password.record_allowed(r,s) as allowed from employee_password.approved_records r cross join employee_password.settings s where r.record_id='synthetic-reader'")).rows[0].allowed,false);
  count+=10;
 }finally{await client.query('rollback');}
 report(`PASS: ${count} hub readonly password SQL exact-scope/negative cases; canonical scope equals runtime profile`);
 return count;
}
