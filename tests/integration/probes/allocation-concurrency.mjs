/** Actual two-transaction PostgreSQL regression; disposable DB only. */
import pg from 'pg';
import assert from 'node:assert/strict';
const {Client}=pg;
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'superior_workflow_test');
const claims=JSON.stringify({sub:'00000000-0000-4000-8000-000000000001',email:'test-admin@superiorwallsnd.com',role:'authenticated'});
const clients=await Promise.all([0,1,2].map(async()=>{const c=new Client();await c.connect();await c.query('set role authenticated');await c.query("select set_config('request.jwt.claims',$1,false)",[claims]);return c;}));
const [setup,first,second]=clients;
try{
 await setup.query(`select test_workflow.patch('walls','TEST-CONCURRENT-LF','{"job":"TEST-CONCURRENT-LF","lf":100,"lfByHeight":{"h8":100}}')`);
 for(const id of ['TEST-CONCURRENT-A','TEST-CONCURRENT-B'])await setup.query('select public.upsert_walls_production_table($1,$1,100,true)',[id]);
 const assignment=`select public.upsert_walls_production_assignment(null,'TEST-CONCURRENT-LF',$1,8,60,'2026-11-09 07:00','2026-11-09 15:00','2026-11-10 07:00','TEST concurrent allocation')`;
 await first.query('begin');await second.query('begin');
 await first.query(assignment,['TEST-CONCURRENT-A']);
 let outcome;
 const pending=second.query(assignment,['TEST-CONCURRENT-B']).then(()=>outcome='accepted',error=>outcome=error.message);
 // On corrected code the second insert waits for parent-job lock until commit.
 await new Promise(resolve=>setTimeout(resolve,300));
 await first.query('commit');await pending;
 if(outcome==='accepted')await second.query('commit');else await second.query('rollback');
 const {rows:[{total}]}=await setup.query("select sum(planned_lf)::numeric as total from public.walls_production_assignments where wall_record_id='TEST-CONCURRENT-LF' and stage<>'cancelled'");
 assert(Number(total)<=100,`Concurrent allocations exceeded authoritative 100 LF: ${total} LF (second transaction ${outcome})`);
 assert.match(outcome,/exceed.*authoritative.*linear footage/i);
 console.log('PASS: concurrent assignments cannot exceed authoritative LF; losing transaction rejected');
}finally{
 await Promise.all(clients.map(async c=>{try{await c.query('rollback');}catch{}await c.end();}));
}
