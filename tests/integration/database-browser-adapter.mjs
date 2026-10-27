// Disposable integration harness ONLY. Never deployed or pointed at Supabase.
// Replaces transport/Auth/Realtime providers, NOT application RPCs or RLS.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import assert from 'node:assert/strict';
const ident=x=>{assert.match(x,/^[a-z_][a-z0-9_]*$/);return '"'+x+'"'};
export const identities={
 reader:{id:'00000000-0000-4000-8000-000000000119',email:'test-hub-reader@superiorwallsnd.com'},
 admin:{id:'00000000-0000-4000-8000-000000000001',email:'test-admin@superiorwallsnd.com'},
 viewer:{id:'00000000-0000-4000-8000-000000000002',email:'test-viewer@superiorwallsnd.com'},
 outsider:{id:'00000000-0000-4000-8000-000000000003',email:'test-outsider@superiorwallsnd.com'},
};
export async function startHarness(){
 assert.equal(process.env.PGHOST,'127.0.0.1','Only loopback disposable PostgreSQL is permitted');
 assert.equal(process.env.PGDATABASE,'superior_workflow_test','Never use a business database');
 const pool=new Pool({max:6});
 const catalog=await pool.query(`select p.proname, p.proargnames, p.proargtypes::oid[] as oids,
 array(select format_type(t,null) from unnest(p.proargtypes::oid[]) t) as types
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'`);
 const functions=new Map(catalog.rows.map(r=>[r.proname,r]));
 const calls=[];
 async function transact(identity,action){
  const client=await pool.connect();try{
   await client.query('begin');await client.query('set local role '+(identity?'authenticated':'anon'));
   await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(identity?{sub:identity.id,email:identity.email,role:'authenticated'}:{role:'anon'})]);
   const value=await action(client);await client.query('commit');return {data:value,error:null};
  }catch(error){await client.query('rollback');return {data:null,error:{code:error.code,message:error.message}}}finally{client.release()}
 }
 async function rpc(identity,name,args={}){
  const f=functions.get(name);assert.ok(f,'Known public SQL function required: '+name);
  const keys=Object.keys(args);keys.forEach(k=>assert.ok(f.proargnames?.includes(k),'Unknown RPC parameter '+k));
  const parameters=keys.map((k,i)=>ident(k)+' => $'+(i+1)+'::'+f.types[f.proargnames.indexOf(k)]).join(',');
  const values=keys.map(k=>{const type=f.types[f.proargnames.indexOf(k)],v=args[k];return /jsonb?/.test(type)&&v!==null?JSON.stringify(v):v});
  const start=Date.now();const result=await transact(identity,async c=>(await c.query(`select public.${ident(name)}(${parameters}) as value`,values)).rows[0]?.value);
  calls.push({name,identity:identity?.email||'anonymous',durationMs:Date.now()-start,error:result.error});return result;
 }
 const tables=new Set(['schedule_settings','schedule_state','inventory_items','inventory_events','walls_installation_activity_assignments','walls_installation_resources','walls_installation_events','weekly_planner_section_people','weekly_planner_availability']);
 async function query(identity,q){
  assert.ok(tables.has(q.table),'Test adapter only allows known frontend read tables');
  let sql='select '+q.columns.split(',').map(ident).join(',')+' from public.'+ident(q.table),values=[];
  const filters=(q.filters||[]).map(f=>{
   const col=ident(f[1]);if(f[0]==='not'&&f[2]==='is'&&f[3]===null)return col+' is not null';
   if(f[0]==='eq'){values.push(f[2]);return col+' = $'+values.length}
   if(f[0]==='in'){values.push(f[2]);return col+' = any($'+values.length+')'}
   throw Error('Unsupported test query filter');
  });if(filters.length)sql+=' where '+filters.join(' and ');
  if(q.order)sql+=' order by '+ident(q.order[0])+(q.order[1]?.ascending===false?' desc':' asc');
  if(q.limit!==undefined){assert.ok(Number.isInteger(q.limit)&&q.limit>=0&&q.limit<=1000);sql+=' limit '+q.limit}
  return transact(identity,async c=>{const rows=(await c.query(sql,values)).rows;return q.single?rows[0]||null:rows});
 }
 const src=await readFile(new URL('../../index.html',import.meta.url),'utf8');
 const shim=await readFile(new URL('./synthetic-auth-transport.js',import.meta.url),'utf8');
 const html=src.replace(/<script src="[^"]+"><\/script>/g,'').replace('<head>','<head><script>'+shim+'</script>');
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.method==='GET'){res.setHeader('Content-Type','text/html');res.end(html);return}
   let body='';for await(const chunk of req)body+=chunk;assert.ok(body.length<2000000);const x=JSON.parse(body);
   const identity=identities[req.headers['x-test-identity']]||null;
   const result=req.url==='/rpc'?await rpc(identity,x.name,x.args):await query(identity,x);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(error){res.statusCode=500;res.end(JSON.stringify({error:{message:error.message}}))}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:'http://127.0.0.1:'+server.address().port,rpc,calls,pool,close:async()=>{await new Promise(r=>server.close(r));await pool.end()}};
}
