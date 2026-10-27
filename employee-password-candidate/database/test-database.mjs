import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function runPasswordDatabaseTests({Client,config,report=console.log}){
  assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'superior_workflow_test');
  const c=new Client(config);await c.connect();
  const owner='10000000-0000-4000-8000-000000000001',writer='10000000-0000-4000-8000-000000000002',otherOwner='10000000-0000-4000-8000-000000000003';
  let sequence=100;const cases=[];const pass=label=>{cases.push(label);report(`PASS: ${label}`);};
  async function role(name,uid,sql,args=[],client=c){
    assert.ok(['anon','authenticated','service_role'].includes(name));await client.query('begin');
    try{await client.query(`set local role ${name}`);await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:name,sub:uid,email:'synthetic@example.invalid'})]);const r=await client.query(sql,args);await client.query('commit');return r;}
    catch(e){await client.query('rollback');throw e;}
  }
  const rpc=async(name,args=[],client=c)=>(await role('service_role',null,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as v`,args,client)).rows[0].v;
  const read=async(name,uid=owner)=>(await role('authenticated',uid,`select public.${name}() as v`)).rows[0].v;
  const prepare=(r,{request=randomUUID(),actor=owner,client=c,version=r.version,action=r.completed?'reset':'initialize'}={})=>rpc('employee_password_prepare',[actor,r.id,version,request,action],client);
  const consume=(r,ch,{actor=owner,client=c,version=r.version,action=r.completed?'reset':'initialize',audience=ch.audience,key=ch.key_id,record=r.id}={})=>rpc('employee_password_consume',[actor,ch.challenge_id,record,version,action,audience,key],client);
  const finish=(op,phase,actor=owner)=>rpc('employee_password_finish',[actor,op,phase]);
  const phase=async op=>(await c.query('select phase from employee_password.challenges where challenge_id=$1',[op])).rows[0]?.phase;
  async function reset(){await c.query('truncate employee_password.target_locks,employee_password.challenges,employee_password.budgets,employee_password.audit restart identity');await c.query('update employee_password.owners set enabled=true');}
  async function newUser(uid,email){await c.query('insert into auth.users(id,email) values($1,$2)',[uid,email]);await c.query("insert into auth.identities(user_id,provider,identity_data) values($1,'email',jsonb_build_object('email',$2::text))",[uid,email]);}
  async function target(){
    const serial=++sequence,uid=`20000000-0000-4000-8000-${String(serial).padStart(12,'0')}`,username=`plant${serial}`,email=`${username}@company.example.invalid`,id=`employee-${serial}`;
    await newUser(uid,email);
    await c.query("insert into public.app_employee_access(user_id,profile_key,allowed_views,allowed_wall_subviews,inventory_can_view,inventory_can_adjust,inventory_can_manage) values($1,'walls_inventory_counter',array['overview','walls','inventory','weekly-planner'],array['production'],true,true,false)",[uid]);
    await c.query(`insert into employee_password.approved_records(record_id,auth_uid,username,auth_email,display_name,enabled,reviewed_by,reviewed_at,reviewed_grants)
      values($1,$2,$3,$4,'Synthetic employee',true,$5,now(),employee_password.current_grants($2,$4))`,[id,uid,username,email,owner]);
    return {id,uid,username,email,version:1,completed:false};
  }
  async function nativeSuccess(r){await c.query('update auth.users set email_confirmed_at=coalesce(email_confirmed_at,clock_timestamp()) where id=$1',[r.uid]);}
  try{
    assert.equal((await c.query('select count(*)::int n from employee_password.owners')).rows[0].n,0);
    assert.equal((await c.query('select count(*)::int n from employee_password.approved_records')).rows[0].n,0);
    assert.deepEqual(await rpc('employee_password_readiness'),{enabled:false,current_key_id:null,audience:null,identifier_domain:null});
    pass('Migration seeds only disabled readiness, no owner, employee, account, grant, mail or key');
    const signatures=(await c.query("select oid::regprocedure::text as signature,proname from pg_proc where pronamespace='public'::regnamespace and proname like 'employee_password_%' order by proname")).rows;
    assert.equal(signatures.length,8);
    for(const row of signatures){const isRead=['employee_password_owner_status','employee_password_owner_targets'].includes(row.proname);
      const acl=(await c.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service",[row.signature])).rows[0];
      assert.deepEqual(acl,{anon:false,authenticated:isRead,service:!isRead});}
    for(const table of ['settings','owners','approved_records','challenges','target_locks','budgets','audit'])for(const roleName of ['anon','authenticated','service_role'])await assert.rejects(()=>role(roleName,null,`select * from employee_password.${table}`));
    await assert.rejects(()=>c.query('select public.employee_password_readiness()'));
    assert.equal((await c.query("select bool_and(relrowsecurity) v from pg_class where relnamespace='employee_password'::regnamespace and relkind='r'")).rows[0].v,true);
    pass('Actual SQL-role guards, exact RPC ACLs and private RLS deny browser impersonation and raw state');
    await newUser(owner,'owner@example.invalid');await newUser(writer,'writer@example.invalid');await newUser(otherOwner,'other-owner@example.invalid');
    await c.query('insert into employee_password.owners(user_id,enabled) values($1,true),($2,true)',[owner,otherOwner]);
    await c.query("insert into public.app_user_roles(user_id,role,can_write) values($1,'management',true)",[writer]);
    assert.equal(await rpc('employee_password_is_owner',[owner]),true);assert.equal(await rpc('employee_password_is_owner',[writer]),false);
    assert.deepEqual(await read('employee_password_owner_status',writer),{is_owner:false,available:false});
    await assert.rejects(()=>read('employee_password_owner_targets',writer));await assert.rejects(()=>read('employee_password_owner_targets',null));
    await assert.rejects(()=>role('authenticated',owner,"select public.employee_password_prepare($1,'unused',1,$2,'initialize')",[owner,randomUUID()]));
    await assert.rejects(()=>c.query('update employee_password.settings set enabled=true,version=version+1'));
    await c.query("update employee_password.settings set current_key_id='synthetic-key-1',audience='https://local.example.invalid/employee-password',identifier_domain='company.example.invalid',version=version+1");
    const r=await target();assert.equal((await prepare(r)).kind,'blocked');
    await c.query('update employee_password.settings set enabled=true,version=version+1');
    assert.deepEqual(await read('employee_password_owner_status'),{is_owner:true,available:true});
    const rows=await read('employee_password_owner_targets');assert.equal(rows[0].status,'ready');
    assert.deepEqual(Object.keys(rows[0]).sort(),['auth_uid','display_name','record_id','scope_label','setup_completed','status','username','version']);
    pass('Owner authority is exact UID membership, not writer/domain; enabled requires pinned configuration and browser lists omit email');
    const businessBefore=(await c.query('select to_jsonb(a) as row from public.app_employee_access a where user_id=$1',[r.uid])).rows;
    const identityBefore=(await c.query('select id,email from auth.users where id=$1',[r.uid])).rows;
    const request=randomUUID(),ch=await prepare(r,{request});assert.equal(ch.kind,'prepared');assert.match(ch.challenge_id,/^[a-f0-9-]{36}$/);assert.equal(ch.record.auth_uid,r.uid);
    const replay=await prepare(r,{request});assert.equal(replay.kind,'replay');assert.equal(replay.challenge_id,ch.challenge_id);assert.equal(replay.expires_at,ch.expires_at);assert.deepEqual(replay.record,ch.record);
    assert.equal((await prepare(r,{request,action:'reset'})).kind,'blocked');assert.equal((await prepare(r,{request,version:2})).kind,'blocked');
    for(const options of [{actor:otherOwner},{record:'missing'},{version:2},{action:'reset'},{audience:'wrong'},{key:'wrong'}])assert.equal((await consume(r,ch,options)).kind,'blocked');
    assert.equal(await phase(ch.challenge_id),'prepared');assert.equal((await consume(r,ch)).kind,'applying');
    assert.equal((await consume(r,ch)).kind,'blocked');assert.equal((await prepare(r,{request})).record,undefined);assert.equal((await prepare(r)).kind,'blocked');assert.equal(await finish(ch.challenge_id,'applied',otherOwner),false);
    pass('CSPRNG server challenge binds owner/request/record/version/action/audience/key; one-use consumption precedes effect and locks target');
    await c.query('update employee_password.owners set enabled=false where user_id=$1',[owner]);
    await nativeSuccess(r);assert.equal(await finish(ch.challenge_id,'applied'),true);assert.equal(await finish(ch.challenge_id,'applied'),false);
    r.version++;r.completed=true;await c.query('update employee_password.owners set enabled=true where user_id=$1',[owner]);
    const status=(await read('employee_password_owner_targets')).find(x=>x.record_id===r.id);assert.equal(status.version,2);assert.equal(status.setup_completed,true);assert.equal(status.status,'ready');
    assert.equal((await prepare(r,{version:1})).kind,'blocked');assert.equal((await prepare(r,{action:'initialize'})).kind,'blocked');
    await reset();const resetChallenge=await prepare(r);assert.equal(resetChallenge.kind,'prepared');assert.equal((await consume(r,resetChallenge)).kind,'applying');assert.equal(await finish(resetChallenge.challenge_id,'applied'),true);r.version++;
    assert.deepEqual((await c.query('select id,email from auth.users where id=$1',[r.uid])).rows,identityBefore);
    assert.deepEqual((await c.query('select to_jsonb(a) as row from public.app_employee_access a where user_id=$1',[r.uid])).rows,businessBefore);
    pass('Applied truth persists after owner revocation; initialization/reset advance version and unlock without changing existing identity or grants');

    await reset();const weak=await prepare(r);await consume(r,weak);assert.equal(await finish(weak.challenge_id,'rejected'),true);assert.equal((await consume(r,weak)).kind,'blocked');
    assert.equal((await c.query('select version,setup_completed from employee_password.approved_records where record_id=$1',[r.id])).rows[0].version,String(r.version));
    assert.equal((await prepare(r)).kind,'prepared');
    await reset();const uncertain=await prepare(r);await consume(r,uncertain);assert.equal(await finish(uncertain.challenge_id,'needs_review'),true);assert.equal(await finish(uncertain.challenge_id,'rejected'),false);
    await c.query("update employee_password.target_locks set created_at=now()-interval '2 years'");assert.equal((await prepare(r)).kind,'blocked');
    await c.query('truncate employee_password.budgets');assert.equal((await prepare(r,{actor:otherOwner})).kind,'blocked');
    pass('Only proven weak-password rejection releases consumed nonce with unchanged version; ambiguous state retains target lock forever across new owners/requests');

    await reset();const exp=await prepare(r);await c.query("update employee_password.challenges set created_at=now()-interval '3 minutes',expires_at=now()-interval '1 minute' where challenge_id=$1",[exp.challenge_id]);
    assert.equal((await consume(r,exp)).kind,'blocked');assert.equal((await prepare(r)).kind,'prepared');
    pass('Unused challenges expire after 120 seconds and cannot consume; expiration never releases an applying lock');
    const fresh=await target();await reset();
    for(const [field,value] of [['is_anonymous',true],['is_sso_user',true],['email_confirmed_at',new Date()],['last_sign_in_at',new Date()],['recovery_sent_at',new Date()],['deleted_at',new Date()],['banned_until',new Date('2000-01-01')],['email_change','pending@example.invalid'],['email','changed@example.invalid'],['raw_app_meta_data',{provider:'email',providers:['email','google']}]] ){
      const old=(await c.query(`select ${field} as v from auth.users where id=$1`,[fresh.uid])).rows[0].v;
      await c.query(`update auth.users set ${field}=$2 where id=$1`,[fresh.uid,value]);assert.equal((await prepare(fresh)).kind,'blocked',field);
      await c.query(`update auth.users set ${field}=$2 where id=$1`,[fresh.uid,old]);await c.query('truncate employee_password.budgets');
    }
    await c.query("insert into auth.identities(user_id,provider,identity_data) values($1,'google','{}')",[fresh.uid]);assert.equal((await prepare(fresh)).kind,'blocked');await c.query("delete from auth.identities where user_id=$1 and provider='google'",[fresh.uid]);
    await c.query('insert into auth.mfa_factors(user_id) values($1)',[fresh.uid]);assert.equal((await prepare(fresh)).kind,'blocked');await c.query('delete from auth.mfa_factors where user_id=$1',[fresh.uid]);
    await c.query('update auth.users set recovery_sent_at=now(),last_sign_in_at=now() where id=$1',[r.uid]);assert.equal((await prepare(r)).kind,'prepared');
    pass('Initialize requires unused unconfirmed native identity; reset permits historical use/recovery but rejects identity, MFA, ban and pending-email drift');

    const grants=[
      ["insert into public.app_user_roles(user_id,role,can_write) values($1,'viewer',false)",'delete from public.app_user_roles where user_id=$1',[r.uid]],
      ['insert into public.walls_production_access(user_id,enabled) values($1,false)','delete from public.walls_production_access where user_id=$1',[r.uid]],
      ['insert into public.walls_installation_access(user_id,enabled) values($1,false)','delete from public.walls_installation_access where user_id=$1',[r.uid]],
      ['insert into public.weekly_planner_access(user_id,enabled) values($1,false)','delete from public.weekly_planner_access where user_id=$1',[r.uid]],
      ['insert into public.inventory_user_access(email,enabled) values($1,false)','delete from public.inventory_user_access where email=$1',[r.email]],
      ["insert into public.app_employee_access(user_id,profile_key,inventory_area) values($1,'walls_inventory_counter','install')","delete from public.app_employee_access where user_id=$1 and inventory_area='install'",[r.uid]],
    ];
    for(const [add,remove,args] of grants){await reset();const op=await prepare(r);await c.query(add,args);assert.equal((await consume(r,op)).kind,'blocked');await c.query(remove,args);}
    await reset();
    for(const [field,value] of [['inventory_can_manage',true],['inventory_can_adjust',false],['allowed_views',['overview','walls','inventory','billing']],['allowed_wall_subviews',['production','installation']]]){
      const old=(await c.query(`select ${field} as v from public.app_employee_access where user_id=$1`,[r.uid])).rows[0].v;
      await c.query(`update public.app_employee_access set ${field}=$2 where user_id=$1`,[r.uid,value]);assert.equal((await prepare(r)).kind,'blocked');
      await c.query(`update public.app_employee_access set ${field}=$2 where user_id=$1`,[r.uid,old]);await c.query('truncate employee_password.budgets');
    }
    pass('Complete effective grant union blocks all UID/legacy-email additive rows and scope/flag drift, including disabled independent rows');
    await c.query('alter table public.app_employee_access add column future_permission boolean not null default false');assert.equal((await prepare(r)).kind,'blocked');await c.query('alter table public.app_employee_access drop column future_permission');
    const def=(await c.query("select pg_get_functiondef('public.can_edit_schedule()'::regprocedure) as d")).rows[0].d;
    await c.query("create or replace function public.can_edit_schedule() returns boolean language sql stable security definer set search_path=public as $$select false$$");assert.equal((await prepare(r)).kind,'blocked');await c.query(def);
    pass('Unknown grant columns and authority definition/ACL/RLS fingerprints fail closed');
    for(const [table,trigger] of [['walls_production_assignments','mixed_employee_walls_assignment_target'],['walls_production_issues','mixed_employee_walls_issue_target']]){
      const definition=(await c.query('select pg_get_triggerdef(oid,true) as definition from pg_trigger where tgrelid=$1::regclass and tgname=$2',[`public.${table}`,trigger])).rows[0].definition;
      for(const mutation of ['disable','drop']){
        await reset();const prepared=await prepare(r);assert.equal(prepared.kind,'prepared');
        const fingerprint=(await c.query('select employee_password.authority_fingerprint() as value')).rows[0].value;
        try{
          await c.query(mutation==='disable'?`alter table public.${table} disable trigger ${trigger}`:`drop trigger ${trigger} on public.${table}`);
          assert.notEqual((await c.query('select employee_password.authority_fingerprint() as value')).rows[0].value,fingerprint);
          assert.equal((await prepare(r)).kind,'blocked');assert.equal((await consume(r,prepared)).kind,'blocked');
          assert.equal(await phase(prepared.challenge_id),'prepared');
          assert.equal((await read('employee_password_owner_targets')).find(x=>x.record_id===r.id).status,'unavailable');
        }finally{await c.query(mutation==='disable'?`alter table public.${table} enable trigger ${trigger}`:definition);}
        assert.equal((await c.query('select employee_password.authority_fingerprint() as value')).rows[0].value,fingerprint);
      }
    }
    pass('Disabling or dropping either mixed target guard changes authority fingerprint and blocks prepare/consume without target effect');


    await reset();const edited=await prepare(r);
    await c.query("update employee_password.approved_records set display_name='Re-reviewed label',version=version+1,reviewed_at=clock_timestamp() where record_id=$1",[r.id]);r.version++;
    assert.equal((await consume(r,edited,{version:r.version-1})).kind,'blocked');
    for(const patch of ["username='othername'","auth_email='othername@company.example.invalid'",`auth_uid='${writer}'`])await assert.rejects(()=>c.query(`update employee_password.approved_records set ${patch},version=version+1,reviewed_at=clock_timestamp() where record_id=$1`,[r.id]));
    const locked=await prepare(r);await consume(r,locked);
    await assert.rejects(()=>c.query("update employee_password.approved_records set display_name='Unexpected edit',version=version+1,reviewed_at=clock_timestamp() where record_id=$1",[r.id]));
    pass('Approved identity fields are immutable; reviewed version edits invalidate prepared envelopes and applying lock prevents revisions');

    const c1=new Client(config),c2=new Client(config);await Promise.all([c1.connect(),c2.connect()]);
    try{
      await reset();const key=randomUUID();const same=await Promise.all([prepare(r,{request:key,client:c1}),prepare(r,{request:key,client:c2})]);assert.deepEqual(same.map(x=>x.kind).sort(),['prepared','replay']);assert.equal(same[0].challenge_id,same[1].challenge_id);
      const raced=await Promise.all([consume(r,same[0],{client:c1}),consume(r,same[0],{client:c2})]);assert.deepEqual(raced.map(x=>x.kind).sort(),['applying','blocked']);
      await reset();const first=await prepare(r),second=await prepare(r,{actor:otherOwner});
      const different=await Promise.all([consume(r,first,{client:c1}),consume(r,second,{actor:otherOwner,client:c2})]);assert.deepEqual(different.map(x=>x.kind).sort(),['applying','blocked']);
      pass('Concurrent same-request prepare replays; same nonce or distinct-owner challenges permit exactly one target effect');
      await reset();const drift=await prepare(r);await c1.query('begin');await c1.query('update employee_password.owners set enabled=false where user_id=$1',[owner]);
      const pending=consume(r,drift,{client:c2});await new Promise(resolve=>setTimeout(resolve,50));await c1.query('commit');assert.equal((await pending).kind,'blocked');
      await reset();const blocked=await prepare(r);await c1.query('begin');await c1.query('insert into public.walls_production_access(user_id) values($1)',[r.uid]);
      const started=Date.now();await assert.rejects(()=>consume(r,blocked,{client:c2}),error=>error.code==='55P03');assert.ok(Date.now()-started<8000);await c1.query('commit');
      assert.equal(await phase(blocked.challenge_id),'prepared');assert.equal((await consume(r,blocked)).kind,'blocked');await c.query('delete from public.walls_production_access where user_id=$1',[r.uid]);
      pass('Owner revocation and additive-grant insertion races are fenced; two-second lock timeout commits no consumed nonce or target lock');
      await reset();const nearExpiry=await prepare(r);await c.query("update employee_password.challenges set created_at=clock_timestamp()-interval '119 seconds',expires_at=clock_timestamp()+interval '200 milliseconds' where challenge_id=$1",[nearExpiry.challenge_id]);
      await c1.query('begin');await c1.query('lock table public.app_user_roles in row exclusive mode');
      const waiting=consume(r,nearExpiry,{client:c2});await new Promise(resolve=>setTimeout(resolve,350));await c1.query('commit');
      assert.equal((await waiting).kind,'blocked');assert.equal(await phase(nearExpiry.challenge_id),'prepared');
      pass('Challenge expiry is rechecked after lock contention, immediately before durable consumption');
    }finally{await c1.query('rollback').catch(()=>{});await c2.query('rollback').catch(()=>{});await Promise.all([c1.end(),c2.end()]);}
    await reset();const keyDrift=await prepare(r);await c.query("update employee_password.settings set current_key_id='synthetic-key-2',version=version+1");assert.equal((await consume(r,keyDrift)).kind,'blocked');
    const disabled=await prepare(r);await c.query('update employee_password.settings set enabled=false,version=version+1');assert.equal((await consume(r,disabled)).kind,'blocked');await c.query('update employee_password.settings set enabled=true,version=version+1');
    pass('Key rotation, settings version and production disable fence prepared requests at consume');
    await reset();for(let i=0;i<120;i++)assert.equal(await rpc('employee_password_preflight'),true);assert.equal(await rpc('employee_password_preflight'),false);
    const restart=new Client(config);await restart.connect();try{assert.equal(await rpc('employee_password_preflight',[],restart),false);}finally{await restart.end();}
    await reset();for(let i=0;i<5;i++)assert.equal((await prepare(r)).kind,'prepared');assert.equal((await prepare(r)).kind,'blocked');
    await reset();await c.query("insert into employee_password.budgets(bucket,starts_at,attempts) values($1,now(),10)",['owner:'+owner]);assert.equal((await prepare(r)).kind,'blocked');
    await c.query("update employee_password.budgets set starts_at=now()-interval '11 minutes'");assert.equal((await prepare(r)).kind,'prepared');
    pass('Durable pre-decrypt global 120/300s, owner 10/600s and target 5/600s budgets survive reconnect and roll windows atomically');
    const columns=(await c.query("select column_name from information_schema.columns where table_schema='employee_password' and table_name='audit' order by ordinal_position")).rows.map(x=>x.column_name);
    assert.deepEqual(columns,['audit_id','actor_id','record_id','operation_id','reviewed_version','event','occurred_at']);
    const audit=JSON.stringify((await c.query('select * from employee_password.audit')).rows);assert.doesNotMatch(audit,/@|password|token|https:|Bearer|cipher/);
    assert.deepEqual((await c.query('select to_jsonb(a) as row from public.app_employee_access a where user_id=$1',[r.uid])).rows,businessBefore);
    assert.deepEqual((await c.query('select id,email from auth.users where id=$1',[r.uid])).rows,identityBefore);
    pass('Audit contains fixed nonsecret metadata only; all business grants and existing UID/backing email remain unchanged');
    return {passed:cases.length,cases};
  }finally{await c.end();}
}
