// Entirely invented sample data. No operational data or account identifiers.
export const fixtures = {
  day: '2026-10-26', week: '2026-10-26',
  identity: {id:'demo-employee-not-an-account'},
  walls: [
    {id:'demo-wall-a',job:'DEMO — Sample foundation A',customer:'Sample customer A',model:'Sample foundation',address:'Sample site A',totalLf:120,productionDate:'2026-10-26',status:'Scheduled',links:[]},
    {id:'demo-wall-b',job:'DEMO — Sample foundation B',customer:'Sample customer B',model:'Sample foundation',address:'Sample site B',totalLf:80,productionDate:'2026-10-26',status:'Scheduled',links:[]}
  ],
  tables:[{table_id:'demo-table-a',label:'Sample table A',capacity_lf:150,version:1},{table_id:'demo-table-b',label:'Sample table B',capacity_lf:150,version:1}],
  assignments:[
    {assignment_id:'demo-run-a',wall_record_id:'demo-wall-a',table_id:'demo-table-a',stage:'setup_in_progress',planned_lf:120,actual_poured_lf:0,wall_height:8,setup_progress:50,setup_start_at:'2026-10-26T06:00',pour_at:'2026-10-26T12:00',strip_at:'2026-10-27T06:00',notes:'DEMO — Sample setup work. No live job.',version:1},
    {assignment_id:'demo-run-b',wall_record_id:'demo-wall-b',table_id:'demo-table-b',stage:'curing',planned_lf:80,actual_poured_lf:80,wall_height:8,setup_progress:100,setup_start_at:'2026-10-26T06:00',pour_at:'2026-10-26T10:00',strip_at:'2026-10-27T06:00',pre_pour_ready:true,notes:'DEMO — Sample recorded pour, not a real completion.',version:1}
  ],
  inventory:[
    {item_id:1,titan_code:'DEMO-MATERIAL-A',description:'Sample reinforcing material',category:'Sample materials',unit:'pieces',quantity:20,reorder_threshold:5,ordered:false,version:1},
    {item_id:2,titan_code:'DEMO-MATERIAL-B',description:'Sample fastening material',category:'Sample materials',unit:'boxes',quantity:2,reorder_threshold:5,ordered:false,version:1},
    {item_id:3,titan_code:'DEMO-MATERIAL-C',description:'Sample packing material',category:'Sample supplies',unit:'bundles',quantity:6,reorder_threshold:5,ordered:false,version:1}
  ],
  crew:{permissions:{view:true,edit:false,approve:false,publish:false},packs:[{
    pack_id:'demo-approved-pack',week_start:'2026-10-26',pack_version:3,is_active:true,published_at:'2026-10-26T12:00:00Z',
    snapshot:{week_start:'2026-10-26',week_end:'2026-10-30',sections:[{
      section:{section_key:'walls_production',section_name:'Sample Walls Production',status:'approved',sort_order:1,crew_leader:'Sample crew leader'},
      people:[{employee_name:'Sample team member'}],
      assignments:[{work_date:'2026-10-26',project_location:'Sample site A',assignment_text:'DEMO — Read the sample production schedule. This is not a personal assignment.',start_time:'08:00',status_hold:'Sample instructions only; confirm real work with a supervisor.',backup_instructions:'No real crew access is granted by this demo.'}]
    }]}
  }]}
};
