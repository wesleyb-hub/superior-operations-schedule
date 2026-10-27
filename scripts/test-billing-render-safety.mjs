import {installHubReaderHelpers} from './hub-reader-test-helpers.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
function fixture(extra={}){
 const nodes={};const c={URL,console,state:{walls:[],jobs:[],billing:[],reportMonth:'2026-10',searchQuery:''},wallIsCompleted:w=>!!w.completedDate,wallCompletionMonth:w=>(w.completedDate||'').slice(0,7),divisionMeta:{boxes:{label:'Box Culverts',unit:'pieces'}},document:{getElementById:id=>nodes[id]||=( {} ),querySelectorAll:()=>[]},...extra};
 vm.createContext(c);installHubReaderHelpers(c,html);
 vm.runInContext(part('function htmlSafe(', 'function sourceVerifiedLabel('),c);
 vm.runInContext(part('function billingSourceMismatch(', 'ensureState();syncAllLinkedDeliveries();syncBilling();'),c);
 return {c,nodes};
}
test('retains invoiced wall and precast history when source absent or no longer completed',()=>{
 for(const key of ['wall:synthetic','precast:synthetic'])for(const sourceExists of [false,true])for(const metadata of [{status:'Billed',invoice:''},{status:'Hold',invoice:'TEST-INV'},{status:'Ready to Bill',invoiceDate:'2026-10-20'}]){
  const row={key,project:'Synthetic',qty:120,billableMonth:'2026-10',notes:'Retain accounting notes',...metadata};
  const {c}=fixture();if(sourceExists)c.state[key.startsWith('wall:')?'walls':'jobs']=[{id:'synthetic'}];
  c.state.billing=[row];c.syncBilling();assert.equal(c.state.billing.length,1);assert.deepEqual(c.state.billing[0],row);assert.equal(c.billingSourceMismatch(row),true);
 }
});
test('preserves existing ready-to-bill cleanup without deleting invoice history',()=>{
 const {c}=fixture();c.state.billing=[{key:'wall:uncompleted',status:'Ready to Bill',invoice:'',invoiceDate:''},{key:'manual',status:'Hold'}];c.syncBilling();assert.equal(c.state.billing.length,1);assert.equal(c.state.billing[0].key,'manual');
});
test('completed source updates operational fields without overwriting invoice metadata',()=>{
 const {c}=fixture();c.state.walls=[{id:'synthetic',job:'Test',completedDate:'2026-10-20',lf:120}];
 c.state.billing=[{key:'wall:synthetic',status:'Billed',invoice:'TEST',invoiceDate:'2026-10-21',notes:'Keep'}];c.syncBilling();
 assert.equal(c.state.billing[0].invoice,'TEST');assert.equal(c.state.billing[0].notes,'Keep');assert.equal(c.state.billing[0].status,'Billed');assert.equal(c.billingSourceMismatch(c.state.billing[0]),false);
});
test('document URLs allow only absolute HTTP/S and safely encode attributes',()=>{
 const {c}=fixture();for(const value of ['javascript:synthetic()',' JAVASCRIPT:synthetic()','data:text/html,test','file:///test','//example.test/test','/relative','https:example.test','java\nscript:synthetic()','javascript&#58;synthetic()','java&#115;cript:synthetic()','https://'])assert.equal(c.safeDocumentUrl(value),'',value);
 assert.equal(c.safeDocumentUrl('https://example.test/a?q=1&b=2'),'https://example.test/a?q=1&b=2');
 assert.match(c.linkListHtml(['https://example.test/a?q=1&b=2']),/q=1&amp;b=2/);
 assert.doesNotMatch(c.linkListHtml(['javascript:synthetic()']),/<a /);
 assert.doesNotMatch(c.linkListHtml(['https://example.test/\" onmouseover=\"synthetic()']),/ onmouseover=\"/);
 assert.match(c.linkListHtml(['https://example.test/doc']),/rel=\"noopener noreferrer\"/);
});
test('actual import preview escapes text and attribute boundaries',()=>{
 const payload='<img src=x onerror="synthetic()">',header='customer" autofocus onfocus="synthetic()';
 const {c,nodes}=fixture({importHeaders:[header],importData:[{[header]:payload}],importTargets:()=>[{k:'customer',l:'Customer'}],guessHeader:()=>header,applyImport(){}});
 nodes.importDivision={value:'walls'};vm.runInContext(part('function renderImportPreview(){','function applyImport(){'),c);c.renderImportPreview();
 assert.doesNotMatch(nodes.importPreview.innerHTML,/<img/);assert.match(nodes.importPreview.innerHTML,/&lt;img/);assert.match(nodes.importPreview.innerHTML,/customer&quot; autofocus onfocus=&quot;synthetic/);
});
