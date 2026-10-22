// Invoked by validate-render-safety-ui.mjs inside its routed-offline Chromium page.
import assert from 'node:assert/strict';
export async function recordIdDomChecks(page){
 const result=await page.evaluate(()=>{
  const id=`synthetic|job" onmouseover="synthetic()"><img src=x onerror="synthetic()">&'\\[]`,pieceId=`synthetic|piece" autofocus onfocus="synthetic()&'`,activityId='00000000-0000-4000-8000-000000000001';
  const original={state,wallsProduction,wallsInstallation,wallsInstallationReady,currentUserIsAdmin,openWallsInstallationIssueForm,moveWallMilestone,markPreReady,markPoured,openPieceModal,passQC,holdQC,releaseHold,undoProductionCompletion,quickCompleteWall,moveDelivery};
  const calls=[],checks=[],root=document.getElementById('view');
  const check=(condition,label)=>{if(!condition)throw Error(label);checks.push(label)};
  const inert=label=>check(!root.querySelector('img,svg,script,[onmouseover],[onerror],[onfocus],[autofocus]'),label+' inert DOM');
  const show=markup=>{root.innerHTML=markup};
  try{
   currentUserIsAdmin=true;state={...structuredClone(state),week:'2026-10-19',productionDay:'2026-10-19',installationDay:'2026-10-19',walls:[],jobs:[],qcHistory:[]};
   const row={id,job:'Synthetic foundation',totalLf:120,productionDate:'2026-10-19'};
   wallsProduction={permissions:{assign:true,plan:true},jobs:[row],assignments:[],tables:[{table_id:'1',label:'Synthetic table'}]};
   show(renderProductionQueue([row]));bindWallsProductionControls();inert('Production queue');
   const assign=[...root.querySelectorAll('[data-prod-new]')].find(b=>b.dataset.prodNew);check(assign.dataset.prodNew===id,'Production queue exact ID');assign.click();
   check(document.getElementById('prodJob').value===id,'Production selected option exact ID');
   check(!document.getElementById('productionModalBody').querySelector('img,[onmouseover],[onerror]'),'Production modal inert DOM');closeProductionModal();
   const job={record_id:id,job:{job:'Synthetic foundation',installDate:'2026-10-19'},activities:[{activity_id:activityId,activity_type:'site_preparation',status:'planned',activity_date:'2026-10-19'}],production:[],qc:[],delivery:[],issues:[]};
   wallsInstallation={permissions:{manage:true},jobs:[job],day_cards:[]};wallsInstallationReady=true;
   openWallsInstallationIssueForm=(...args)=>calls.push(args);
   for(const [label,markup] of [['activity',installationActivityCard(job,job.activities[0])],['workspace activity',installationWorkspaceActivityCard(job,job.activities[0])],['compact card',installationJobCompactCard(job,'2026-10-19')]]){
    show(markup);bindWallsInstallationEnhancedControls(root);inert('Installation '+label);
    for(const b of root.querySelectorAll('[data-install-issue]')){check(b.dataset.installIssue===id,label+' exact issue job ID');const activity=b.dataset.installIssueActivity||'';b.click();check(JSON.stringify(calls.at(-1))===JSON.stringify([id,activity]),label+' lossless issue click')}
   }
   for(const tab of ['overview','resources','closeout','activities']){
    show(installationWorkspacePanel(job,tab));inert('Installation '+tab);
    const controls=root.querySelectorAll('[data-install-readiness],[data-install-open-master],[data-install-add-for-job],[data-install-issue]');check(controls.length>0,tab+' has identity controls');
    for(const b of controls)for(const [key,value] of Object.entries(b.dataset))if(key!=='installIssueActivity')check(value===id,tab+' exact '+key);
   }
   const resourceName='Synthetic crew | North & South <img src=x onerror="synthetic()">';job.activities[0].resources=[{resource_assignment_id:'00000000-0000-4000-8000-000000000002',resource_type:'employee',resource_name:resourceName,availability_status:'confirmed',readiness_status:'ready'}];state.installationView='resources';renderWallsInstallationEnhanced();inert('Installation Resources name');check(root.querySelector('.install-resource h3').textContent===resourceName,'Installation full pipe-containing resource name');
   job.activities=[];job.job.installDate='2026-10-23';state.installationView='today';renderWallsInstallationEnhanced();inert('Installation upcoming');
   check(root.querySelector('[data-install-add-for-job]').dataset.installAddForJob===id,'Installation upcoming exact ID');
   const wall={id,job:'Synthetic foundation',digDate:'2026-10-19',links:[]};state.walls=[wall];const moves=[];moveWallMilestone=(...args)=>moves.push(args);
   show('<div class="wall-week-grid">'+wallCard(wall,'dig',wall.digDate,true)+'</div>');bindWallDragDrop();inert('Wall move');
   for(const b of root.querySelectorAll('[data-move-wall]'))b.click();check(JSON.stringify(moves)===JSON.stringify([[id,'dig','2026-10-12'],[id,'dig','2026-10-26']]),'Wall arrow exact record/stage/days');
   quickCompleteWall=(...args)=>calls.push(args);renderWallsActive();inert('Wall completion selector');
   const month=root.querySelector(`[data-completion-month="${CSS.escape(id)}"]`);check(Boolean(month),'CSS.escape resolves exact completion record');month.value='2026-10';root.querySelector('[data-quick-complete-wall]').click();check(JSON.stringify(calls.at(-1))===JSON.stringify([id,'2026-10',true]),'Wall completion selector click exact ID');
   moveDelivery=(...args)=>calls.push(args);state.deliveryDivision='all';state.deliveryStatus='all';state.loads=[{id,division:'walls',project:'Synthetic foundation',load:'Synthetic shipment',qty:1,date:'2026-10-19',status:'Scheduled'}];renderDelivery();inert('Delivery selector');
   const date=root.querySelector(`[data-delivery-date-input="${CSS.escape(id)}"]`);check(Boolean(date),'CSS.escape resolves exact delivery record');date.value='2026-10-20';root.querySelector('[data-move-delivery]').click();check(JSON.stringify(calls.at(-1))===JSON.stringify([id,'2026-10-20']),'Delivery selector click exact ID');
   const j={id,division:'boxes',name:'Synthetic project',total:1,dailyRate:1,products:[]},p={id:pieceId,label:'Synthetic piece',status:'scheduled',plannedDate:'2026-10-19'};j.products=[p];state.jobs=[j];
   markPreReady=(...args)=>calls.push(args);markPoured=(...args)=>calls.push(args);openPieceModal=(...args)=>calls.push(args);passQC=(...args)=>calls.push(args);holdQC=(...args)=>calls.push(args);releaseHold=(...args)=>calls.push(args);undoProductionCompletion=(...args)=>calls.push(args);
   for(const status of ['scheduled','pre-passed']){
    p.status=status;show(renderProductRow(j,p));bindPrecastControls('boxes');inert('Precast '+status);
    for(const b of root.querySelectorAll('[data-edit-piece],[data-pre],[data-pour]')){b.click();check(JSON.stringify(calls.at(-1))===JSON.stringify([id,pieceId]),'Precast '+status+' exact project/piece click')}
   }
   for(const status of ['pre-ready','final-needed','hold']){
    p.status=status;renderQC();inert('QC '+status);for(const b of root.querySelectorAll('[data-qc-pass],[data-qc-hold],[data-release-hold]')){b.click();check(JSON.stringify(calls.at(-1))===JSON.stringify([id,pieceId]),'QC '+status+' exact project/piece click')}
   }
   p.status='final-needed';p.pouredDate='2026-10-19';renderPrecast('boxes');inert('Precast completed');const undo=root.querySelector('[data-undo-production]');check(Boolean(undo),'Precast completion undo present');undo.click();check(JSON.stringify(calls.at(-1))===JSON.stringify([id,pieceId]),'Precast undo exact project/piece click');
   return {checks,executions:window.syntheticExecutions};
  }finally{
   state=original.state;wallsProduction=original.wallsProduction;wallsInstallation=original.wallsInstallation;wallsInstallationReady=original.wallsInstallationReady;currentUserIsAdmin=original.currentUserIsAdmin;openWallsInstallationIssueForm=original.openWallsInstallationIssueForm;moveWallMilestone=original.moveWallMilestone;markPreReady=original.markPreReady;markPoured=original.markPoured;openPieceModal=original.openPieceModal;passQC=original.passQC;holdQC=original.holdQC;releaseHold=original.releaseHold;undoProductionCompletion=original.undoProductionCompletion;quickCompleteWall=original.quickCompleteWall;moveDelivery=original.moveDelivery;closeProductionModal();
  }
 });
 assert.equal(result.executions,0);assert.ok(result.checks.length>=30);return result.checks;
}
