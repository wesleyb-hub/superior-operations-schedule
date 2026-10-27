// Disposable PostgreSQL only. Uses installed dependencies; never launches native Auth.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {runPasswordDatabaseTests} from './test-database.mjs';
const require=createRequire(import.meta.url);
const {default:EmbeddedPostgres}=await import(require.resolve('embedded-postgres'));
const {Client}=require('pg');
const root=path.resolve(import.meta.dirname,'../..');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'superior-owner-password-'));
const server=net.createServer();
const port=await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();server.close(error=>error?reject(error):resolve(address.port));});});
const password=randomUUID();
const cluster=new EmbeddedPostgres({databaseDir:path.join(temporary,'data'),user:'postgres',password,port,persistent:false,
  postgresFlags:['-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='],onLog:()=>{},onError:()=>{}});
const config={host:'127.0.0.1',port,user:'postgres',password,database:'superior_workflow_test'};
const out=path.join(root,'artifacts/employee-owner-password/database');
let client;const log=[];const report=value=>{log.push(value);console.log(value);};
const readSql=async relative=>(await fs.readFile(path.join(root,relative),'utf8')).replace(/^\\.*$/gm,'');
try{
  await cluster.initialise();await cluster.start();await cluster.createDatabase(config.database);
  client=new Client(config);await client.connect();
  await client.query(await readSql('tests/integration/baseline.sql'));
  // Minimal native-read compatibility fixture, NOT GoTrue and never a production migration.
  await client.query(`alter table auth.users add column is_anonymous boolean not null default false,
    add column is_sso_user boolean not null default false,add column email_confirmed_at timestamptz,
    add column last_sign_in_at timestamptz,add column recovery_sent_at timestamptz,add column deleted_at timestamptz,
    add column banned_until timestamptz,add column email_change text default '',
    add column raw_app_meta_data jsonb not null default '{"provider":"email","providers":["email"]}';
    create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete cascade,provider text not null,identity_data jsonb not null);
    create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete cascade);`);
  const migrations=(await fs.readdir(path.join(root,'supabase/migrations'))).filter(x=>x.endsWith('.sql')).sort();
  for(const file of migrations)await client.query(await readSql(`supabase/migrations/${file}`));
  const version=(await client.query('show server_version')).rows[0].server_version;
  report(`PASS: ${migrations.length} exact migrations applied on fresh loopback PostgreSQL ${version}`);
  const result=await runPasswordDatabaseTests({Client,config,report});
  for(const file of ['tests/integration/walls-workflow-cases.sql','tests/integration/probes/employee-data-scope.sql','tests/integration/probes/employee-approved-crew-packs.sql']){
    await client.query(await readSql(file));report(`PASS: unchanged ${file}`);
  }
  await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({...result,postgres:version,migrations:migrations.length,nativeAuthVerified:false,hostedVerified:false},null,2)+'\n');
}catch(error){report(`FAIL: ${error?.message||'Database test failed'}`);console.error(error?.stack);process.exitCode=1;}
finally{
  if(client)await client.end();await cluster.stop().catch(()=>{});await fs.rm(temporary,{recursive:true,force:true});
  await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'result.log'),log.join('\n')+'\n');
}
