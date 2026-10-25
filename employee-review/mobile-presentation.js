// DEMO-ONLY presentation candidate, based on the user's four phone screenshots.
// No data/client/auth changes. Original renderers are preserved for desktop/admin.
const employeeMobileQuery=window.matchMedia('(max-width:1000px)');
function employeeMobilePresentationActive(){return employeeMobileQuery.matches&&!currentUserIsAdmin}
function employeeMobileDisclosure(id,label,nodes){
  const details=document.createElement('details');details.id=id;details.className='employee-mobile-details';
  const summary=document.createElement('summary');summary.textContent=label;details.append(summary);
  const content=document.createElement('div');content.className='employee-mobile-details-body';content.append(...nodes);details.append(content);
  return details;
}
function employeeMobileProductionPresentation(){
  if(!employeeMobilePresentationActive())return;
  const root=document.getElementById('view'),shell=root.querySelector('.production-shell'),work=shell?.querySelector('.production-columns'),totals=shell?.querySelector('.production-kpis');
  if(!shell||!work||!totals||shell.querySelector('#employeeProductionTotals'))return;
  work.id='employeeProductionWork';
  const description=shell.querySelector('.production-heading p');
  if(description)description.textContent=fmt(normalizeDate(state.productionDay)||todayISO())+' · Planned work is not completed work.';
  // Move the real totals after every work/queue section: visual and keyboard order agree.
  const disclosure=employeeMobileDisclosure('employeeProductionTotals','Production totals',[totals]);
  shell.append(disclosure);
}
function employeeMobileInventoryPresentation(){
  if(!employeeMobilePresentationActive()||!inventoryReady)return;
  const shell=document.querySelector('#view .inventory-shell');if(!shell)return;
  // The persistent sample identity is in the sticky banner; this screen needs one title.
  const heading=shell.querySelector('.inventory-heading');
  if(heading){const title=heading.querySelector('h2'),description=heading.querySelector('p');if(title)title.textContent='Inventory';if(description)description.textContent='Check sample stock. No count changes are saved.'}
  const catalog=shell.querySelector('#inventoryCatalog'),catalogHead=catalog?.querySelector('.inventory-section-head>div');
  if(catalogHead){const title=catalogHead.querySelector('h3'),description=catalogHead.querySelector('small');if(title)title.textContent='Materials';if(description)description.textContent='Open a count to preview the form.'}
  const search=shell.querySelector('#inventorySearch');if(search)search.placeholder='Search materials';
  if(shell.querySelector('#employeeInventoryTotals'))return;
  const stats=shell.querySelector('.inventory-stats');if(!stats)return;
  const summaries=[stats,...shell.querySelectorAll('.inventory-section.watch,.inventory-section.low-watch')];
  const reorder=inventoryItems.filter(item=>inventoryStatus(item)==='reorder').length,low=inventoryItems.filter(item=>inventoryStatus(item)==='low').length;
  const disclosure=employeeMobileDisclosure('employeeInventoryTotals',`Stock summary · ${reorder} reorder · ${low} low`,summaries);
  // Search and item counts come before optional rollups on a small screen.
  if(catalog)catalog.after(disclosure);else shell.append(disclosure);
}
function employeeMobileCrewPresentation(){
  if(!employeeMobilePresentationActive())return;
  const shell=document.querySelector('#view .planner-shell');if(!shell)return;
  const heading=shell.querySelector('.planner-heading');
  if(heading){const title=heading.querySelector('h2'),description=heading.querySelector('p');if(title)title.textContent='Crew schedules';if(description)description.textContent='Approved only · Not personal assignments.'}
  const note=shell.querySelector(':scope > .phone-schedule-note');
  if(note&&!shell.querySelector('#employeeCrewDetails'))shell.append(employeeMobileDisclosure('employeeCrewDetails','Schedule details',[note]));
  shell.querySelectorAll('[data-employee-crew-read]').forEach(button=>{button.textContent='Read schedule'});
  const refresh=shell.querySelector('#employeeCrewRefresh');if(refresh&&refresh.textContent==='Refresh approved schedules')refresh.textContent='Refresh';
}
const employeeOriginalProductionToday=renderWallsProductionToday;
renderWallsProductionToday=function(){employeeOriginalProductionToday();employeeMobileProductionPresentation()};
const employeeOriginalInventory=renderInventory;
renderInventory=function(options={}){employeeOriginalInventory(options);employeeMobileInventoryPresentation()};
const employeeOriginalCrew=renderEmployeeCrewSchedules;
renderEmployeeCrewSchedules=function(){employeeOriginalCrew();employeeMobileCrewPresentation()};
function employeeSyncMobilePresentation(){
  const mobile=employeeMobilePresentationActive(),banner=document.getElementById('employeeDemoBanner');
  document.body.classList.toggle('employee-mobile-polish',mobile);
  if(banner)banner.open=!mobile;
}
const employeeOriginalDemoReset=demoReset;
demoReset=function(){const pending=employeeOriginalDemoReset();employeeSyncMobilePresentation();return pending};
employeeSyncMobilePresentation();
employeeMobileQuery.addEventListener('change',()=>{
  employeeSyncMobilePresentation();
  // Re-render from the unmodified original markup when crossing the breakpoint.
  // Native details never duplicate controls; no extra service call or save is added.
  render();demoApplyReadOnlyControls();
});
