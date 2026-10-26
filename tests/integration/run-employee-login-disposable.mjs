// Starts and destroys a fresh local-only PostgreSQL cluster. Never connects to Supabase.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { runEmployeeLoginTests } from './employee-login.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const output=path.join(root,'artifacts/employee-login/database');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'superior-employee-login-'));
const reservation=net.createServer();
const port=await new Promise((resolve,reject)=>{
  reservation.once('error',reject);
  reservation.listen(0,'127.0.0.1',()=>{const address=reservation.address();reservation.close(error=>error?reject(error):resolve(address.port));});
});
const password=randomUUID();
const cluster=new EmbeddedPostgres({
  databaseDir:path.join(temporary,'data'),user:'postgres',password,port,persistent:false,
  postgresFlags:['-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='],
  onLog:()=>{},onError:()=>{},
});
let client;
const log=[];
const report=message=>{log.push(message);console.log(message);};
const readSql=async relative=>(await fs.readFile(path.join(root,relative),'utf8')).replace(/^\\.*$/gm,'');
try{
  await fs.mkdir(output,{recursive:true});
  await cluster.initialise();await cluster.start();await cluster.createDatabase('superior_workflow_test');
  client=cluster.getPgClient('superior_workflow_test','127.0.0.1');await client.connect();
  const version=(await client.query('show server_version')).rows[0].server_version;
  await client.query(await readSql('tests/integration/baseline.sql'));
  const migrations=(await fs.readdir(path.join(root,'supabase/migrations'))).filter(name=>name.endsWith('.sql')).sort();
  for(const name of migrations)await client.query(await readSql(`supabase/migrations/${name}`));
  report(`PASS: ${migrations.length} actual repository migrations applied to fresh loopback PostgreSQL ${version}`);
  const probes=['tests/integration/walls-workflow-cases.sql','tests/integration/probes/employee-data-scope.sql','tests/integration/probes/employee-approved-crew-packs.sql'];
  for(const probe of probes){await client.query(await readSql(probe));report(`PASS: ${probe}`);}
  const result=await runEmployeeLoginTests({Client:pg.Client,connection:{host:'127.0.0.1',port,database:'superior_workflow_test',user:'postgres',password}});
  result.postgres=version;result.migrations=migrations.length;result.businessProbes=probes;
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
  log.push(...result.cases.map(label=>`PASS: ${label}`));
  report(`PASS: ${result.passed} managed-login database cases; no native Auth/hosted verification claimed`);
}catch(error){
  report(`FAIL: ${error instanceof Error?error.message:String(error)}`);
  process.exitCode=1;
}finally{
  if(client)await client.end();
  await cluster.stop().catch(()=>{});
  await fs.rm(temporary,{recursive:true,force:true});
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'result.log'),log.join('\n')+'\n');
}
