// Synthetic schedule/snapshot regressions only. No service access or operational records.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=readFileSync(process.env.PRODUCTION_RELEASE_SOURCE||new URL('../index.html',import.meta.url),'utf8');
function sourceOf(name){const start=html.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert.ok(start>=0,name);const first=html.slice(start,html.indexOf('\n',start)).trimEnd();return first.endsWith('}')?first:html.slice(start,html.indexOf('\n}',start)+2)}
function fixture(status='Complete'){
 const wall={id:'synthetic-wall',job:'Synthetic foundation',type:'Test wall',planReview:{stages:{approvedProduction:{status}}}};
 const assignment={assignment_id:'synthetic-run',wall_record_id:wall.id,table_id:'synthetic-table',stage:'stripped',planned_lf:100,wall_height:8,strip_at:'2026-10-20T07:00'};
 const c={state:{walls:[wall]},wallsProduction:{jobs:[],assignments:[assignment],tables:[],issues:[],permissions:{setup:true,issue:true}},PRODUCTION_STAGE_LABELS:{stripped:'Stripped / Table Available',curing:'Curing'},fmt:x=>x};
 vm.createContext(c);
 for(const name of ['htmlSafe','safeDocumentUrl','productionDatePart','productionTime','productionJob','productionTable','productionOpenIssues','productionHeightLabel','productionStageRank','productionReleasePill','productionDocumentLink','productionAssignmentActions','productionAssignmentCard'])vm.runInContext(sourceOf(name),c);
 return {c,wall,assignment,card:()=>c.productionAssignmentCard(assignment,'strip')};
}
test('explicit not-complete approval is blocked before production and after physical strip',()=>{
 for(const status of ['Not Started','In Progress','Waiting','unexpected']){
  const f=fixture(status);f.assignment.stage='planned';
  assert.match(f.card(),/Not Released for Production/);
  assert.match(f.c.productionAssignmentActions(f.assignment),/disabled title="Production release required"/);
  f.assignment.stage='stripped';assert.match(f.card(),/Actual strip status:<\/strong> Complete/);
  assert.match(f.card(),/Not Released for Production/);
 }
});
test('released active snapshot remains authoritative over conflicting raw schedule data',()=>{
 for(const [snapshotStatus,fallbackStatus] of [['Released for Production','Waiting'],['Not Released for Production','Complete']]){
  const f=fixture(fallbackStatus),snapshot={id:f.wall.id,releaseStatus:snapshotStatus};f.c.wallsProduction.jobs=[snapshot];
  assert.equal(f.c.productionJob(f.wall.id),snapshot);
  assert.equal(f.c.productionJob(f.wall.id).releaseStatus,snapshotStatus);
 }
});
test('present but incomplete snapshot never upgrades from approved fallback data',()=>{
 for(const releaseStatus of [undefined,null,'','unexpected']){
  const f=fixture(),snapshot={id:f.wall.id,releaseStatus};f.c.wallsProduction.jobs=[snapshot];
  assert.equal(f.c.productionJob(f.wall.id),snapshot);assert.match(f.card(),/Production release unavailable/);
  f.assignment.stage='planned';assert.match(f.c.productionAssignmentActions(f.assignment),/disabled title="Production release required"/);
 }
});
test('approved completed jobs retain release across every actual production stage and completion format',()=>{
 for(const completion of [{},{completedDate:'2026-10-20'},{completedMonth:'2026-10'}]){
  const f=fixture();Object.assign(f.wall,completion);
  for(const stage of ['planned','setup_in_progress','setup_complete','ready_for_pour','poured','curing','stripped']){
   f.assignment.stage=stage;assert.match(f.card(),/class="production-pill release">Released for Production/);
   assert.doesNotMatch(f.card(),/Not Released for Production/);
   assert.equal(f.assignment.stage,stage);
  }
 }
});
test('recorded strip and completion never substitute for approval evidence',()=>{
 for(const status of [undefined,null,'',false,{},'complete']){
  const f=fixture();f.wall.planReview.stages.approvedProduction.status=status;f.wall.completedMonth='2026-10';
  assert.notEqual(f.c.productionJob(f.wall.id).releaseStatus,'Released for Production');
  assert.doesNotMatch(f.card(),/class="production-pill release"/);
  f.assignment.stage='planned';assert.match(f.c.productionAssignmentActions(f.assignment),/disabled title="Production release required"/);
 }
});
test('missing job or approval data stays unavailable and cannot enable setup',()=>{
 for(const missing of ['job','planReview','stages','approvedProduction']){
  const f=fixture();
  if(missing==='job')f.c.state.walls=[];else if(missing==='planReview')delete f.wall.planReview;else if(missing==='stages')delete f.wall.planReview.stages;else delete f.wall.planReview.stages.approvedProduction;
  assert.match(f.card(),/Production release unavailable/);assert.doesNotMatch(f.card(),/Not Released for Production/);
  f.assignment.stage='planned';assert.match(f.c.productionAssignmentActions(f.assignment),/disabled title="Production release required"/);
 }
});
test('actual strip, production holds, schedule review, and final QC remain separate from approval',()=>{
 const f=fixture();f.assignment.needs_review=true;
 f.c.wallsProduction.issues=[{assignment_id:f.assignment.assignment_id,status:'open',category:'Synthetic hold',description:'Inspection follow-up'}];
 const card=f.card();assert.match(card,/production-card strip hold/);assert.match(card,/1 open issue/);
 assert.match(card,/Schedule changed — review plan/);assert.match(card,/Actual strip status:<\/strong> Complete/);
 assert.match(card,/class="production-pill release">Released for Production/);assert.doesNotMatch(card,/Final QC released/);
 f.wall.planReview.stages.approvedProduction.status='Waiting';assert.match(f.card(),/Not Released for Production/);assert.match(f.card(),/1 open issue/);
});
test('fallback is read-only and re-evaluates approval after fresh snapshot and schedule hydration',()=>{
 const f=fixture();f.wall.completedMonth='2026-10';const original=JSON.stringify({wall:f.wall,assignment:f.assignment});
 assert.match(f.card(),/class="production-pill release"/);assert.equal(JSON.stringify({wall:f.wall,assignment:f.assignment}),original);
 assert.equal(Object.hasOwn(f.wall,'releaseStatus'),false);
 f.c.state.walls=JSON.parse(JSON.stringify([f.wall]));f.c.wallsProduction=JSON.parse(JSON.stringify(f.c.wallsProduction));
 assert.match(f.card(),/class="production-pill release"/);
 f.c.state.walls[0].planReview.stages.approvedProduction.status='Waiting';assert.match(f.card(),/Not Released for Production/);
});
