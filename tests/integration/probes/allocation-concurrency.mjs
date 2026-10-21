/** Actual two-transaction PostgreSQL regression; disposable DB only. */
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const {Client}=pg;
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'superior_workflow_test');
const claims=JSON.stringify({sub:'00000000-0000-4000-8000-000000000001',email:'test-admin@superiorwallsnd.com',role:'authenticated'});
const clients=await Promise.all([0,1,2].map(async()=>{const c=new Client();await c.connect();await c.query('set role authenticated');await c.query("select set_config('request.jwt.claims',$1,false)",[claims]);return c;}));
const [setup,first,second]=clients;
const suffix=randomUUID();
const jobId=`TEST-CONCURRENT-LF-${suffix}`;
const tableIds=[`TEST-CONCURRENT-A-${suffix}`,`TEST-CONCURRENT-B-${suffix}`];
try{
 await setup.query("select test_workflow.patch('walls',$1,$2::jsonb)",[jobId,JSON.stringify({job:jobId,lf:100,lfByHeight:{h8:100}})]);
 for(const id of tableIds)await setup.query('select public.upsert_walls_production_table($1,$1,100,true)',[id]);
 const assignment=`select public.upsert_walls_production_assignment(null,$1,$2,8,60,'2026-11-09 07:00','2026-11-09 15:00','2026-11-10 07:00','TEST concurrent allocation')`;
 const firstPid=(await first.query('select pg_backend_pid() pid')).rows[0].pid;
 const secondPid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
 await first.query('begin');await second.query('begin');
 await first.query(assignment,[jobId,tableIds[0]]);
 let outcome;
 const pending=second.query(assignment,[jobId,tableIds[1]]).then(()=>outcome='accepted',error=>outcome=error.message);
 // Deterministic barrier: unfixed code finishes the second allocation; corrected
 // code blocks it behind the first transaction's target-job advisory lock.
 // Never commit merely because an arbitrary delay elapsed (which could hide a race).
 const deadline=Date.now()+10000;
 while(outcome===undefined){
  const {rows:[{blocked}]}=await setup.query('select $1::integer = any(pg_blocking_pids($2::integer)) as blocked',[firstPid,secondPid]);
  if(blocked)break;
  assert(Date.now()<deadline,'second allocation neither completed nor blocked behind first within 10s');
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 await first.query('commit');await pending;
 if(outcome==='accepted')await second.query('commit');else await second.query('rollback');
 const {rows:[{total}]}=await setup.query("select sum(planned_lf)::numeric as total from public.walls_production_assignments where wall_record_id=$1 and stage<>'cancelled'",[jobId]);
 assert(Number(total)<=100,`Concurrent allocations exceeded authoritative 100 LF: ${total} LF (second transaction ${outcome})`);
 assert.match(outcome,/exceed.*authoritative.*linear footage/i);
 console.log('PASS: concurrent assignments cannot exceed authoritative LF; losing transaction rejected');
}finally{
 await Promise.all(clients.map(async c=>{try{await c.query('rollback');}catch{}await c.end();}));
}
