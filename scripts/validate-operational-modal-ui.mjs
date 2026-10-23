// Offline actual-DOM save recovery. No credentials, hosted traffic, or business data.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const html=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace(/<script src="[^"]+"><\/script>/g,'').replace('const sb=','let sb=');
const output=process.argv[2];if(output)await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const scenarios=[
 {name:'inventory-count',kind:'inventory',open:'count',values:{inventoryQtyInput:'37'}},
 {name:'inventory-settings',kind:'inventory',open:'settings',values:{inventoryQtyInput:'38',inventoryThresholdInput:'7',inventoryUnitInput:'boxes'}},
 {name:'inventory-receive',kind:'inventory',open:'receive',values:{inventoryReceivedInput:'9'}},
 {name:'production-assignment',kind:'production',open:'assignment',values:{prodJob:'qa-wall',prodTable:'qa-table',prodHeight:'5',prodLf:'80',prodSetup:'2026-10-25T06:00',prodPour:'2026-10-26T06:00',prodStrip:'2026-10-27T06:00',prodNotes:'Retained assignment notes'}},
 {name:'production-issue',kind:'production',open:'issue',values:{prodIssueCategory:'Equipment problems',prodIssueText:'Retained issue description'}},
 {name:'production-pour',kind:'production',open:'pour',values:{prodActualLf:'75',prodStageNote:'Retained pour note'}},
 {name:'production-table',kind:'production',open:'table',values:{prodTableLabel:'Retained table label',prodTableCapacity:'100',prodTableNotes:'Retained table note'}}
];
const results=[],errors=[];
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',error=>errors.push(`${width}: ${error.message}`));page.on('dialog',dialog=>dialog.dismiss());
  await page.route('**/*',route=>route.request().url()==='http://offline.test/'?route.fulfill({contentType:'text/html',body:html}):route.abort());await page.goto('http://offline.test/');
  await page.evaluate(()=>{
   window.qaCalls=[];window.qaItem={id:1,code:'SYNTHETIC',description:'Synthetic stock',unit:'units',qty:20,threshold:5,version:4};
   window.qaSetup=()=>{currentUser={id:'synthetic-modal-user'};currentUserIsAdmin=true;currentUserAuthorized=true;inventoryCanAdjust=true;inventoryCanManage=true;productionBusy=false;inventoryBusy=false;state.view='other';state.productionDay='2026-10-26';wallsProduction={permissions:{assign:true},jobs:[{id:'qa-wall',job:'Synthetic foundation',totalLf:120}],tables:[{table_id:'qa-table',label:'Synthetic table',capacity_lf:120,version:2}],assignments:[{assignment_id:'qa-assignment',wall_record_id:'qa-wall',table_id:'qa-table',planned_lf:120,version:3}]};showAuthGate(false)};
   window.qaOpen=kind=>{if(kind==='count'){inventoryCanManage=false;inventoryEditItem(window.qaItem)}else if(kind==='settings'){inventoryCanManage=true;inventoryEditItem(window.qaItem)}else if(kind==='receive'){inventoryCanManage=true;inventoryReceive(window.qaItem)}else if(kind==='assignment')openProductionAssignmentModal();else if(kind==='issue')openProductionIssueModal('qa-assignment');else if(kind==='pour')openProductionPourModal('qa-assignment');else openProductionTableModal('qa-table')};
   sb={rpc:(name,args)=>new Promise((resolve,reject)=>window.qaCalls.push({name,args,resolve,reject}))};
   loadInventory=loadWallsProduction=async()=>true;renderInventory=()=>{};window.qaSetup();
  });
  async function open(s){await page.evaluate(s=>{closeInventoryModal();closeProductionModal();window.qaCalls=[];window.qaSetup();window.qaOpen(s.open)},s);for(const [id,value]of Object.entries(s.values)){const el=page.locator('#'+id);if(await el.evaluate(n=>n.tagName==='SELECT'))await el.selectOption(value);else await el.fill(value)}}
  for(const s of scenarios){
   const prefix=s.kind+'Modal';await open(s);await page.locator('#'+prefix+'Save').click();assert.equal(await page.locator('#'+prefix+'Save').isDisabled(),true);assert.equal(await page.locator('#'+prefix).isVisible(),true);
   await page.evaluate(kind=>{document.getElementById(kind+'ModalSave').click();(kind==='production'?productionModalSaveAction:inventoryModalSaveAction)()},s.kind);assert.equal(await page.evaluate(()=>window.qaCalls.length),1);
   await page.evaluate(()=>window.qaCalls[0].resolve({error:{message:'Synthetic validation failure'}}));await page.waitForFunction(prefix=>!document.getElementById(prefix+'Save').disabled,prefix);
   assert.equal(await page.locator('#'+prefix).isVisible(),true);for(const [id,value]of Object.entries(s.values)){assert.equal(await page.locator('#'+id).inputValue(),value);assert.equal(await page.locator('#'+id).isEnabled(),true)}assert.match(await page.locator('#'+prefix+'SaveStatus').textContent(),/entries are retained/);
   if(output)await page.screenshot({path:resolve(output,`${width}-${s.name}-retained.png`),fullPage:true});
   await page.locator('#'+prefix+'Save').click();await page.evaluate(()=>window.qaCalls[1].resolve({data:{}}));await page.waitForFunction(prefix=>!document.getElementById(prefix).classList.contains('open'),prefix);assert.equal(await page.evaluate(()=>window.qaCalls.length),2);
   results.push({width,scenario:s.name,flow:'returned-error-retain-and-confirmed-retry',passed:true});
  }
  for(const s of [scenarios[2],scenarios[4]]){
   const prefix=s.kind+'Modal';await open(s);await page.locator('#'+prefix+'Save').click();await page.evaluate(()=>window.qaCalls[0].reject(new Error('Synthetic lost response')));await page.waitForFunction(prefix=>document.getElementById(prefix+'SaveStatus')?.textContent.includes('outcome unknown'),prefix);
   assert.equal(await page.locator('#'+prefix).isVisible(),true);assert.equal(await page.locator('#'+prefix+'Save').isDisabled(),true);for(const [id,value]of Object.entries(s.values))assert.equal(await page.locator('#'+id).inputValue(),value);
   await page.evaluate(kind=>(kind==='production'?productionModalSaveAction:inventoryModalSaveAction)(),s.kind);assert.equal(await page.evaluate(()=>window.qaCalls.length),1);assert.match(await page.locator('#'+prefix+'SaveStatus').textContent(),/No automatic retry/);
   if(output)await page.screenshot({path:resolve(output,`${width}-${s.name}-unknown.png`),fullPage:true});results.push({width,scenario:s.name,flow:'lost-response-retained-and-locked',passed:true});
  }
  for(const s of [scenarios[2],scenarios[4]]){
   const prefix=s.kind+'Modal';await open(s);await page.locator('#'+prefix+'Save').click();
   await page.evaluate(s=>{resetLocalSession();window.qaSetup();window.qaOpen(s.open)},s);for(const [id,value]of Object.entries(s.values)){const el=page.locator('#'+id);if(await el.evaluate(n=>n.tagName==='SELECT'))await el.selectOption(value);else await el.fill(value)}await page.locator('#'+prefix+'Save').click();assert.equal(await page.evaluate(()=>window.qaCalls.length),2);
   await page.evaluate(()=>window.qaCalls[0].resolve({data:{}}));await page.waitForTimeout(20);assert.equal(await page.locator('#'+prefix).isVisible(),true);assert.equal(await page.locator('#'+prefix+'Save').isDisabled(),true);
   await page.evaluate(()=>window.qaCalls[1].resolve({data:{}}));await page.waitForFunction(prefix=>!document.getElementById(prefix).classList.contains('open'),prefix);results.push({width,scenario:s.name,flow:'replacement-session-owner-guard',passed:true});
  }
  // Dismiss through the real backdrop listener, then reopen without inherited display:none.
  for(const s of [scenarios[2],scenarios[4]]){
   const prefix=s.kind+'Modal';await open(s);
   await page.locator('#'+prefix).dispatchEvent('click');assert.equal(await page.locator('#'+prefix).isVisible(),true,'dirty form is not dismissed by a backdrop tap');
   await page.evaluate(prefix=>closeModal(prefix),prefix);assert.equal(await page.locator('#'+prefix).isVisible(),false);
   await page.evaluate(s=>window.qaOpen(s.open),s);assert.equal(await page.locator('#'+prefix).isVisible(),true);
   await page.evaluate(prefix=>closeModal(prefix),prefix);assert.equal(await page.locator('#'+prefix).isVisible(),false);
   await page.evaluate(({s,prefix})=>{document.getElementById(prefix).style.display='none';window.qaOpen(s.open)},{s,prefix});assert.equal(await page.locator('#'+prefix).isVisible(),true);
   results.push({width,scenario:s.name,flow:'backdrop-and-generic-dismiss-reopen',passed:true});
  }
  await page.evaluate(()=>{
   closeInventoryModal();closeProductionModal();
   for(const id of ['wallModal','projectModal','pieceModal','planReviewModal'])document.getElementById(id).style.display='flex';
   document.getElementById('wCustomer').value='SYNTHETIC PRIVATE CUSTOMER';resetLocalSession();window.qaSetup();
  });
  for(const id of ['wallModal','projectModal','pieceModal','planReviewModal'])assert.equal(await page.locator('#'+id).isVisible(),false,'signed-out inline modal must not reappear after login');
  assert.equal(await page.locator('#wCustomer').inputValue(),'');
  results.push({width,scenario:'legacy-inline-modals',flow:'logout-login-stays-closed',passed:true});
  await page.close();
 }
 if(output)await writeFile(resolve(output,'results.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({scenarios:results.length,errors},null,2));assert.equal(errors.length,0);
}finally{await browser.close()}
