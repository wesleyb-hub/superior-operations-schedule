// Synthetic preview QA. No real identity, token, business record or hosted service.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=resolve(import.meta.dirname,'..'),html=await readFile(resolve(root,'employee-review/index.html'));
const output=process.argv[2];if(output)await mkdir(output,{recursive:true});
const requests=[],upgrades=[],unexpected=[],results=[],failures=[],pageErrors=[];
const server=createServer((req,res)=>{
 requests.push(req.url);
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');
 if(req.url==='/employee-review/'||req.url==='/employee-review/index.html'){res.end(html);return}
 if(req.url==='/seed'){res.end('<!doctype html><title>Synthetic storage setup</title>');return}
 res.statusCode=404;res.end('No service endpoint exists');
});
server.on('upgrade',(req,socket)=>{upgrades.push(req.url);socket.destroy()});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const sentinel='SYNTHETIC-PRIVATE-SESSION-SENTINEL';
async function check(name,run){try{const detail=await run();results.push({name,passed:true,...(detail||{})})}catch(error){failures.push({name,message:error.stack||String(error)})}}
async function frameFor(page){const el=await page.locator('#employeeReviewFrame').elementHandle();const frame=await el.contentFrame();await frame.locator('#employeeDemoBanner').waitFor();await frame.waitForFunction(()=>inventoryReady&&wallsProductionReady&&!inventoryLoadError&&!wallsProductionError);return frame}
async function resetDemo(frame){
 const details=frame.locator('#employeeDemoBanner');if(await details.count()&&!await details.evaluate(el=>el.open))await details.locator('summary').click();
 await frame.locator('#employeeDemoReset').click();await frame.waitForFunction(()=>state.view==='today');
}
async function screenshot(page,label){if(output)await page.screenshot({path:resolve(output,`${label}.png`),fullPage:false})}
async function navigate(frame,width,view){if(width<=1000&&!await frame.locator('#operationsSidebar').evaluate(el=>el.classList.contains('open')))await frame.locator('#operationsNavMenu').click();await frame.locator(`#operationsSidebar [data-view="${view}"]`).click();await frame.waitForFunction(view=>state.view===view,view)}
try{
 for(const viewport of [{width:360,height:800},{width:390,height:844},{width:844,height:390},{width:1440,height:1000}]){
  const {width,height}=viewport,label=`${width}x${height}`;
  const context=await browser.newContext({viewport,hasTouch:width<=1000});
  await context.addCookies([{name:'synthetic_hub_session',value:sentinel,url:origin}]);
  await context.route('**/*',route=>{
   const u=route.request().url();if([origin+'/seed',origin+'/employee-review/',origin+'/employee-review/index.html'].includes(u))return route.continue();
   unexpected.push({viewport:label,url:u,method:route.request().method()});return route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>pageErrors.push({viewport:label,message:e.message}));
  page.on('dialog',d=>d.dismiss());
  await page.goto(origin+'/seed');await page.evaluate(s=>{localStorage.setItem('sb-synthetic-auth-token',s);localStorage.setItem('superior-operations-ui-v28',JSON.stringify({private:s}));sessionStorage.setItem('synthetic_hub_session',s)},sentinel);
  await page.goto(origin+'/employee-review/');let frame=await frameFor(page);
  await check(label+'-opaque-origin-and-storage-isolation',async()=>{
   assert.equal(await page.locator('#employeeReviewFrame').getAttribute('sandbox'),'allow-scripts');
   const proof=await frame.evaluate(async()=>{
    const read=fn=>{try{return {value:fn()}}catch(e){return {error:e.name}}};
    let cache;try{await caches.open('synthetic-isolation-probe');cache={value:'opened'}}catch(e){cache={error:e.name}}
    return {origin:self.origin,local:read(()=>localStorage.getItem('sb-synthetic-auth-token')),session:read(()=>sessionStorage.getItem('synthetic_hub_session')),cookie:read(()=>document.cookie),indexedDb:read(()=>indexedDB.open('synthetic-isolation-probe')),cache,parent:read(()=>parent.document.body.textContent),parentStorage:read(()=>parent.localStorage.getItem('sb-synthetic-auth-token')),html:document.documentElement.textContent.includes('SYNTHETIC-PRIVATE-SESSION-SENTINEL')};
   });
   assert.equal(proof.origin,'null');for(const key of ['local','session','cookie','indexedDb','cache','parent','parentStorage'])assert.equal(proof[key].error,'SecurityError',key+' was accessible');assert.equal(proof.html,false);
   assert.match(await frame.locator('#employeeDemoBanner').innerText(),/demo|sample/i);assert.match(await frame.locator('#employeeDemoBanner').innerText(),/no.*save|saving.*disabled|read.only/i);
   return proof;
  });
  await check(label+'-compact-demo-notice-keyboard-and-reset',async()=>{
   const banner=frame.locator('#employeeDemoBanner'),summary=frame.locator('#employeeDemoBannerSummary');
   assert.equal(await banner.evaluate(el=>el.tagName),'DETAILS');
   if(width<=1000){
    assert.equal(await banner.evaluate(el=>el.open),false);assert.equal(await frame.locator('#employeeDemoReset').isVisible(),false);
    const text=await summary.innerText();assert.match(text,/demo|sample/i);assert.match(text,/no live/i);assert.match(text,/no saves/i);
    assert.ok((await summary.boundingBox()).height>=44,'Notice summary touch target shrank');
    assert.ok((await banner.boundingBox()).height<=90,'Collapsed notice still dominates the phone');
    await summary.focus();await page.keyboard.press('Enter');assert.equal(await banner.evaluate(el=>el.open),true);
    assert.match(await frame.locator('#employeeDemoBannerDetails').innerText(),/optional.*example|not.*access grant/i);
    await screenshot(page,label+'-notice-expanded');await summary.focus();await page.keyboard.press('Space');assert.equal(await banner.evaluate(el=>el.open),false);
    await summary.click();await frame.locator('#employeeDemoReset').click();await frame.waitForFunction(()=>state.view==='today'&&inventoryReady&&wallsProductionReady);
    assert.equal(await banner.evaluate(el=>el.open),false,'Reset should restore compact notice');
   }else{assert.equal(await banner.evaluate(el=>el.open),true);assert.equal(await frame.locator('#employeeDemoReset').isVisible(),true);assert.equal(await summary.isVisible(),false)}
   await frame.evaluate(()=>scrollTo(0,0));
  });
  await check(label+'-authorized-today-and-navigation',async()=>{
   assert.equal(await frame.evaluate(()=>state.view),'today');assert.deepEqual(await frame.locator('[data-mobile-division]').evaluateAll(ns=>ns.map(n=>n.dataset.mobileDivision)),['walls']);
   assert.equal(await frame.locator('[data-mobile-route="report"],[data-mobile-route="installation"]').count(),0);
   assert.equal(await frame.locator('#searchBtn').isVisible(),false);await screenshot(page,label+'-today');
   if(width<=1000){assert.equal(await frame.locator('#operationsSidebar').evaluate(el=>el.inert),true);await frame.locator('#operationsNavMenu').click();assert.equal(await frame.locator('#operationsSidebar').evaluate(el=>el.inert),false);await page.keyboard.press('Escape');assert.equal(await frame.locator('#operationsSidebar').evaluate(el=>el.inert),true)}
  });
  await check(label+'-four-production-tabs-read-only',async()=>{
   await frame.locator('[data-mobile-route="production"]').click();
   assert.equal(await frame.evaluate(()=>state.productionDay),'2026-10-26','Demo must open its labeled populated sample day, not the real clock');
   for(const tab of ['today','week','tables','forecast']){
    await frame.locator(`[data-production-view="${tab}"]`).click();assert.deepEqual(await frame.locator('[data-production-view]').evaluateAll(ns=>ns.map(n=>n.dataset.productionView)),['today','week','tables','forecast']);
    assert.equal(await frame.locator('.walls-subtabs').count(),0);assert.equal(await frame.locator('[data-prod-refresh]').isVisible(),true);
    assert.equal(await frame.locator('[data-prod-edit],[data-prod-table],[data-prod-cancel],[data-prod-pour],[data-prod-stage],[data-prod-progress]').count(),0);
    await frame.locator('[data-prod-refresh]').click();await frame.waitForFunction(()=>!wallsProductionError&&wallsProductionReady);assert.match(await frame.locator('#view').innerText(),/Sample foundation A/,'Production '+tab+' must show sample work');
    if(tab==='today'){
     const totals=frame.locator('#employeeProductionTotals');
     assert.equal(await frame.locator('.production-kpi').count(),7,'Production totals must not be deleted');
     if(width<=1000){
      assert.equal(await totals.evaluate(el=>el.open),false);assert.equal(await frame.locator('.production-kpis').isVisible(),false);
      assert.equal(await frame.locator('#employeeProductionWork').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('employeeProductionTotals'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'Work must precede totals in DOM and keyboard order');
      const summary=totals.locator('summary');assert.ok((await summary.boundingBox()).height>=44);
      await summary.focus();await page.keyboard.press('Enter');assert.equal(await totals.evaluate(el=>el.open),true);assert.equal(await frame.locator('.production-kpis').isVisible(),true);
      await screenshot(page,label+'-production-totals-expanded');await summary.focus();await page.keyboard.press('Space');assert.equal(await totals.evaluate(el=>el.open),false);
     }else{assert.equal(await totals.count(),0);assert.equal(await frame.locator('.production-kpis').isVisible(),true);assert.equal(await frame.locator('.production-kpis').evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('.production-columns'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'Desktop totals/order should stay unchanged')}
    }
    await frame.evaluate(()=>scrollTo(0,0));await screenshot(page,label+'-production-'+tab);
   }
  });
  await check(label+'-inventory-search-and-cancel-without-save',async()=>{
   await navigate(frame,width,'today');await frame.locator('[data-mobile-route="inventory"]').click();await frame.locator('#inventorySearch').waitFor();
   assert.deepEqual(await frame.locator('[data-inventory-scope]').evaluateAll(ns=>ns.map(n=>n.dataset.inventoryScope)),['walls-production']);
   assert.equal(await frame.locator('[data-inv-action="order"],[data-inv-action="receive"],[data-inv-action="preview"]').count(),0);
   const totals=frame.locator('#employeeInventoryTotals');
   if(width<=1000){
    assert.equal(await totals.evaluate(el=>el.open),false);assert.equal(await frame.locator('.inventory-stats').isVisible(),false);
    assert.equal(await frame.locator('#inventoryCatalog').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('employeeInventoryTotals'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'Materials/search must precede mobile totals');
    const summary=totals.locator('summary');assert.ok((await summary.boundingBox()).height>=44);await summary.focus();await page.keyboard.press('Enter');assert.equal(await totals.evaluate(el=>el.open),true);
    assert.equal(await frame.locator('.inventory-stats').isVisible(),true);await screenshot(page,label+'-inventory-totals-expanded');await summary.focus();await page.keyboard.press('Space');assert.equal(await totals.evaluate(el=>el.open),false);
   }else{assert.equal(await totals.count(),0);assert.equal(await frame.locator('.inventory-stats').isVisible(),true)}
   const before=await frame.evaluate(()=>JSON.stringify(inventoryItems));
   await frame.locator('#inventorySearch').fill('sample');assert.equal(await frame.locator('#inventorySearch').inputValue(),'sample');await frame.locator('#inventorySearch').fill('');
   for(const node of await frame.locator('[data-inv-action="plus"],[data-inv-action="minus"]').all())assert.equal(await node.isDisabled(),true);
   await frame.locator('[data-inv-action="edit"]').first().click();await frame.locator('#inventoryQtyInput').fill('999');assert.equal(await frame.locator('#inventoryModalSave').isDisabled(),true);
   assert.equal(await frame.locator('#inventoryThresholdInput,#inventoryUnitInput').count(),0);await screenshot(page,label+'-inventory-form');await frame.locator('#inventoryModalCancel').click();
   assert.equal(await frame.locator('#inventoryModal').isVisible(),false);assert.equal(await frame.evaluate(()=>JSON.stringify(inventoryItems)),before);
   await frame.locator('#inventoryRefresh').click();await frame.waitForFunction(()=>inventoryReady&&!inventoryLoadError);await frame.evaluate(()=>scrollTo(0,0));await screenshot(page,label+'-inventory');
  });
  await check(label+'-mutation-adapters-reject-and-reset',async()=>{
   const proof=await frame.evaluate(async()=>{
    const before=JSON.stringify(inventoryItems),names=['set_inventory_count','adjust_inventory_quantity','save_schedule_snapshot','mark_walls_poured','publish_weekly_planner_pack'];const rejected=[];
    for(const name of names){try{const x=await sb.rpc(name,{p_quantity:999});rejected.push(Boolean(x?.error))}catch{rejected.push(true)}}
    return {before,after:JSON.stringify(inventoryItems),rejected};
   });assert.equal(proof.before,proof.after);assert.ok(proof.rejected.every(Boolean));
   await resetDemo(frame);assert.equal(await frame.locator('#inventoryModal').isVisible(),false);
   return {mutationCallsRejected:proof.rejected.length};
  });
  await check(label+'-optional-approved-schedule-example',async()=>{
   assert.match(await frame.locator('#employeeDemoBanner').textContent(),/optional.*example|not.*access grant/i);
   await frame.locator('[data-mobile-route="schedule"]').click();await frame.locator('[data-employee-crew-read]').waitFor();assert.equal(await frame.locator('[data-planner-action]').count(),0);
   if(width<=1000){const details=frame.locator('#employeeCrewDetails');assert.equal(await details.evaluate(el=>el.open),false);const summary=details.locator('summary');assert.ok((await summary.boundingBox()).height>=44);await summary.focus();await page.keyboard.press('Enter');assert.equal(await details.evaluate(el=>el.open),true);assert.match(await details.innerText(),/active.*published.*approved/i);await summary.focus();await page.keyboard.press('Space');assert.equal(await details.evaluate(el=>el.open),false)}else assert.equal(await frame.locator('#employeeCrewDetails').count(),0);
   await frame.evaluate(()=>scrollTo(0,0));await screenshot(page,label+'-approved-list');await frame.locator('[data-employee-crew-read]').click();await frame.locator('#productionModal').waitFor({state:'visible'});
   assert.equal(await frame.locator('#productionModalSave').isVisible(),false);assert.match(await frame.locator('#productionModalBody').innerText(),/sample/i);assert.doesNotMatch(await frame.locator('#productionModalBody').innerText(),/Readiness|PRIVATE/);
   await screenshot(page,label+'-approved-reader');await frame.locator('#productionModalClose').click();assert.equal(await frame.locator('#productionModal').isVisible(),false);
   await resetDemo(frame);
  });
  await check(label+'-parent-session-preserved',async()=>{
   const proof=await page.evaluate(()=>({local:localStorage.getItem('sb-synthetic-auth-token'),session:sessionStorage.getItem('synthetic_hub_session'),cookie:document.cookie}));
   assert.equal(proof.local,sentinel);assert.equal(proof.session,sentinel);assert.ok(proof.cookie.includes(sentinel));return {unchanged:true};
  });
  if(width===1440){
   await check('mobile-desktop-mobile-layout-reentry-without-state-loss',async()=>{
    await frame.locator('[data-mobile-route="production"]').click();await frame.locator('[data-production-view="today"]').click();
    for(const w of [390,1440,390,1440]){
     await page.setViewportSize({width:w,height:w===390?844:1000});await frame.waitForFunction(w=>w<=1000?Boolean(document.getElementById('employeeProductionTotals')):!document.getElementById('employeeProductionTotals'),w);
     assert.equal(await frame.locator('[data-production-view="today"]').count(),1);assert.equal(await frame.locator('.production-kpi').count(),7);assert.match(await frame.locator('#view').innerText(),/Sample foundation A/);
     assert.equal(await frame.locator('#employeeDemoBanner').evaluate(el=>el.open),w>1000);assert.equal(await frame.evaluate(()=>state.productionDay),'2026-10-26');
    }
    await resetDemo(frame);assert.equal(await frame.locator('#inventoryModal').isVisible(),false);
   });
   await check('sandbox-no-transmitted-network-via-fetch-xhr-websocket-beacon-assets-form',async()=>{
    const count=requests.length,blockedBefore=unexpected.length;
    await frame.evaluate(async origin=>{
     const url=origin+'/probe';await Promise.all([
      fetch(url+'?fetch').catch(()=>null),
      new Promise(resolve=>{try{const x=new XMLHttpRequest();x.onerror=x.onload=resolve;x.open('POST',url+'?xhr');x.send('SYNTHETIC')}catch{resolve()}setTimeout(resolve,150)}),
      new Promise(resolve=>{try{const ws=new WebSocket(origin.replace('http:','ws:')+'/probe?ws');ws.onerror=()=>{ws.close();resolve()};setTimeout(()=>{ws.close();resolve()},150)}catch{resolve()}})
     ]);
     try{navigator.sendBeacon(url+'?beacon','SYNTHETIC')}catch{}
     const img=new Image();img.src=url+'?image';document.body.append(img);
     const script=document.createElement('script');script.src=url+'?script';document.body.append(script);
     const form=document.createElement('form');form.action=url+'?form';form.method='POST';document.body.append(form);try{form.submit()}catch{}
     try{await navigator.serviceWorker.register(url+'?sw')}catch{}
    },origin);await page.waitForTimeout(250);
    assert.equal(requests.length,count,'Probe reached HTTP server');assert.equal(upgrades.length,0,'WebSocket upgrade reached the server');assert.equal(unexpected.length,blockedBefore,'Browser attempted a network request before test interception');return {transmittedRequests:0,websocketUpgrades:0};
   });
   for(const target of [origin+'/probe?self','https://synthetic-external.invalid/probe'])await check('sandbox-self-navigation-blocked-'+target,async()=>{
    await page.goto(origin+'/employee-review/');frame=await frameFor(page);const before=requests.length,blockedBefore=unexpected.length;
    await frame.evaluate(url=>{location.href=url},target).catch(()=>{});await page.waitForTimeout(200);
    assert.equal(requests.length,before);assert.equal(unexpected.length,blockedBefore);assert.equal(page.url(),origin+'/employee-review/');
   });
   await check('sandbox-top-navigation-popups-and-downloads-blocked',async()=>{
    await page.goto(origin+'/employee-review/');frame=await frameFor(page);const before=requests.length,blockedBefore=unexpected.length;let popups=0;page.on('popup',()=>popups++);
    await frame.evaluate(origin=>{try{top.location.href=origin+'/probe?top'}catch{}try{window.open(origin+'/probe?popup','_blank')}catch{}const a=document.createElement('a');a.href=origin+'/probe?download';a.download='synthetic.txt';document.body.append(a);a.click()},origin);await page.waitForTimeout(200);
    assert.equal(requests.length,before);assert.equal(unexpected.length,blockedBefore);assert.equal(popups,0);assert.equal(page.url(),origin+'/employee-review/');return {popups:0,transmittedRequests:0};
   });
  }
  await context.close();
 }
}finally{
 await browser.close();await new Promise(r=>server.close(r));
 const report={method:'Actual Chromium against local-only HTTP synthetic demo; browser isolation proof, not employee backend authorization or physical-device proof.',results,failures,pageErrors,unexpectedRequests:unexpected,serverRequests:requests,websocketUpgrades:upgrades};
 if(output)await writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({checks:results.length,failures,pageErrors,unexpectedRequests:unexpected},null,2));
}
assert.equal(failures.length,0,'Demo checks failed');assert.equal(pageErrors.length,0,'Demo page errors');assert.equal(unexpected.length,0,'Demo emitted unexpected requests');assert.equal(upgrades.length,0,'Demo emitted WebSocket upgrades');
