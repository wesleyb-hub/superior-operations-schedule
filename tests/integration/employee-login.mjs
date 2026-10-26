// SYNTHETIC, LOOPBACK-ONLY PostgreSQL tests. Native GoTrue is intentionally not mocked here.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function runEmployeeLoginTests({ Client, connection = {} }) {
  const config = {
    host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'superior_workflow_test', user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD, ...connection,
  };
  assert.ok(['127.0.0.1', 'localhost'].includes(config.host), 'Loopback database only');
  assert.equal(config.database, 'superior_workflow_test', 'Disposable database only');
  const c = new Client(config); await c.connect();
  const ids = Object.fromEntries(['owner','writer','employee','other','disabled','role_target'].map((name,i)=>[name,`00000000-0000-4000-8000-00000000070${i+1}`]));
  const insertedIds=[];
  const hash = 'a'.repeat(64), otherHash = 'b'.repeat(64);
  const evidence = [];
  function pass(label) { evidence.push(label); console.log(`PASS: ${label}`); }
  async function role(roleName,uid,sql,params=[],client=c) {
    assert.ok(['authenticated','anon','service_role'].includes(roleName));
    await client.query('begin');
    try {
      await client.query(`set local role ${roleName}`);
      await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:roleName,sub:uid,email:`${Object.entries(ids).find(([,v])=>v===uid)?.[0]||'service'}@example.invalid`})]);
      const result=await client.query(sql,params); await client.query('commit'); return result;
    } catch(error) {await client.query('rollback');throw error;}
  }
  const service=(sql,params=[],client=c)=>role('service_role',null,sql,params,client);
  const rpc=async(name,args=[],client=c)=>(await service(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as value`,args,client)).rows[0].value;
  const asEmployee=async(sql,params=[],uid=ids.employee)=>(await role('authenticated',uid,sql,params)).rows;
  async function reject(fn,label){await assert.rejects(fn);pass(label);}
  async function issue(name='jade-test',codeHash=hash,confirm=false){return rpc('employee_login_issue',[ids.owner,name,codeHash,randomUUID(),confirm]);}
  async function restoreAlias(name='jade-test') {await c.query("update employee_login.aliases set state='active',enabled=true,code_hash=null,code_id=null,expires_at=null,claim_id=null,confirm_email=false where username=$1",[name]);}
  try {
    assert.equal((await c.query('select current_database() as db')).rows[0].db,'superior_workflow_test');
    assert.ok((await c.query("select to_regprocedure('public.employee_login_claim(text,text,uuid)') as p")).rows[0].p);
    assert.equal((await c.query('select count(*)::int as n from auth.users where id=any($1::uuid[])',[Object.values(ids)])).rows[0].n,0,'Synthetic UID namespace must be unused; existing records are never replaced');
    const allUsers=Object.entries(ids);
    for(const [name,uid] of allUsers) {await c.query('insert into auth.users(id,email) values($1,$2)',[uid,`${name}@example.invalid`]);insertedIds.push(uid);}
    await c.query("insert into public.app_user_roles(user_id,role,can_write) values($1,'management',true),($2,'management',true),($3,'viewer',false)",[ids.owner,ids.writer,ids.role_target]);
    await c.query("insert into public.app_employee_access(user_id,profile_key,allowed_views,allowed_wall_subviews,enabled,inventory_can_view,inventory_can_adjust,inventory_can_manage) select u,'walls_inventory_counter',array['overview','walls','inventory','weekly-planner'],array['production'],u<>$2,true,true,false from unnest($1::uuid[]) u",[[ids.employee,ids.other,ids.disabled,ids.role_target],ids.disabled]);
    await c.query('insert into employee_login.owners(user_id,enabled) values($1,true)',[ids.owner]);
    await c.query("insert into employee_login.aliases(username,user_id,enabled,state) values('jade-test',$1,true,'active'),('other-test',$2,true,'active'),('disabled-test',$3,true,'active'),('role-target',$4,true,'active')",[ids.employee,ids.other,ids.disabled,ids.role_target]);
    const snapshot=async()=>({
      auth:(await c.query('select to_jsonb(u) as row from auth.users u where id=any($1::uuid[]) order by id',[Object.values(ids)])).rows,
      grants:(await c.query('select to_jsonb(a) as row from public.app_employee_access a where user_id=any($1::uuid[]) order by user_id',[Object.values(ids)])).rows,
      roles:(await c.query('select to_jsonb(a) as row from public.app_user_roles a where user_id=any($1::uuid[]) order by user_id',[Object.values(ids)])).rows,
    });
    const before=await snapshot();

    const signatures=(await c.query("select p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'employee_login_%' order by p.proname")).rows.map(r=>r.signature);
    assert.equal(signatures.length,10);
    for(const signature of signatures){
      const r=(await c.query("select has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('authenticated',$1,'execute') as authenticated,has_function_privilege('service_role',$1,'execute') as service",[signature])).rows[0];
      assert.deepEqual(r,{anon:false,authenticated:false,service:true});
    }
    const selfAcl=(await c.query("select has_function_privilege('anon','public.get_employee_login_access()','execute') as anon,has_function_privilege('authenticated','public.get_employee_login_access()','execute') as authenticated,has_function_privilege('service_role','public.get_employee_login_access()','execute') as service")).rows[0];
    assert.deepEqual(selfAcl,{anon:false,authenticated:true,service:false});
    pass('Every credential-admin RPC is service-only; self-status is authenticated-only');
    for(const table of ['owners','aliases','throttles','audit'])for(const r of ['anon','authenticated','service_role']) await assert.rejects(()=>role(r,ids.employee,`select * from employee_login.${table}`));
    pass('Private owner/alias/code/throttle/audit tables reject every API role, including direct service reads');
    await reject(()=>role('authenticated',ids.owner,'select public.employee_login_issue($1,$2,$3,$4,false)',[ids.owner,'jade-test',hash,randomUUID()]),'Even an owner JWT cannot call a credential-admin RPC directly');
    await reject(()=>c.query('select public.employee_login_resolve($1)',['jade-test']),'Actual service SQL-role guard rejects accidental non-service invocation');
    assert.equal(await rpc('employee_login_check_owner',[ids.owner]),true);
    assert.equal(await rpc('employee_login_check_owner',[ids.writer]),false);
    assert.equal(await rpc('employee_login_check_owner',[ids.employee]),false);
    await reject(()=>rpc('employee_login_list',[ids.writer]),'can_write alone never confers owner credential administration');
    await c.query('update employee_login.owners set enabled=false where user_id=$1',[ids.owner]);assert.equal(await rpc('employee_login_check_owner',[ids.owner]),false);
    await c.query('update employee_login.owners set enabled=true where user_id=$1',[ids.owner]);
    await c.query('update public.app_user_roles set can_write=false where user_id=$1',[ids.owner]);assert.equal(await rpc('employee_login_check_owner',[ids.owner]),false);
    await c.query('update public.app_user_roles set can_write=true where user_id=$1',[ids.owner]);
    await c.query('update auth.users set is_anonymous=true where id=$1',[ids.owner]);assert.equal(await rpc('employee_login_check_owner',[ids.owner]),false);
    await c.query('update auth.users set is_anonymous=false where id=$1',[ids.owner]);
    pass('Owner disable and management demotion both remove credential-admin capability');

    assert.deepEqual(await rpc('employee_login_resolve',['  JADE-TEST  ']),{username:'jade-test',user_id:ids.employee});
    for(const username of ['missing','ja','jade test','jádé','admin','owner','root','x'.repeat(33),'disabled-test','role-target'])assert.equal(await rpc('employee_login_resolve',[username]),null);
    await reject(()=>c.query("insert into employee_login.aliases(username,user_id) values('JADE-TEST',$1)",[randomUUID()]),'Noncanonical username rejected by table invariant');
    await reject(()=>c.query("insert into employee_login.aliases(username,user_id) values('second-alias',$1)",[ids.employee]),'One existing Auth UID cannot receive duplicate aliases');
    await reject(()=>c.query("insert into employee_login.aliases(username,user_id) values('jade-test',$1)",[ids.other]),'Username uniqueness enforced in the database');
    pass('Username normalization, eligibility, reserved names and identity uniqueness fail closed');
    const list=await rpc('employee_login_list',[ids.owner]);
    assert.ok(list.every(row=>Object.keys(row).sort().join(',')==='enabled,status,user_id,username'));
    assert.equal(list.find(x=>x.username==='role-target').enabled,false);
    const self=(await asEmployee('select public.get_employee_login_access() as value'))[0].value;
    assert.deepEqual(self,{managed:true,enabled:true,status:'active',username:'jade-test'});
    const otherSelf=(await asEmployee('select public.get_employee_login_access() as value',[],ids.other))[0].value;assert.equal(otherSelf.username,'other-test');
    await c.query('update auth.users set is_anonymous=true where id=$1',[ids.other]);
    assert.equal(await rpc('employee_login_resolve',['other-test']),null);
    assert.equal((await asEmployee('select public.get_employee_login_access() as value',[],ids.other))[0].value.enabled,false);
    assert.equal(await issue('other-test'),null);
    await c.query('update auth.users set is_anonymous=false where id=$1',[ids.other]);
    pass('Anonymous Auth identities cannot be credential operators, reset targets or managed sessions');
    const unmanaged=(await asEmployee('select public.get_employee_login_access() as value',[],ids.owner))[0].value;assert.equal(unmanaged.managed,false);
    await reject(()=>role('authenticated',null,'select public.get_employee_login_access()'),'Self-status requires an authenticated Auth UID');
    pass('List is owner-only and secret-free; self-status can expose only the caller alias');

    const started=Date.now(),issued=await issue();assert.equal(issued.username,'jade-test');assert.ok(Date.parse(issued.expires_at)-started>=590000&&Date.parse(issued.expires_at)-started<=610000);
    assert.equal(await rpc('employee_login_resolve',['jade-test']),null);
    assert.equal((await asEmployee('select public.get_employee_login_access() as value'))[0].value.enabled,false);
    assert.equal(await rpc('employee_login_claim',['jade-test',otherHash,randomUUID()]),null);
    assert.equal((await c.query("select state from employee_login.aliases where username='jade-test'")).rows[0].state,'pending');
    pass('Issuance blocks alias sign-in, fixes ten-minute TTL, and wrong code does not consume a valid code');
    await issue('jade-test',otherHash,true);
    assert.equal(await rpc('employee_login_claim',['jade-test',hash,randomUUID()]),null);
    const claimId=randomUUID(),claimed=await rpc('employee_login_claim',['jade-test',otherHash,claimId]);
    assert.deepEqual(claimed,{user_id:ids.employee,confirm_email:true});
    const claimState=(await c.query("select state,code_hash,code_id,expires_at from employee_login.aliases where username='jade-test'")).rows[0];
    assert.deepEqual(claimState,{state:'processing',code_hash:null,code_id:null,expires_at:null});
    assert.equal(await rpc('employee_login_claim',['jade-test',otherHash,randomUUID()]),null);
    assert.equal(await issue(),null);assert.equal(await rpc('employee_login_disable',[ids.owner,'jade-test']),false);
    assert.equal(await rpc('employee_login_finish',[ids.employee,randomUUID(),true]),false);
    assert.equal(await rpc('employee_login_finish',[ids.other,claimId,true]),false);
    assert.equal(await rpc('employee_login_finish',[ids.employee,claimId,true]),true);
    assert.equal(await rpc('employee_login_finish',[ids.employee,claimId,true]),false);
    assert.ok(await rpc('employee_login_resolve',['jade-test']));
    pass('Replacement invalidates previous code; one-use claim locks issuance/disable and completion is UID+claim-bound');
    await issue();await c.query("update employee_login.aliases set expires_at=clock_timestamp()-interval '1 second' where username='jade-test'");
    assert.equal(await rpc('employee_login_claim',['jade-test',hash,randomUUID()]),null);
    pass('Expired codes cannot be claimed');
    await issue();const failureClaim=randomUUID();await rpc('employee_login_claim',['jade-test',hash,failureClaim]);
    assert.equal(await rpc('employee_login_finish',[ids.employee,failureClaim,false]),false);
    assert.equal((await c.query("select state from employee_login.aliases where username='jade-test'")).rows[0].state,'failed');
    assert.equal(await issue(),null);assert.equal(await rpc('employee_login_resolve',['jade-test']),null);
    pass('Failed or uncertain external Auth completion remains blocked and cannot be automatically reissued');
    assert.equal(await rpc('employee_login_disable',[ids.owner,'jade-test']),true);
    assert.equal((await c.query("select state from employee_login.aliases where username='jade-test'")).rows[0].state,'failed');
    await c.query("update employee_login.aliases set enabled=true where username='jade-test'");
    assert.equal(await issue(),null);
    pass('Disabling then reenabling an uncertain operation does not clear its reconciliation block');
    await restoreAlias();await issue();const weakClaim=randomUUID();await rpc('employee_login_claim',['jade-test',hash,weakClaim]);
    assert.equal(await rpc('employee_login_password_rejected',[ids.employee,randomUUID()]),false);
    assert.equal(await rpc('employee_login_password_rejected',[ids.other,weakClaim]),false);
    assert.equal(await rpc('employee_login_password_rejected',[ids.employee,weakClaim]),true);
    assert.equal(await rpc('employee_login_password_rejected',[ids.employee,weakClaim]),false);
    assert.equal((await c.query("select state from employee_login.aliases where username='jade-test'")).rows[0].state,'setup_required');
    assert.equal(await rpc('employee_login_claim',['jade-test',hash,randomUUID()]),null);
    assert.equal(await rpc('employee_login_resolve',['jade-test']),null);
    assert.ok(await issue());
    pass('Definitive weak-password rejection permits only fresh owner issuance, never code replay or direct sign-in');
    await restoreAlias();await issue();const removedClaim=randomUUID();await rpc('employee_login_claim',['jade-test',hash,removedClaim]);
    await c.query('update public.app_employee_access set enabled=false where user_id=$1',[ids.employee]);
    assert.equal(await rpc('employee_login_finish',[ids.employee,removedClaim,true]),false);
    await c.query('update public.app_employee_access set enabled=true where user_id=$1',[ids.employee]);await restoreAlias();
    pass('Concurrent removal of employee eligibility prevents finishing a password operation as active');

    const c1=new Client(config),c2=new Client(config);await Promise.all([c1.connect(),c2.connect()]);
    try{
      await issue();const results=await Promise.all([rpc('employee_login_claim',['jade-test',hash,randomUUID()],c1),rpc('employee_login_claim',['jade-test',hash,randomUUID()],c2)]);
      assert.equal(results.filter(Boolean).length,1);assert.equal(results.filter(x=>x===null).length,1);
      pass('Real concurrent PostgreSQL redemption allows exactly one password-update claimant');
      const bucket='c'.repeat(64);
      const results2=[];
      for(let i=0;i<4;i++)results2.push(...await Promise.all([rpc('employee_login_throttle',[[bucket],5,300],c1),rpc('employee_login_throttle',[[bucket],5,300],c2)]));
      assert.equal(results2.filter(Boolean).length,5);assert.equal(results2.filter(x=>!x).length,3);
      pass('Concurrent durable throttling permits exactly the configured limit across workers');
    }finally{await Promise.all([c1.end(),c2.end()]);}
    await restoreAlias();
    assert.equal(await rpc('employee_login_throttle',[['d'.repeat(64),'e'.repeat(64)],1,300]),true);
    assert.equal(await rpc('employee_login_throttle',[['e'.repeat(64),'d'.repeat(64)],1,300]),false);
    assert.equal((await c.query("select min(attempts) as n from employee_login.throttles where bucket_key in ($1,$2)",['d'.repeat(64),'e'.repeat(64)])).rows[0].n,2);
    await c.query("update employee_login.throttles set expires_at=clock_timestamp()-interval '1 second' where bucket_key=$1",['d'.repeat(64)]);
    assert.equal(await rpc('employee_login_throttle',[['d'.repeat(64)],1,300]),true);
    for(const args of [[[],1,300],[['x'],1,300],[['a'.repeat(64)],0,300],[['a'.repeat(64)],1001,300],[['a'.repeat(64)],5,59]])await assert.rejects(()=>rpc('employee_login_throttle',args));
    pass('Throttles count denied attempts, expire safely, validate bounds and accept no raw IP/username keys');
    const lockClient=new Client(config);await lockClient.connect();
    try{
      const oldBucket='f'.repeat(64);
      await c.query("insert into employee_login.throttles(bucket_key,attempts,expires_at) values($1,1,clock_timestamp()-interval '2 days')",[oldBucket]);
      await lockClient.query('begin');
      await lockClient.query("update employee_login.throttles set attempts=7,expires_at=clock_timestamp()+interval '5 minutes' where bucket_key=$1",[oldBucket]);
      assert.equal(await rpc('employee_login_throttle',[['9'.repeat(64)],1,300]),true);
      await lockClient.query('commit');
      assert.equal((await c.query('select attempts from employee_login.throttles where bucket_key=$1',[oldBucket])).rows[0].attempts,7);
      pass('Retention cleanup skips concurrently refreshed buckets rather than deleting live rate limits');
    }finally{await lockClient.query('rollback').catch(()=>{});await lockClient.end();}

    const accessBefore=(await asEmployee('select public.get_app_access() as value'))[0].value;
    assert.equal(accessBefore.is_admin,false);assert.equal(accessBefore.can_write,false);
    assert.deepEqual(accessBefore.allowed_wall_subviews,['production']);
    assert.ok(accessBefore.allowed_views.includes('weekly-planner'));assert.ok(!accessBefore.allowed_views.includes('billing'));
    await issue();assert.equal(await rpc('employee_login_disable',[ids.owner,'jade-test']),true);
    assert.equal(await rpc('employee_login_claim',['jade-test',hash,randomUUID()]),null);
    assert.equal(await rpc('employee_login_resolve',['jade-test']),null);
    assert.equal((await asEmployee('select public.get_employee_login_access() as value'))[0].value.status,'disabled');
    assert.deepEqual((await asEmployee('select public.get_app_access() as value'))[0].value,accessBefore);
    assert.deepEqual(await snapshot(),before);
    pass('Alias reset/disable never changes Auth UID/email, employee grants, administrator roles or existing JWT business scope');
    await c.query('update public.app_employee_access set enabled=false where user_id=$1',[ids.employee]);
    const offboarded=(await asEmployee('select public.get_app_access() as value'))[0].value;
    assert.equal(offboarded.authorized,false);
    await reject(()=>asEmployee('select public.get_schedule_snapshot()'),'A separately revoked employee grant removes this fixture’s old-JWT schedule access');
    const permission=(await asEmployee("select public.walls_production_permission('view') as production,public.inventory_scope_access('walls','production','adjust') as inventory"))[0];
    assert.deepEqual(permission,{production:false,inventory:false});
    await c.query('update public.app_employee_access set enabled=true where user_id=$1',[ids.employee]);
    pass('Offboarding requires business-grant revocation, not alias disable; Auth JWT expiry/revocation is separate');
    const auditColumns=(await c.query("select column_name from information_schema.columns where table_schema='employee_login' and table_name='audit' order by ordinal_position")).rows.map(r=>r.column_name);
    assert.deepEqual(auditColumns,['event_id','occurred_at','event','outcome','confirm_email','actor','target']);
    assert.ok((await c.query("select count(*)::int as n from employee_login.audit where event='issue' and outcome='succeeded' and confirm_email")).rows[0].n>=1);
    await rpc('employee_login_audit',['sign_in','succeeded',null,ids.employee]);
    await assert.rejects(()=>rpc('employee_login_audit',['password='+hash,'succeeded',null,ids.employee]));
    await assert.rejects(()=>rpc('employee_login_audit',['sign_in',hash,null,ids.employee]));
    assert.equal((await c.query('select count(*)::int as n from employee_login.audit')).rows[0].n>0,true);
    assert.equal(JSON.stringify((await c.query('select * from employee_login.audit')).rows).includes(hash),false);
    pass('Audit records confirmation intent but no email address, username, IP, password, code, token or hash');
    return { passed:evidence.length, cases:evidence, nativeAuthVerified:false, hostedVerified:false };
  } finally {
    if(insertedIds.length)await c.query('delete from auth.users where id=any($1::uuid[])',[insertedIds]).catch(()=>{});
    await c.end();
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {Client}=await import('pg');
  console.log(JSON.stringify(await runEmployeeLoginTests({Client}),null,2));
}
