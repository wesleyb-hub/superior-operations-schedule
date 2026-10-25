// Runs only inside the opaque sandboxed srcdoc. Never touches parent or persistent storage.
let demoResetCount=0,demoDeniedMutationCount=0;
function createDemoClient(){
  const cloneData=value=>JSON.parse(JSON.stringify(value));
  const refuse=()=>{demoDeniedMutationCount++;throw new Error('DEMO: only the allowlisted synthetic reads are available. No saves or live connections.')};
  const denied=new Proxy(Object.freeze({}),{get:()=>refuse});
  const scopes=[{division_key:'walls',inventory_area:'production',can_view:true,can_adjust:true,can_manage:false}];
  const reads={
    get_walls_production_snapshot(args){
      if(!args||typeof args.p_from!=='string'||typeof args.p_to!=='string')return refuse();
      return {full_read_access:false,permissions:{assign:false,plan:false,manage:false,issue:false,setup:false,pour:false,strip:false},tables:DEMO_FIXTURES.tables,jobs:DEMO_FIXTURES.walls.map(w=>({...w,assignedLf:w.totalLf,releaseStatus:'Released for Production',documentLinks:[]})),assignments:DEMO_FIXTURES.assignments,issues:[],events:[]};
    },
    get_walls_production_weekly_forecast(args){
      if(!args||typeof args.p_week_start!=='string')return refuse();
      const rows=args.p_week_start===DEMO_FIXTURES.week?DEMO_FIXTURES.assignments:[];
      return {currentPlannedLf:rows.reduce((n,a)=>n+a.planned_lf,0),actualPouredLf:rows.reduce((n,a)=>n+a.actual_poured_lf,0),baseline:null,
        assignments:rows.map(a=>({assignmentId:a.assignment_id,job:DEMO_FIXTURES.walls.find(w=>w.id===a.wall_record_id).job,model:'Sample foundation',tableLabel:DEMO_FIXTURES.tables.find(t=>t.table_id===a.table_id).label,wallHeight:a.wall_height,plannedLf:a.planned_lf,actualLf:a.actual_poured_lf,plannedPourDate:a.pour_at.slice(0,10),actualPourDate:a.actual_poured_lf?a.pour_at.slice(0,10):''})),
        daily:rows.length?[{date:DEMO_FIXTURES.day,plannedLf:200,actualLf:80}]:[]};
    },
    get_inventory_scopes(args){if(args&&Object.keys(args).length)return refuse();return scopes},
    get_inventory_snapshot(args){if(args?.p_division_key!=='walls'||args?.p_inventory_area!=='production')return refuse();return {division_key:'walls',inventory_area:'production',full_read_access:false,items:DEMO_FIXTURES.inventory,events:[]}},
    get_employee_approved_crew_packs(args){if(!args||typeof args.p_week_start!=='string')return refuse();return args.p_week_start===DEMO_FIXTURES.week?DEMO_FIXTURES.crew:{permissions:{view:true},packs:[]}}
  };
  return Object.freeze({
    async rpc(name,args){if(!Object.hasOwn(reads,name))return refuse();return {data:cloneData(reads[name](args)),error:null}},
    from:refuse,auth:denied,functions:denied,storage:denied,channel:refuse,removeChannel:refuse
  });
}
function demoNoSave(){demoDeniedMutationCount++;showInventoryToast('DEMO — No saves. Sample data is unchanged.');return false}
function demoApplyReadOnlyControls(){
  document.querySelectorAll('[data-inv-action="minus"],[data-inv-action="plus"],[data-prod-print]').forEach(button=>{button.disabled=true;button.title='Disabled in the read-only sample demo'});
  const save=document.getElementById('inventoryModalSave');if(save){save.disabled=true;save.textContent='Demo — saving disabled';save.title='No sample or real counts can be saved'}
  for(const id of ['assistantLaunch','refreshLiveBtn','signOutBtn','exportBtn','resetBtn','importHeaderBtn','addBtn']){const node=document.getElementById(id);if(node){node.hidden=true;node.disabled=true}}
  document.querySelectorAll('a').forEach(node=>{node.removeAttribute('href');node.removeAttribute('target')});
}
async function demoReset(){
  demoResetCount++;
  resetLocalSession();
  currentUser=Object.freeze({...DEMO_FIXTURES.identity});currentUserAuthorized=true;currentUserIsAdmin=false;currentUserCanWrite=false;currentUserRole='synthetic_demo';
  currentAllowedViews=['today','overview','walls','inventory','weekly-planner'];currentAllowedWallSubviews=['production'];hubSessionLocked=false;
  state={...clone(seed),view:'today',role:'Production',week:DEMO_FIXTURES.week,year:2026,productionDay:DEMO_FIXTURES.day,productionView:'today',weeklyPlannerView:'approved',walls:clone(DEMO_FIXTURES.walls),jobs:[]};
  inventoryScopeKey='walls-production';inventorySearch='';inventoryFilter='all';inventoryCategory='all';
  ensureState();remoteReady=false;applyAccessNavigation();
  document.getElementById('accessStatus').textContent='Sample employee view';document.getElementById('saveStatus').textContent='No live connections · No saves';
  closeOperationsNav();document.body.classList.remove('mobile-tools-open');render();scrollTo(0,0);
  await Promise.all([loadInventory(),loadWallsProduction()]);
  demoApplyReadOnlyControls();
}
// Demo-only clock: Today/current week stay on the visibly labeled sample week.
todayISO=()=>DEMO_FIXTURES.day;
currentWeekISO=()=>DEMO_FIXTURES.week;
// Demo-only overrides: navigation is in memory; mutation wrappers cannot write even if called directly.
saveUiPrefs=()=>{};
saveState=()=>true;
loadRemoteState=async()=>false;
persistState=async()=>false;
inventoryRpc=wallsProductionRpc=wallsInstallationRpc=saveOperationalModal=async()=>demoNoSave();
updateInventoryQuantity=async()=>demoNoSave();
printCurrent=()=>demoNoSave();
const demoOriginalInventoryModal=openInventoryModal;
openInventoryModal=function(title,sub,body,saveLabel,onSave){demoOriginalInventoryModal(title,'DEMO — sample only. No changes can be saved. '+sub,body,saveLabel,null);inventoryModalSaveAction=null;demoApplyReadOnlyControls()};
// Cancel is always safe in this read-only form; no save may be pending or uncertain.
const demoOriginalModalClose=requestOperationalModalClose;
requestOperationalModalClose=function(kind,backdrop=false){if(kind==='inventory'){closeInventoryModal();return true}return demoOriginalModalClose(kind,backdrop)};
document.addEventListener('submit',event=>{event.preventDefault();event.stopImmediatePropagation()},true);
document.addEventListener('click',event=>{const target=event.target.closest?.('a,[data-inv-action="minus"],[data-inv-action="plus"],#inventoryModalSave,[data-prod-print]');if(target){event.preventDefault();event.stopImmediatePropagation()}},true);
const demoObserver=new MutationObserver(()=>demoApplyReadOnlyControls());
demoObserver.observe(document.getElementById('view'),{childList:true,subtree:true});
document.getElementById('employeeDemoReset').onclick=()=>void demoReset();
document.getElementById('currentWeekBtn').textContent='Sample week';
document.getElementById('currentWeekBtn').onclick=()=>{state.week=DEMO_FIXTURES.week;state.year=2026;render()};
demoReset();

window.employeeDemoStatus=()=>({fixtureRevision:'employee-demo-20261025-v1',resetCount:demoResetCount,deniedMutationCount:demoDeniedMutationCount,counts:inventoryItems.map(item=>({code:item.code,qty:item.qty})),sampleOnly:true});
