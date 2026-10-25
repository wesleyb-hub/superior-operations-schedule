// Synthetic offline DOM checks: in-memory service adapter only; no database, business records, or network access.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {recordIdDomChecks} from './record-id-dom-checks.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=resolve(import.meta.dirname,'..');
const source=await readFile(resolve(root,'index.html'),'utf8');
const html=source.replace(/<script src="[^"]+"><\/script>/g,'');
const output=resolve(process.argv[2]||'artifacts/render-safety-ui');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
const results=[];
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  // Keep fixed synthetic audit records in the same operational week on every run.
  await page.clock.setFixedTime(new Date('2026-10-21T12:00:00Z'));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url()==='http://offline.test/'?route.fulfill({contentType:'text/html',body:html}):route.abort());
  await page.addInitScript(()=>{
   window.syntheticWrites=[];
   window.SUPERIOR_CONFIG={supabaseUrl:'https://offline.test',supabaseAnonKey:'synthetic-only'};
   window.supabase={createClient:()=>({auth:{onAuthStateChange(){},async getSession(){return {data:{session:null}}}},async rpc(name,args){
    if(name!=='save_schedule_snapshot')throw new Error('Unexpected synthetic RPC: '+name);
    window.syntheticWrites.push(structuredClone(args));
    return {data:{revision:args.p_expected_revision+1,payload:{schemaVersion:35,data:structuredClone(args.p_snapshot)}}};
   }})};
  });
  await page.goto('http://offline.test/');
  await page.evaluate(()=>{currentUserIsAdmin=true;currentUserAuthorized=true;showAuthGate(false);window.syntheticExecutions=0;window.synthetic=()=>window.syntheticExecutions++});
  const payload='<img src=x onerror="synthetic()">',header='customer" autofocus onfocus="synthetic()';
  await page.evaluate(({payload,header})=>{
   renderImport();importHeaders=[header];importData=[{[header]:payload}];renderImportPreview();
  },{payload,header});
  assert.equal(await page.locator('#importPreview img').count(),0);
  assert.equal(await page.locator('#importPreview th').textContent(),header);
  assert.equal(await page.locator('#importPreview td').textContent(),payload);
  await page.locator('[data-map="customer"]').selectOption({label:header});
  assert.equal(await page.locator('[data-map="customer"]').inputValue(),header);
  assert.equal(await page.locator('#importPreview [autofocus],#importPreview [onfocus],#importPreview [onerror]').count(),0);
  await page.screenshot({path:resolve(output,width+'-import.png'),fullPage:true});
  await page.evaluate(payload=>{
   state.walls=[];state.jobs=[];state.reportMonth='2026-10';state.billingDivision='all';state.billingStatus='all';
   state.billing=[{key:'wall:" onmouseover="synthetic()',division:'walls',project:payload,customer:payload,qty:120,unit:'LF',status:'Billed',invoice:payload,invoiceDate:'2026-10-20',billableMonth:'2026-10'}];renderBilling();
  },payload);
  assert.equal(await page.locator('#view img,#view [onmouseover]').count(),0);
  assert.match(await page.locator('#view').textContent(),/Source completion needs review/);
  assert.equal(await page.locator('[data-bhold]').getAttribute('data-bhold'),'wall:" onmouseover="synthetic()');
  assert.equal(await page.evaluate(()=>state.billing.length),1);
  assert.equal(await page.locator('tbody strong').textContent(),payload);
  await page.screenshot({path:resolve(output,width+'-billing.png'),fullPage:true});
  await page.evaluate(payload=>{
   state.walls=[{id:'synthetic" onmouseover="synthetic()',job:payload,project:payload,type:payload}];state.jobs=[];state.searchQuery='<img';renderSearchResults();
  },payload);
  assert.equal(await page.locator('#view img,#view [onmouseover]').count(),0);
  assert.equal(await page.locator('.project-name').textContent(),payload);
  assert.equal(await page.locator('[data-open-result]').getAttribute('data-open-result'),'synthetic" onmouseover="synthetic()');
  await page.screenshot({path:resolve(output,width+'-search.png'),fullPage:true});
  await page.evaluate(payload=>{
   state.jobs=[{id:'synthetic" onmouseover="synthetic()',division:'boxes',completedDate:'2026-10-20',name:payload,customer:payload,type:payload,total:1}];renderPrecastMonthly('boxes');
  },payload);
  assert.equal(await page.locator('#view img,#view [onmouseover]').count(),0);
  assert.equal(await page.locator('tbody [data-project]').textContent(),payload);
  await page.screenshot({path:resolve(output,width+'-monthly.png'),fullPage:true});
  const literal='Synthetic & "quotes" \' <img src=x onerror="synthetic()">';
  const id='synthetic|record" onmouseover="synthetic()';
  await page.evaluate(({literal,id})=>{
   state.week='2026-10-19';state.year=2026;state.reportMonth='2026-10';state.subview={walls:'current',boxes:'current'};
   state.walls=[{id,job:literal,type:literal,project:literal,customer:literal,development:literal,address:literal,source:literal,saleType:literal,constraint:literal,notes:literal,units:1,lf:120,lfByHeight:{h8:120},digDate:'2026-10-19',productionDate:'2026-10-20',installDate:'2026-10-21',links:['javascript:synthetic()'],planReview:{notes:literal,trackerStatus:literal,stages:{}}}];
   state.jobs=[{id,name:literal,type:literal,customer:literal,status:literal,constraint:literal,division:'boxes',total:1,dailyRate:1,products:[{id,label:literal,structureId:literal,pieceType:literal,pieceSize:literal,pieceNotes:literal,status:'scheduled',qty:1,plannedDate:'2026-10-20',isSpecial:true,productionDays:1}],links:[]}];
  },{literal,id});
  const views=['walls-current','walls-active','walls-plans','walls-overall','walls-year','walls-monthly','precast-current','precast-overall','precast-year','precast-monthly','overview','qc','delivery','audit','history'];
  for(const view of views){
   await page.evaluate(view=>{
    state.walls[0].completedMonth=view==='walls-monthly'?'2026-10':'';state.jobs[0].completedDate=view==='precast-monthly'?'2026-10-21':'';
    if(view==='walls-current')renderWalls();else if(view==='walls-active')renderWallsActive();else if(view==='walls-plans')renderWallsPlanReview();else if(view==='walls-overall')renderWallsOverall();else if(view==='walls-year')renderWallsYearOutlook();else if(view==='walls-monthly')renderWallsMonthly();
    else if(view==='precast-current')renderPrecast('boxes');else if(view==='precast-overall')renderPrecastOverall('boxes');else if(view==='precast-year')renderPrecastYearOutlook('boxes');else if(view==='precast-monthly')renderPrecastMonthly('boxes');
    else {
     const text=state.jobs[0].name;state.jobs[0].products[0].status='hold';state.walls[0].productionDate='';
     state.loads=[{id:'synthetic-load',division:'walls',project:text,load:text,status:'Scheduled',date:state.week,qty:1}];
     state.audit=[{date:state.week,weekKey:state.week,type:text,user:text,detail:text}];state.qcHistory=[{date:state.week,weekKey:state.week,product:text,project:text,action:text,user:text}];state.deliveryHistory=[{date:state.week,division:'walls',project:text,load:text,qty:1}];
     if(view==='overview')renderOverview();else if(view==='qc')renderQC();else if(view==='delivery')renderDelivery();else if(view==='audit')renderAudit();else renderHistory();
    }
   },view);
   assert.equal(await page.locator('#view img,#view [onmouseover],#view [onerror]').count(),0,view);
   assert.ok((await page.locator('#view').textContent()).includes(literal),view+' preserves literal text');
   if(view==='walls-year')assert.ok((await page.locator('.year-bar').getAttribute('title')).includes(literal),'tooltip text round-trips once');
   if(['walls-plans','walls-overall','precast-current'].includes(view))await page.screenshot({path:resolve(output,width+'-'+view+'.png'),fullPage:true});
  }
  // Exercise actual Open handler with an ID containing the old delimiter and quotes.
  await page.evaluate(()=>{state.searchQuery='Synthetic';renderSearchResults()});
  await page.locator('[data-open-result]').first().click();
  await page.waitForFunction(()=>document.getElementById('wallModal').style.display==='flex');
  assert.equal(await page.locator('#wJob').inputValue(),literal);
  await page.evaluate(()=>closeModal('wallModal'));
  const identityChecks=await recordIdDomChecks(page);
  const persistence=await page.evaluate(async()=>{
   currentUser={id:'synthetic-user',email:'synthetic@example.test'};currentUserCanWrite=true;remoteReady=true;structuredBackendReady=true;lastRemoteData=null;lastSharedJson='';
   state.walls=[];state.jobs=[];state.loads=[];state.deliveryHistory=[];state.audit=[];state.qcHistory=[];
   const row={key:'wall:removed-source',division:'walls',project:'Synthetic invoice',customer:'Synthetic customer',qty:120,unit:'LF',status:'Billed',invoice:'TEST-INVOICE',invoiceDate:'2026-10-21',billableDate:'2026-10-20',billableMonth:'2026-10',notes:'Retain original history'};
   state.billing=[structuredClone(row)];renderBilling();
   const saved=await persistState('Synthetic unrelated change');const snapshot=window.syntheticWrites.at(-1).p_snapshot;
   state.billing=[];await applyRemoteRow({revision:lastRevision,payload:{schemaVersion:35,data:snapshot}},'Synthetic reload');renderBilling();
   currentUser=null;remoteReady=false;return {saved,row,rows:state.billing,writes:window.syntheticWrites.length};
  });
  assert.equal(persistence.saved,true);assert.equal(persistence.writes,1);assert.deepEqual(persistence.rows,[persistence.row]);
  assert.match(await page.locator('#view').textContent(),/Source completion needs review/);
  await page.evaluate(()=>{
   document.getElementById('view').innerHTML=linkListHtml(['javascript:synthetic()','data:text/html,test','https://example.test/doc?q=1&x=2'])+productionDocumentLink({documentLinks:['javascript:synthetic()']});
  });
  assert.equal(await page.locator('#view a').count(),1);
  assert.equal(await page.locator('#view a').getAttribute('href'),'https://example.test/doc?q=1&x=2');
  assert.equal(await page.evaluate(()=>window.syntheticExecutions),0);assert.deepEqual(errors,[]);
  results.push({width,identityChecks,checks:['import text and attribute roundtrip','billing history and source warning','search text and identity','monthly completion text','document URL allowlist','15 populated wall/precast/downstream views','search Open identity roundtrip','actual save/reload invoice snapshot'],passed:true});
  await page.close();
 }
 await writeFile(resolve(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close()}
