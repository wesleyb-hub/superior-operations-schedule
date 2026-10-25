// Actual inline renderers and save/reload functions; synthetic records only, no network/database.
// String-boundary tests complement (not replace) the real Chromium DOM harness.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function sourceOf(name){
 const start=html.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
 assert.ok(start>=0,`Missing actual function ${name}`);
 const lineEnd=html.indexOf('\n',start),first=html.slice(start,lineEnd).trimEnd();
 return first.endsWith('}')?first:html.slice(start,html.indexOf('\n}',start)+2);
}
const plain=x=>JSON.parse(JSON.stringify(x));
const payload='Synthetic & "quotes" \' <img src=x onerror="synthetic()">';
const recordId='synthetic" onmouseover="synthetic()';
const functions=`htmlSafe safeDocumentUrl linkListHtml productionDocumentLink normalizeDate parseDate iso addDays fmt fullWeekLabel weekday weekStart weekDates pct statusClass kpi localDateISO operationsWeekKey currentOperationsWeekKey eventWeekKey currentLogWeek todayISO currentWeekISO monthLabel wallIsCompleted wallCompletionMonth wallCompletionDisplay billingPeriod billingDateDisplay defaultWallPlanReview ensureWallPlan wallPlanStage wallPlanReleased wallPlanProgress wallPlanCurrentStage wallPlanCurrentStatus wallPlanRiskClass wallPlanSummaryHtml nonnegativeNumber wallHeightBreakdown wallHeightTotal normalizeWallLF wallLfSummary billingSourceMismatch syncBilling ensureState uiPrefsFromState sharedDataFromState mergeRemoteData validateOperationalTransition persistState saveState allProducts producedQty releasedQty nextProductionDay pieceScheduleDates pieceIsScheduledOn plannedQtyForDate actualQtyForDate productionCompletionsForWeek productionCompletedQtyForWeek qcReleasedQtyForWeek pieceCountsForDate activeJobs productStatusText productStatusClass productDisplayName renderProjectSpecials renderProductRow projectProductionSpan projectProductionDates projectProductionSpanForYear yearWeekStarts yearMonthGroups yearWeekIndex yearHeaderGrid yearCells yearBarHtml precastSpecialMarkers wallCard wallWeekCard renderWalls renderWallsActive renderWallsPlanReview renderWallsOverall renderWallsYearOutlook renderWallsMonthly renderPrecast renderPrecastOverall renderPrecastMonthly renderPrecastYearOutlook renderBilling renderSearchResults renderQC renderDelivery renderOverview renderAudit renderHistory`.split(' ');
// Keep the hostile audit record in the fixture's current work week, even after
// the real Friday-5PM cutoff. This is a rendering test, not a wall-clock test.
class FixtureDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-21T12:00:00Z']))}static now(){return new FixtureDate().getTime()}}
function fixture(){
 const nodes={};
 const c={console,URL,Date:FixtureDate,Math,Set,Map,JSON,Number,String,clone:plain,
 state:{view:'walls',subview:{walls:'current'},walls:[],jobs:[],billing:[],loads:[],audit:[],historyArchive:[],deliveryHistory:[],qcHistory:[],systemFlags:{},week:'2026-10-19',reportMonth:'2026-10',year:2026},seed:{},
 currentUser:{id:'synthetic-user',email:'synthetic@example.test'},currentUserIsAdmin:true,currentUserCanWrite:true,
 currentAllowedWallSubviews:[],hubSessionEpoch:0,remoteLoadToken:0,remoteReady:true,lastRemoteData:null,lastSharedJson:'',lastRevision:1,structuredBackendReady:true,saveBusy:false,saveQueued:false,queuedReason:'Saved',
 wallsInstallation:{jobs:[]},wallsInstallationReady:false,wallsInstallationError:'',window:{},
 document:{getElementById:id=>nodes[id]||=( {} ),querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},
 divisionSubtabs:()=>'',bindWallControls(){},bindPrecastControls(){},bindWallDragDrop(){},bindDeliveryDragDrop(){},wallSubviewAllowed:()=>true,
 syncAllLinkedDeliveries(){},saveUiPrefs(){},render(){},printCurrent(){},renderWallsQcQueue:()=>'',installationCanManage:()=>true,installationJob:()=>null,deliverySourceLabel:()=>payload,
 alert(message){throw new Error('Unexpected alert: '+message)},loadRemoteState(){throw new Error('Unexpected reload')}
 };
 vm.createContext(c);
 vm.runInContext(html.slice(html.indexOf('const divisionMeta='),html.indexOf('const seed='))+html.slice(html.indexOf('const WALL_HEIGHTS='),html.indexOf('function nonnegativeNumber('))+functions.map(sourceOf).join('\n'),c);
 return {c,nodes};
}
function wall(extra={}){return {id:recordId,job:payload,customer:payload,type:payload,project:payload,development:payload,address:payload,source:payload,saleType:payload,constraint:payload,notes:payload,units:1,lf:120,lfByHeight:{h8:120},digDate:'2026-10-19',productionDate:'2026-10-20',installDate:'2026-10-21',links:['javascript:synthetic()','https://example.test/doc?q=1&x=2'],planReview:{notes:payload,trackerStatus:payload,stages:{}},...extra}}
function project(extra={}){return {id:recordId,name:payload,customer:payload,type:payload,status:payload,constraint:payload,division:'boxes',total:1,dailyRate:1,products:[{id:recordId,label:payload,structureId:payload,pieceType:payload,pieceSize:payload,pieceNotes:payload,status:'scheduled',qty:1,plannedDate:'2026-10-20',isSpecial:true,productionDays:1}],links:['javascript:synthetic()'],...extra}}
function assertInert(markup){assert.doesNotMatch(markup,/<(?:img|svg|script)\b|\son(?:error|mouseover|focus)="synthetic\(/i);assert.match(markup,/Synthetic &amp; &quot;quotes&quot; &#39; &lt;img/)}
for(const [name,completed] of [['renderWalls',false],['renderWallsActive',false],['renderWallsPlanReview',false],['renderWallsOverall',false],['renderWallsYearOutlook',false],['renderWallsMonthly',true]]){
 test(`${name}: stored text and record attributes remain inert`,()=>{
  const {c,nodes}=fixture();c.state.walls=[wall(completed?{completedMonth:'2026-10'}:{})];c[name]();assertInert(nodes.view.innerHTML);
  if(name==='renderWallsYearOutlook')assert.doesNotMatch(nodes.view.innerHTML,/Job Synthetic &amp;amp;/,'tooltip must not be double escaped');
 });
}
for(const name of ['renderPrecast','renderPrecastOverall','renderPrecastMonthly','renderPrecastYearOutlook']){
 test(`${name}: imported project/piece labels remain inert`,()=>{
  const {c,nodes}=fixture();c.state.jobs=[project(name==='renderPrecastMonthly'?{completedDate:'2026-10-21'}:{})];c[name]('boxes');assertInert(nodes.view.innerHTML);
 });
}
test('wall plan summary and unknown product status are text, not markup',()=>{
 const {c}=fixture();assertInert(c.wallPlanSummaryHtml(wall()));const j=project();j.products[0].status=payload;assertInert(c.renderProductRow(j,j.products[0]));
});
for(const name of ['renderOverview','renderQC','renderDelivery','renderAudit','renderHistory','renderSearchResults','renderBilling']){
 test(`${name}: downstream stored/imported text remains inert`,()=>{
  const {c,nodes}=fixture();c.state.walls=[wall({productionDate:''})];c.state.jobs=[project()];c.state.jobs[0].products[0].status='hold';
  c.state.loads=[{id:recordId,division:'walls',project:payload,load:payload,status:'Scheduled',date:c.state.week,qty:1}];
  c.state.audit=[{date:c.state.week,weekKey:c.state.week,type:payload,user:payload,detail:payload}];
  c.state.qcHistory=[{date:c.state.week,weekKey:c.state.week,product:payload,project:payload,action:payload,user:payload}];
  c.state.deliveryHistory=[{date:c.state.week,division:'walls',project:payload,load:payload,qty:1}];
  c.state.searchQuery='Synthetic';c.state.billing=[{key:'wall:missing',division:'walls',project:payload,customer:payload,status:'Billed',invoice:payload,invoiceDate:'2026-10-21',billableMonth:'2026-10',qty:120,unit:'LF'}];
  c[name]();assertInert(nodes.view.innerHTML);
 });
}
test('actual save snapshot and reload retain every invoice-bearing orphan unchanged, without reversal writes',async()=>{
 for(const prefix of ['wall:','precast:'])for(const sourceExists of [false,true])for(const metadata of [{status:'Billed',invoice:'',invoiceDate:''},{status:'Billed',invoice:'TEST-INVOICE',invoiceDate:'2026-10-21'},{status:'Hold',invoice:'TEST-INVOICE',invoiceDate:''},{status:'Ready to Bill',invoice:'',invoiceDate:'2026-10-21'}]){
  const {c,nodes}=fixture();const row={key:prefix+'synthetic',division:prefix==='wall:'?'walls':'boxes',project:'Synthetic invoice',customer:payload,qty:120,unit:'LF',billableDate:'2026-10-20',billableMonth:'2026-10',notes:'Do not reverse or discard',...metadata};
  c.state.billing=[row];if(sourceExists)c.state[prefix==='wall:'?'walls':'jobs']=[prefix==='wall:'?wall({id:'synthetic'}):project({id:'synthetic'})];
  c.lastRemoteData=plain(c.sharedDataFromState(c.state));c.lastRemoteData[prefix==='wall:'?'walls':'jobs']=[prefix==='wall:'?wall({id:'synthetic',completedMonth:'2026-10'}):project({id:'synthetic',completedDate:'2026-10-20'})];
  const calls=[];c.sb={rpc:async(name,args)=>{calls.push({name,args:plain(args)});return {data:{revision:2,updated_at:'2026-10-22T00:00:00Z'}}}};
  c.syncBilling();c.renderBilling();assert.match(nodes.view.innerHTML,/Source completion needs review/);
  assert.equal(await c.persistState('Synthetic unrelated operational correction'),true);
  assert.equal(calls.length,1);assert.equal(calls[0].name,'save_schedule_snapshot');assert.deepEqual(calls[0].args.p_snapshot.billing,[row]);
  c.mergeRemoteData(plain(calls[0].args.p_snapshot));c.renderBilling();assert.deepEqual(plain(c.state.billing),[row]);assert.match(nodes.view.innerHTML,/Source completion needs review/);
 }
});
test('completed source restores review warning without inventing accounting reversal or duplicate invoice',()=>{
 const {c}=fixture();const row={key:'wall:synthetic',status:'Billed',invoice:'TEST',invoiceDate:'2026-10-21',notes:'Keep'};c.state.billing=[row];c.syncBilling();assert.equal(c.billingSourceMismatch(row),true);
 c.state.walls=[wall({id:'synthetic',completedMonth:'2026-10'})];c.syncBilling();c.syncBilling();assert.equal(c.state.billing.length,1);assert.equal(c.billingSourceMismatch(row),false);assert.equal(row.status,'Billed');assert.equal(row.invoice,'TEST');assert.equal(row.notes,'Keep');
});
