// Service-free checks for the generated, isolated, synthetic review artifact.
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateDemo,sourceProvenance} from '../employee-review/build-demo.mjs';
import {fixtures} from '../employee-review/fixtures.mjs';
const dir=new URL('../employee-review/',import.meta.url);
const html=await readFile(new URL('index.html',dir),'utf8'),runtime=await readFile(new URL('demo-runtime.js',dir),'utf8'),manifest=JSON.parse(await readFile(new URL('manifest.json',dir),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const encoded=html.match(/\bsrcdoc="([^"]*)"/s)?.[1];assert.ok(encoded,'Generated srcdoc missing');
const child=encoded.replaceAll('&gt;','>').replaceAll('&lt;','<').replaceAll('&quot;','"').replaceAll('&amp;','&');
const outer=html.replace(encoded,'SYNTHETIC_EMBEDDED_DOCUMENT');
function client(){const context={};vm.runInNewContext('const DEMO_FIXTURES='+JSON.stringify(fixtures)+';'+runtime.slice(0,runtime.indexOf('function demoNoSave'))+';globalThis.client=createDemoClient();globalThis.denials=()=>demoDeniedMutationCount;',context);return context}
test('generated artifact and inputs match the pinned reviewed-source manifest',async()=>{
 assert.deepEqual(manifest.source,sourceProvenance);assert.equal(manifest.source.tree,'22abcd0362df23faa8e2fdf376ab785c220e64c2');
 assert.equal(sha(html),manifest.indexSha256);assert.equal(sha(child),manifest.childSha256);assert.equal(sha(runtime),manifest.runtimeSha256);
 assert.equal(sha(await readFile(new URL('fixtures.mjs',dir))),manifest.fixturesSha256);assert.equal(sha(await readFile(new URL('build-demo.mjs',dir))),manifest.builderSha256);
 await assert.rejects(()=>generateDemo('<html>unreviewed source</html>'),/Reviewed source hash mismatch/);
});
test('only a script-enabled opaque srcdoc frame exists, with no unsandboxed child HTML',async()=>{
 assert.equal((outer.match(/<iframe\b/g)||[]).length,1);assert.equal((outer.match(/<script\b/g)||[]).length,0);
 assert.match(outer,/id="employeeReviewFrame"/);assert.match(outer,/sandbox="allow-scripts"/);assert.match(outer,/referrerpolicy="no-referrer"/);
 assert.doesNotMatch(outer,/allow-same-origin|allow-forms|allow-popups|allow-downloads|allow-top-navigation|\bsrc=/);
 assert.deepEqual((await readdir(dir)).filter(x=>x.endsWith('.html')),['index.html']);
});
test('parent and child deny network, forms, framing and base changes before app execution',()=>{
 for(const page of [outer,child]){
  const policy=page.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1];assert.ok(policy);
  for(const directive of ['default-src','connect-src','frame-src','form-action','base-uri','object-src'])assert.match(policy,new RegExp(directive+" 'none'"));
  assert.ok(page.indexOf('Content-Security-Policy')<page.indexOf('<script>')||!page.includes('<script>'));
 }
});
test('generated child contains no live client, identity, persistence, URL or message bridge',()=>{
 assert.doesNotMatch(child,/<script\b[^>]*\bsrc=|SUPABASE_URL|SUPABASE_ANON_KEY|SUPERIOR_CONFIG|createClient\(|INVENTORY_SEED|INVENTORY_REVIEW_MODE|localStorage|sessionStorage|indexedDB|document\.cookie|\.auth\.|postMessage|window\.(?:parent|top)|bootstrap\(/i);
 assert.doesNotMatch(child,/https?:\/\/|wss?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|Lance Thompson|Wes Borgen|review@/i);
 assert.doesNotMatch(child,/<meta[^>]+http-equiv="refresh"|\s(?:href|src|srcset|action|formaction)="/i);
 assert.match(child,/DEMO — SAMPLE DATA ONLY/);assert.match(child,/No live connections · No saves · No account changes/);
});
test('embedded scripts parse without evaluating application or any service',()=>{let count=0;for(const m of child.matchAll(/<script>([\s\S]*?)<\/script>/g)){new vm.Script(m[1]);count++}assert.equal(count,2)});
const reads=[
 ['get_walls_production_snapshot',{p_from:'2026-10-26',p_to:'2026-10-30'}],
 ['get_walls_production_weekly_forecast',{p_week_start:'2026-10-26'}],
 ['get_inventory_scopes',{}],
 ['get_inventory_snapshot',{p_division_key:'walls',p_inventory_area:'production'}],
 ['get_employee_approved_crew_packs',{p_week_start:'2026-10-26'}]
];
for(const [name,args] of reads)test('synthetic read allowlist: '+name,async()=>{
 const c=client(),a=await c.client.rpc(name,args);assert.equal(a.error,null);assert.ok(a.data);assert.equal(c.denials(),0);
 if(Array.isArray(a.data))a.data.length=0;else for(const key of Object.keys(a.data))delete a.data[key];
 const b=await c.client.rpc(name,args);assert.ok(Array.isArray(b.data)?b.data.length:Object.keys(b.data).length,'Returned values share mutable fixture state');
});
for(const name of ['get_schedule_snapshot','get_app_access','get_weekly_planner_snapshot','set_inventory_count','adjust_inventory_quantity','save_schedule_snapshot','publish_weekly_planner_pack'])test('unknown/broad/mutating RPC fails closed: '+name,async()=>{
 const c=client();await assert.rejects(()=>c.client.rpc(name,{}),/allowlisted synthetic reads/);assert.equal(c.denials(),1);
});
test('raw tables, auth, Edge Functions, storage and Realtime cannot initialize',()=>{
 const c=client();for(const call of [()=>c.client.from('inventory_items'),()=>c.client.auth.getSession(),()=>c.client.functions.invoke('operations-agent'),()=>c.client.storage.from('files'),()=>c.client.channel('real')])assert.throws(call,/allowlisted synthetic reads/);
 assert.equal(c.denials(),5);
});
test('wrong inventory division and malformed required synthetic read arguments fail closed',async()=>{
 const c=client();for(const [name,args]of [['get_inventory_snapshot',{p_division_key:'boxes',p_inventory_area:'production'}],['get_walls_production_snapshot',{}],['get_walls_production_weekly_forecast',{}],['get_employee_approved_crew_packs',{}]])await assert.rejects(()=>c.client.rpc(name,args));
});
test('demo writer guards and count-form save disabling are explicit',()=>{
 assert.match(runtime,/inventoryRpc=wallsProductionRpc=wallsInstallationRpc=saveOperationalModal=async\(\)=>demoNoSave/);
 assert.match(runtime,/updateInventoryQuantity=async\(\)=>demoNoSave/);assert.match(runtime,/inventoryModalSaveAction=null/);
 assert.match(runtime,/save\.disabled=true/);assert.match(runtime,/data-inv-action="minus"/);assert.match(runtime,/data-inv-action="plus"/);
 assert.match(runtime,/saveUiPrefs=\(\)=>\{\}/);assert.match(runtime,/persistState=async\(\)=>false/);
});
test('mobile presentation provenance is separate from the pinned reviewed source',async()=>{
 const patch=manifest.presentationPatch;assert.ok(patch);assert.match(patch.scope,/demo.only.*1000px/i);assert.match(patch.scope,/not an unchanged/i);
 assert.equal(patch.script,'mobile-presentation.js');assert.equal(patch.style,'mobile-presentation.css');
 assert.equal(sha(await readFile(new URL(patch.script,dir))),patch.scriptSha256);
 assert.equal(sha(await readFile(new URL(patch.style,dir))),patch.styleSha256);
 assert.match(child,/<details id="employeeDemoBanner" open><summary id="employeeDemoBannerSummary"/);
 assert.match(child,/No live connections · No saves<\/span><\/summary>/);
});
test('mobile polish is employee-only and does not initialize a data, auth or persistence path',async()=>{
 const code=await readFile(new URL('mobile-presentation.js',dir),'utf8');
 assert.doesNotMatch(code,/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|postMessage)\b|document\.cookie|\bsb\.|\.rpc\(|\.auth\.|https?:\/\//);
 const gate=code.slice(0,code.indexOf('function employeeMobileDisclosure'));
 for(const [mobile,admin,expected]of [[true,false,true],[true,true,false],[false,false,false],[false,true,false]]){
  const context={window:{matchMedia:query=>{assert.equal(query,'(max-width:1000px)');return {matches:mobile}}},currentUserIsAdmin:admin};
  vm.runInNewContext(gate+';globalThis.result=employeeMobilePresentationActive()',context);assert.equal(context.result,expected);
 }
});
test('mobile disclosures use native accessible details and move existing nodes rather than duplicate controls',async()=>{
 const code=await readFile(new URL('mobile-presentation.js',dir),'utf8');
 const factory=code.slice(code.indexOf('function employeeMobileDisclosure'),code.indexOf('function employeeMobileProductionPresentation'));
 const node=tag=>({tag,children:[],append(...children){this.children.push(...children)}}),existing=[node('existing-work')];
 const context={document:{createElement:node},existing};vm.runInNewContext(factory+';globalThis.result=employeeMobileDisclosure("totals","Production totals",existing)',context);
 assert.equal(context.result.tag,'details');assert.equal(context.result.children[0].tag,'summary');assert.equal(context.result.children[0].textContent,'Production totals');
 assert.equal(context.result.children[1].children[0],existing[0]);assert.equal(context.result.open,undefined);
});
