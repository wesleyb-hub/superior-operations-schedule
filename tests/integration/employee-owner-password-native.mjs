// PRIVATE UNEXECUTED CI CANDIDATE: run only after separate publication/run approval.
// No hosted endpoints, real identities/credentials or Auth-table DML.
// The browser runs only in the separately approved isolated CI job.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { bootstrapOwnerPasswordDatabase } from './employee-owner-password-native-bootstrap.mjs';
import {runEmployeeOwnerPasswordNativeBrowser,EmployeeOwnerPasswordBrowserFailure} from './employee-owner-password-native-browser.mjs';
import { createPasswordHandler } from '../../employee-password-candidate/password-service.mjs';
import { createSyntheticAdapters } from '../../employee-password-candidate/server-adapters.mjs';
import {matchesExistingEmailIdentity} from '../../employee-password-candidate/identity.mjs';
import { encryptCommand } from '../../employee-password-candidate/browser-crypto.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUN_EMPLOYEE_OWNER_PASSWORD_NATIVE_TEST !== '1') {
  throw new Error('Requires the explicitly authorized isolated GitHub test job.');
}
const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, 'artifacts/employee-owner-password-native');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'superior-native-owner-password-'));
await fs.chmod(temp, 0o700);
const configDir = path.join(temp, 'supabase'), cliPath = path.join(temp, 'bin/supabase');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SUPABASE_|GOTRUE_|PG|DATABASE_URL|EMPLOYEE_)/.test(key)));
Object.assign(env, { SUPABASE_HOME: path.join(temp, 'state'), SUPABASE_EXPERIMENTAL_STACK: '1', SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' });
const result = { scope: 'isolated loopback native Auth on ephemeral GitHub runner', cli: '2.122.0', nativeAuth: '2.197.0', cases: [], passed: false, cleanup: false, limitations: ['Not the hosted production Auth version', 'No real account, hosted credentials, email or delivery', 'Logical synthetic origin/key mapping exercises real loopback PostgREST/Auth but not hosted gateway translation', 'Browser exercises isolated native Auth only, not a production deployment', 'Old access JWTs can remain valid until expiry; password reset is not offboarding', 'Historical recovery-link invalidation is not verified by this harness'] };
let stage = 'prepare', started = false, db, exitCode = 0;
class TestFailure extends Error {}
const requireThat = (condition, label) => { if (!condition) throw new TestFailure(label); };
const report = label => { result.cases.push(label); console.log(`PASS: ${label}`); };
const password = () => `Aa9!${randomBytes(24).toString('base64url')}`;
const command = (args, timeout = 240000) => exec(cliPath, args, { cwd: temp, env, timeout, maxBuffer: 12 * 1024 * 1024 });
const loopback = value => { const u = new URL(value); requireThat(['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname), 'Non-loopback target rejected'); return u; };
const localFetch = (url, init) => { loopback(typeof url === 'string' ? url : url.url ?? url.href); return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000) }); };
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: localFetch } };
try {
  await fs.mkdir(path.join(temp, 'bin')); await fs.mkdir(configDir);
  for (const file of ['config.toml', 'supabase.lock']) await fs.copyFile(path.join(root, 'tests/integration/native-recovery', file), path.join(configDir, file));
  const archiveUrl = 'https://github.com/supabase/cli/releases/download/v2.122.0/supabase_2.122.0_linux_amd64.tar.gz';
  const download = await fetch(archiveUrl, { signal: AbortSignal.timeout(120000) });
  requireThat(download.ok, 'Official CLI download failed');
  const archive = Buffer.from(await download.arrayBuffer());
  requireThat(createHash('sha256').update(archive).digest('hex') === '59ed066847b98d7461c60e9109d40cab6b9756177ce06ebb05b51338519f5136', 'CLI checksum mismatch');
  await fs.writeFile(path.join(temp, 'cli.tar.gz'), archive, { mode: 0o600 });
  await exec('tar', ['-xzf', path.join(temp, 'cli.tar.gz'), '-C', path.join(temp, 'bin'), 'supabase', 'supabase-go']);
  requireThat((await command(['--version'])).stdout.trim() === '2.122.0', 'Unexpected CLI version');
  stage = 'native stack start';
  const start = await command(['stack', 'start', '--runtime', 'native', '--frozen', '--preparation', 'on-demand', '--exclude', 'realtime,storage,functions,studio,mail,analytics,pooler', '--eager', '--output-format', 'json'], 360000);
  started = true;
  const state = JSON.parse(start.stdout), vars = state.env ?? state.result?.env;
  requireThat(vars?.API_URL && vars?.DB_URL && vars?.SERVICE_ROLE_KEY && vars?.ANON_KEY, 'Missing local runtime connection details');
  const api = loopback(vars.API_URL).origin, dbUrl = loopback(vars.DB_URL);
  requireThat(['postgresql:', 'postgres:'].includes(dbUrl.protocol), 'Unexpected local DB protocol');
  requireThat(state.runtime === 'native' || state.result?.runtime === 'native', 'Native runtime not confirmed');
  for (const endpoint of Object.values(state.endpoints ?? {})) if (endpoint.url) loopback(endpoint.url);
  const health = await localFetch(`${api}/auth/v1/health`, { headers: { apikey: vars.ANON_KEY } }).then(r => r.json());
  requireThat(String(health.version).includes('2.197.0'), 'Unexpected native Auth version');
  report('Pinned native Auth/Postgres started only on loopback; no hosted configuration');
  const admin = createClient(api, vars.SERVICE_ROLE_KEY, options);
  const fresh = () => createClient(api, vars.ANON_KEY, options);
  const keyId='employee-password-native-test', audience='https://auth.example.invalid/functions/v1/employee-password';
  const ownerEmail='owner-password-test@company.example.invalid',ownerPassword=password();
  const employees=[{username:'nativeplantone',initialPassword:password()},{username:'nativeplanttwo',initialPassword:password()},{username:'nativemixed',profile:'mixed'}];
  db=new pg.Client({connectionString:vars.DB_URL});
  const effectiveDb=db.connectionParameters;
  requireThat(['127.0.0.1','localhost','::1'].includes(effectiveDb.host)&&effectiveDb.database==='postgres'&&dbUrl.port&&Number(effectiveDb.port)===Number(dbUrl.port)&&!dbUrl.search&&!dbUrl.hash,'Unexpected effective local DB connection');
  await db.connect();
  requireThat((await db.query('select count(*)::int n from auth.users')).rows[0].n===0,'Requires an empty isolated native database');
  const ownerCreated=await admin.auth.admin.createUser({email:ownerEmail,password:ownerPassword,email_confirm:true});
  requireThat(!ownerCreated.error&&ownerCreated.data.user?.id,'Synthetic owner creation failed');
  const ownerUid=ownerCreated.data.user.id;
  for(const employee of employees){
    employee.email=employee.username+'@company.example.invalid';
    const attributes=employee.profile==='mixed'?{email:employee.email,email_confirm:false}:{email:employee.email,password:employee.initialPassword,email_confirm:false};
    if(employee.profile==='mixed')requireThat(Object.keys(attributes).sort().join(',')==='email,email_confirm','Mixed create must omit password, metadata and invitation attributes');
    const created=await admin.auth.admin.createUser(attributes);
    requireThat(!created.error&&created.data.user?.id&&!created.data.user.email_confirmed_at,'Synthetic employee creation failed');
    if(employee.profile==='mixed'){
      requireThat(matchesExistingEmailIdentity(created.data.user,{auth_uid:created.data.user.id,auth_email:employee.email}),'No-password native create lacks required exact email identity');
      requireThat(!created.data.user.last_sign_in_at&&!created.data.user.confirmation_sent_at&&!created.data.user.recovery_sent_at,'No-password native create unexpectedly used confirmation/recovery/sign-in flow');
      report('Synthetic mixed account created by native Admin with email and email_confirm:false only; no password or email flow; exact provider/identity verified');
    }
    employee.uid=created.data.user.id;employee.record_id='native-'+employee.username;employee.version=1;
  }
  result.bootstrap=await bootstrapOwnerPasswordDatabase(db,{ownerUid,employees,keyId,audience});
  const fullGrantSnapshot=async()=>JSON.stringify((await db.query(`select user_id,employee_password.current_grants(user_id,username||'@company.example.invalid') as grants from (select auth_uid as user_id,username from employee_password.approved_records) s order by user_id`)).rows);
  const baselineFullGrants=await fullGrantSnapshot();
  const baselineUsers=JSON.stringify((await db.query('select id,email from auth.users order by id')).rows);
  const baselineGrants=JSON.stringify((await db.query('select to_jsonb(a) r from public.app_employee_access a order by user_id')).rows);
  const baselineOwnerGrants=JSON.stringify((await db.query('select to_jsonb(a) r from public.app_user_roles a order by user_id')).rows);
  const keyPair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  const rawJwk=await crypto.subtle.exportKey('jwk',keyPair.publicKey),notAfter=new Date(Date.now()+3600000).toISOString();
  const publicConfiguration={kid:keyId,not_after:notAfter,jwk:{kty:rawJwk.kty,n:rawJwk.n,e:rawJwk.e}};
  const policy={enabled:true,mode:'synthetic-local',authOrigin:'https://auth.example.invalid',hubOrigin:'https://hub.example.invalid',identifierDomain:'company.example.invalid',audience,keyId,keyNotAfter:notAfter,publicKey:'synthetic-public-key'};
  let nativeWrites=0,loseNextWriteResponse=false;
  const writeShapes=[];
  // The only test transport substitution is origin + ephemeral credentials.
  // Method/body/native HTTP status/body are forwarded unchanged, never mocked.
  const translatedFetch=async(url,init)=>{
    const logical=new URL(url);
    requireThat(logical.origin==='https://auth.example.invalid'&&!logical.search&&!logical.hash,'Unexpected logical native target');
    requireThat(/^\/(?:rest\/v1\/rpc\/employee_password_[a-z_]+|auth\/v1\/(?:user|admin\/users\/[a-f0-9-]{36}))$/.test(logical.pathname),'Unexpected native path');
    const headers=new Headers(init.headers),apiKey=headers.get('apikey'),authorization=headers.get('authorization');
    requireThat(['synthetic-server-key','synthetic-public-key'].includes(apiKey),'Unexpected adapter key');
    headers.set('apikey',apiKey==='synthetic-server-key'?vars.SERVICE_ROLE_KEY:vars.ANON_KEY);
    if(authorization==='Bearer synthetic-server-key')headers.set('authorization','Bearer '+vars.SERVICE_ROLE_KEY);
    const isWrite=init.method==='PUT'&&logical.pathname.startsWith('/auth/v1/admin/users/');
    if(isWrite){
      nativeWrites++;
      let body;try{body=JSON.parse(init.body);writeShapes.push({fields:Object.keys(body).sort().join(','),confirm:body.email_confirm===true});}finally{if(body)body.password='';body=null;}
    }
    const response=await localFetch(api+logical.pathname,{...init,headers});
    if(isWrite&&loseNextWriteResponse){loseNextWriteResponse=false;await response.body?.cancel();throw new Error('Synthetic response interruption after native dispatch');}
    return response;
  };
  const adapters=createSyntheticAdapters({authOrigin:policy.authOrigin,publicKey:policy.publicKey,serverKey:'synthetic-server-key'},translatedFetch);
  const handler=createPasswordHandler({...adapters,privateKey:Promise.resolve(keyPair.privateKey)},policy);
  const signedOwner=await fresh().auth.signInWithPassword({email:ownerEmail,password:ownerPassword});
  requireThat(!signedOwner.error&&signedOwner.data.session?.access_token,'Synthetic owner sign-in failed');
  let ownerToken=signedOwner.data.session.access_token;
  const makeCommand=(employee,kind,{requestId=randomUUID(),challengeId,chosenPassword,actor=ownerUid,token=ownerToken}={})=>{
    const now=Math.floor(Date.now()/1000),action=employee.version===1?'initialize':'reset';
    const value={v:1,kind,aud:audience,owner_uid:actor,owner_token:token,record_id:employee.record_id,target_uid:employee.uid,
      expected_version:employee.version,action,request_id:requestId,iat:now,exp:now+60,confirm_email:action==='initialize'};
    if(kind==='apply'){value.challenge_id=challengeId;value.password=chosenPassword;}
    return value;
  };
  const protectedRequest=encrypted=>new Request(audience,{method:'POST',headers:{origin:policy.hubOrigin,apikey:policy.publicKey,'content-type':'application/jose'},body:encrypted});
  const invoke=async value=>{
    let encrypted;try{encrypted=await encryptCommand(value,publicConfiguration);const response=await handler(protectedRequest(encrypted));return {status:response.status,body:await response.json()};}
    finally{value.password='';value.owner_token='';encrypted='';}
  };
  const prepare=async employee=>{
    const requestId=randomUUID(),out=await invoke(makeCommand(employee,'prepare',{requestId}));
    requireThat(out.status===200&&out.body.status==='prepared'&&out.body.challenge_id,'Protected native prepare failed');
    return {requestId,challengeId:out.body.challenge_id};
  };
  const apply=async(employee,prepared,chosenPassword)=>invoke(makeCommand(employee,'apply',{...prepared,chosenPassword}));
  const getUser=async employee=>{const value=await admin.auth.admin.getUserById(employee.uid);requireThat(!value.error,'Native user read failed');return value.data.user;};
  const login=async(employee,chosenPassword)=>fresh().auth.signInWithPassword({email:employee.email,password:chosenPassword});
  const phase=async id=>(await db.query('select phase from employee_password.challenges where challenge_id=$1',[id])).rows[0]?.phase;
  const primary=employees[0],uncertain=employees[1];

  stage='native PostgREST availability';
  let ready=false;
  for(let i=0;i<50&&!ready;i++){
    try{ready=(await adapters.readiness()).enabled===true;}catch{}
    if(!ready)await new Promise(resolve=>setTimeout(resolve,100));
  }
  requireThat(ready,'Native PostgREST schema reload did not settle');
  const deniedInitial=await login(primary,primary.initialPassword);
  requireThat(deniedInitial.error?.code==='email_not_confirmed','Initial unconfirmed sign-in unexpectedly succeeded');
  report('Native-created existing employee starts unconfirmed; exact candidate schema is served through real PostgREST');

  stage='protected initialize';
  const initial=await prepare(primary),firstPassword=password();
  const initialized=await apply(primary,initial,firstPassword);
  requireThat(initialized.status===200&&initialized.body.status==='applied','Protected native initialize did not apply');
  primary.version++;
  const afterInitialize=await getUser(primary),confirmedAt=afterInitialize.email_confirmed_at;
  requireThat(afterInitialize.id===primary.uid&&afterInitialize.email===primary.email&&confirmedAt,'Initialize changed identity or did not confirm it');
  requireThat(writeShapes.at(-1).fields==='email_confirm,password'&&writeShapes.at(-1).confirm,'Initialize native body lacks explicit confirmation');
  const firstLogin=await login(primary,firstPassword);
  requireThat(!firstLogin.error&&firstLogin.data.user?.id===primary.uid,'Initialized native password does not sign in');
  requireThat((await login(primary,primary.initialPassword)).error?.code==='invalid_credentials','Initial native password still works');
  const oldSession=firstLogin.data.session;
  report('Real JWE initialize traverses handler and PostgREST, confirms only the same existing UID, and changes native password');

  stage='wrong-owner and replay';
  const beforeDeniedWrites=nativeWrites;
  const notOwner=await invoke(makeCommand(primary,'prepare',{actor:primary.uid,token:oldSession.access_token}));
  requireThat(notOwner.status===403&&nativeWrites===beforeDeniedWrites,'Employee impersonated owner');
  const replayCommand=makeCommand({...primary,version:1},'apply',{...initial,chosenPassword:password()});
  const replayed=await invoke(replayCommand);
  requireThat(replayed.status===409&&nativeWrites===beforeDeniedWrites,'Consumed initialize challenge replay caused native write');
  const employeeAcl=await localFetch(api+'/rest/v1/rpc/employee_password_readiness',{method:'POST',headers:{apikey:vars.ANON_KEY,authorization:'Bearer '+oldSession.access_token,'content-type':'application/json'},body:'{}'});
  const liveEmployee=await fresh().auth.getUser(oldSession.access_token);
  requireThat(!liveEmployee.error&&liveEmployee.data.user?.id===primary.uid,'ACL probe employee JWT must be currently valid');
  const aclBody=await employeeAcl.json();
  requireThat(employeeAcl.status===403&&aclBody.code==='42501'||employeeAcl.status===404&&aclBody.code==='PGRST202','Expected an explicit native PostgREST service-RPC privilege denial');
  report('Actual native employee token cannot become owner or call service RPC; replay causes zero additional native writes');

  stage='protected reset and session semantics';
  const reset=await prepare(primary),secondPassword=password(),resetResult=await apply(primary,reset,secondPassword);
  requireThat(resetResult.status===200&&resetResult.body.status==='applied','Protected native reset failed');primary.version++;
  requireThat(writeShapes.at(-1).fields==='password'&&!writeShapes.at(-1).confirm,'Reset unexpectedly sent a confirmation/email attribute');
  const afterReset=await getUser(primary);
  requireThat(afterReset.email_confirmed_at===confirmedAt&&afterReset.id===primary.uid&&afterReset.email===primary.email,'Reset changed confirmation/identity');
  requireThat((await login(primary,firstPassword)).error?.code==='invalid_credentials','Previous password still authenticates after reset');
  const currentLogin=await login(primary,secondPassword);requireThat(!currentLogin.error&&currentLogin.data.user?.id===primary.uid,'Reset password does not authenticate');
  const refreshed=await fresh().auth.refreshSession({refresh_token:oldSession.refresh_token});
  requireThat(refreshed.error?.status===400&&['refresh_token_not_found','refresh_token_already_used','session_not_found'].includes(refreshed.error?.code)&&!refreshed.data.session,'Native refresh revocation must return an explicit invalid-session code, not a network/provider error');
  const oldJwtResponse=await localFetch(api+'/rest/v1/rpc/get_app_access',{method:'POST',headers:{apikey:vars.ANON_KEY,authorization:'Bearer '+oldSession.access_token,'content-type':'application/json'},body:'{}'});
  requireThat(oldJwtResponse.status===200,'Old-JWT caveat probe must run before its short native expiry');
  const oldAccess=await oldJwtResponse.json();
  requireThat(oldAccess.authorized===true&&oldAccess.is_admin===false&&oldAccess.can_write===false&&oldAccess.allowed_wall_subviews?.join(',')==='production'
    &&oldAccess.allowed_views?.every(x=>['overview','walls','inventory','weekly-planner'].includes(x)),'Old JWT changed employee scope');
  report('Native reset preserves confirmation/UID/email, rejects prior password and refresh token; pre-expiry old JWT still carries only existing restricted RLS scope');

  stage='native weak-password rejection';
  const weak=await prepare(primary),beforeWeakVersion=primary.version;
  const weakResult=await apply(primary,weak,'TooShort9!');
  requireThat(weakResult.status===422&&weakResult.body.status==='invalid_password','Actual native weak-password wire response did not match the safe rejection allowlist');
  requireThat(await phase(weak.challengeId)==='rejected','Weak password did not consume/reject challenge');
  requireThat((await db.query('select count(*)::int n from employee_password.target_locks where auth_uid=$1',[primary.uid])).rows[0].n===0,'Proven weak rejection left target locked');
  requireThat((await db.query('select version from employee_password.approved_records where auth_uid=$1',[primary.uid])).rows[0].version===String(beforeWeakVersion),'Weak rejection changed record version');
  requireThat(!(await login(primary,secondPassword)).error,'Weak rejection changed the current native password');
  const stronger=await prepare(primary),thirdPassword=password(),strongResult=await apply(primary,stronger,thirdPassword);
  requireThat(strongResult.status===200&&strongResult.body.status==='applied','Stronger deliberate retry after validation rejection failed');primary.version++;
  report('Actual native weak-password validation consumes nonce without mutation; a fresh stronger-password request succeeds');

  stage='native concurrency';
  const race=await prepare(primary),racePassword=password(),raceValue=makeCommand(primary,'apply',{...race,chosenPassword:racePassword});
  let sameEnvelope=await encryptCommand(raceValue,publicConfiguration);raceValue.password='';raceValue.owner_token='';
  const beforeRaceWrites=nativeWrites;
  const responses=await Promise.all([handler(protectedRequest(sameEnvelope)),handler(protectedRequest(sameEnvelope))]);sameEnvelope='';
  const outcomes=await Promise.all(responses.map(async response=>({status:response.status,body:await response.json()})));
  requireThat(outcomes.filter(x=>x.status===200&&x.body.status==='applied').length===1&&outcomes.filter(x=>x.status===409).length===1&&nativeWrites===beforeRaceWrites+1,'Concurrent replay caused more than one native effect');
  primary.version++;
  requireThat(!(await login(primary,racePassword)).error,'Concurrent winning password not applied');
  report('Two concurrent identical protected requests produce exactly one real native password update');

  stage='actual Hub owner UI, JWE and native Auth';
  await runEmployeeOwnerPasswordNativeBrowser({root,apiUrl:api,anonKey:vars.ANON_KEY,handler,
    owner:{uid:ownerUid,email:ownerEmail,password:ownerPassword},employee:{...uncertain},
    publicKeyConfig:publicConfiguration,report});
  uncertain.version=Number((await db.query('select version from employee_password.approved_records where auth_uid=$1',[uncertain.uid])).rows[0].version);
  requireThat(uncertain.version===3,'Browser must initialize and reset the second existing identity exactly once each');
  const renewedOwner=await fresh().auth.signInWithPassword({email:ownerEmail,password:ownerPassword});
  requireThat(!renewedOwner.error&&renewedOwner.data.session?.access_token,'Native owner session renewal after browser fixture failed');
  ownerToken=renewedOwner.data.session.access_token;

  stage='mixed profile real native lifecycle';
  const mixed=employees[2],mixedPassword=password(),mixedPrepared=await prepare(mixed);
  const mixedInitialized=await apply(mixed,mixedPrepared,mixedPassword);
  requireThat(mixedInitialized.status===200&&mixedInitialized.body.status==='applied','Mixed profile native initialize failed');mixed.version++;
  const mixedLogin=await login(mixed,mixedPassword);
  requireThat(!mixedLogin.error&&mixedLogin.data.user?.id===mixed.uid,'Mixed native login failed');
  const mixedDenied=await invoke(makeCommand(mixed,'prepare',{actor:mixed.uid,token:mixedLogin.data.session.access_token}));
  requireThat(mixedDenied.status===403,'Mixed profile became password owner');
  const mixedResetPassword=password(),mixedReset=await apply(mixed,await prepare(mixed),mixedResetPassword);
  requireThat(mixedReset.status===200&&mixedReset.body.status==='applied','Mixed profile native reset failed');mixed.version++;
  requireThat(!(await login(mixed,mixedResetPassword)).error&&(await login(mixed,mixedPassword)).error?.code==='invalid_credentials','Mixed native reset password verification failed');
  requireThat(await fullGrantSnapshot()===baselineFullGrants,'Mixed password lifecycle changed grants');
  report('Fourth synthetic mixed-profile identity created without password initializes and resets through real native Auth; cannot administer passwords; full six-table grants unchanged');

  stage='native lost-success-response uncertainty';
  const interrupted=await prepare(uncertain),uncertainPassword=password();loseNextWriteResponse=true;
  const lost=await apply(uncertain,interrupted,uncertainPassword);
  requireThat(lost.status===409&&lost.body.status==='needs_review'&&await phase(interrupted.challengeId)==='needs_review','Lost native success response did not retain durable uncertainty');
  requireThat(!(await login(uncertain,uncertainPassword)).error,'Uncertainty fixture did not actually apply native update');
  const beforeRetryWrites=nativeWrites,newRequest=await invoke(makeCommand(uncertain,'prepare'));
  requireThat(newRequest.status===409&&nativeWrites===beforeRetryWrites,'New request bypassed uncertain target lock');
  requireThat((await db.query('select count(*)::int n from employee_password.target_locks where auth_uid=$1',[uncertain.uid])).rows[0].n===1,'Uncertain target lost its durable lock');
  report('Lost response after an actual native update remains needs_review; new nonce/request cannot blindly overwrite');

  stage='unchanged scopes and secret-free state';
  requireThat(await fullGrantSnapshot()===baselineFullGrants,'Password operations changed full union of business grants');
  requireThat(JSON.stringify((await db.query('select id,email from auth.users order by id')).rows)===baselineUsers,'Native owner password operations changed identities or account count');
  requireThat(JSON.stringify((await db.query('select to_jsonb(a) r from public.app_employee_access a order by user_id')).rows)===baselineGrants,'Employee business grants changed');
  requireThat(JSON.stringify((await db.query('select to_jsonb(a) r from public.app_user_roles a order by user_id')).rows)===baselineOwnerGrants,'Owner business grants changed');
  requireThat(!(await fresh().auth.signInWithPassword({email:ownerEmail,password:ownerPassword})).error,'Other owner password changed');
  const audit=JSON.stringify((await db.query('select * from employee_password.audit')).rows);
  requireThat(!/@|password|token|https:|Bearer|cipher/i.test(audit),'Audit includes unexpected sensitive/free-form data');
  report('Exactly four synthetic existing identities and all employee/owner business grants are unchanged; audit contains only fixed nonsecret metadata');
  result.nativePasswordUpdateRequests=nativeWrites;result.syntheticUsers=4;result.passed=true;ownerToken='';
} catch(error){
  exitCode=1;result.failure={stage,message:error instanceof TestFailure||error instanceof EmployeeOwnerPasswordBrowserFailure?error.message:'Native operation failed; raw provider/parser/process diagnostics suppressed'};
  console.error(`FAIL: ${stage}: ${result.failure.message}`);
} finally {
  if(db)await db.end().catch(()=>{});
  try{
    const exists=await fs.stat(cliPath).then(()=>true,()=>false);
    if(exists){
      const listed=JSON.parse((await command(['stack','list','--output-format','json'],30000)).stdout);
      const items=Array.isArray(listed)?listed:listed.stacks??listed.result?.stacks??[];
      if(started||items.length)await command(['stack','destroy','--yes','--output-format','json'],90000);
    }
    result.cleanup=true;
  }catch{result.cleanup=false;exitCode=1;console.error('FAIL: disposable cleanup failed');}
  if(result.cleanup)await fs.rm(temp,{recursive:true,force:true});
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(`Native owner password cases: ${result.cases.length}; passed=${result.passed}; cleanup=${result.cleanup}`);
  process.exitCode=exitCode;
}
