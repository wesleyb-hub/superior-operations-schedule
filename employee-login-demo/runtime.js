// SYNTHETIC-ONLY UI adapter. No real Auth, network, storage or password persistence.
(()=>{
  'use strict';
  const fixture=window.EMPLOYEE_LOGIN_DEMO_FIXTURES;
  const user={id:'00000000-0000-4000-8000-000000000101',email:'sample-employee@managed.example.invalid'};
  const owner={id:'synthetic-owner-ui-only',email:'sample-owner@superiorwallsnd.com'};
  let session=window.EMPLOYEE_OWNER_DEMO?{access_token:'synthetic-owner-token',refresh_token:'synthetic-owner-refresh',user:owner}:null,authHandler=()=>{};
  const counts={signIn:0,redeem:0,install:0,ownerIssue:0,ownerList:0,signOut:0,rpc:[]};
  const control={delay:0,failNext:false,managedEnabled:true,managedStatus:'active',ownerDenied:false,resetDone:false,username:null};
  window.employeeLoginDemoControl=control;
  window.employeeLoginDemoStatus=()=>({counts:structuredClone(counts),hasSession:!!session,resetDone:control.resetDone,username:control.username});
  const clone=value=>structuredClone(value),wait=()=>new Promise(resolve=>setTimeout(resolve,control.delay));
  const scopes=[{division_key:'walls',inventory_area:'production',can_view:true,can_adjust:true,can_manage:false}];
  const reads={
    get_employee_login_access(){return {managed:true,enabled:control.managedEnabled,status:control.managedStatus,username:control.username||'sample-employee'}},
    get_app_access(){return {authorized:true,profile_key:'walls_inventory_counter',can_write:false,is_admin:false,allowed_views:['overview','walls','inventory','weekly-planner'],allowed_wall_subviews:['production']}},
    get_schedule_snapshot(){return {id:1,revision:1,updated_at:'2026-10-26T12:00:00Z',payload:{schemaVersion:28,data:{walls:fixture.walls,jobs:[],billing:[],audit:[],historyArchive:[],deliveryHistory:[],qcHistory:[],loads:[]}}}},
    get_walls_production_snapshot(){return {full_read_access:false,permissions:{view:true,assign:false,plan:false,manage:false,issue:false,setup:false,pour:false,strip:false},tables:fixture.tables,jobs:fixture.walls.map(w=>({...w,assignedLf:w.totalLf,releaseStatus:'Released for Production',documentLinks:[]})),assignments:fixture.assignments,issues:[],events:[]}},
    get_walls_production_weekly_forecast(){return {currentPlannedLf:200,actualPouredLf:80,baseline:null,assignments:fixture.assignments.map(a=>({assignmentId:a.assignment_id,job:fixture.walls.find(w=>w.id===a.wall_record_id).job,model:'Sample foundation',tableLabel:fixture.tables.find(t=>t.table_id===a.table_id).label,wallHeight:a.wall_height,plannedLf:a.planned_lf,actualLf:a.actual_poured_lf,plannedPourDate:a.pour_at.slice(0,10),actualPourDate:a.actual_poured_lf?a.pour_at.slice(0,10):''})),daily:[{date:fixture.day,plannedLf:200,actualLf:80}]}},
    get_inventory_scopes(){return scopes},
    get_inventory_snapshot(){return {division_key:'walls',inventory_area:'production',full_read_access:false,items:fixture.inventory,events:[]}},
    get_employee_approved_crew_packs(){return fixture.crew}
  };
  const deny=()=>{throw Error('Synthetic review: live writes and unknown reads are unavailable')};
  const client={
    auth:{
      onAuthStateChange(handler){authHandler=handler;return {data:{subscription:{unsubscribe(){}}}}},
      async getSession(){return {data:{session},error:null}},
      async getUser(){return {data:{user:session?.user||null},error:null}},
      async setSession(){counts.install++;await wait();session={access_token:'synthetic-employee-token',refresh_token:'synthetic-employee-refresh',user};void authHandler('SIGNED_IN',session);return {data:{session},error:null}},
      async signInWithPassword(){counts.signIn++;session={access_token:'synthetic-email-token',refresh_token:'synthetic-email-refresh',user:owner};void authHandler('SIGNED_IN',session);return {data:{session},error:null}},
      async resetPasswordForEmail(){return {data:{},error:null}},
      async updateUser(){return {data:{user:session?.user},error:null}},
      async signOut(){counts.signOut++;session=null;void authHandler('SIGNED_OUT',null);return {error:null}}
    },
    async rpc(name,args){counts.rpc.push(name);if(!reads[name])return deny();return {data:clone(reads[name](args)),error:null}},
    from:deny,functions:{invoke:deny},storage:new Proxy({},{get:()=>deny}),
    channel(){return {on(){return this},subscribe(){return this}}},async removeChannel(){}
  };
  window.supabase={createClient:()=>client};
  window.SUPERIOR_CONFIG={supabaseUrl:'https://employee-demo.invalid',supabaseAnonKey:'synthetic-publishable-not-a-key',allowedEmailDomain:'superiorwallsnd.com',employeeUsernameLoginEnabled:true};
  window.fetch=async (url,options)=>{
    if(url!=='https://employee-demo.invalid/functions/v1/employee-access')return deny();
    const body=JSON.parse(options.body);await wait();
    if(control.failNext){control.failNext=false;return {ok:false,status:400,json:async()=>({error:'Request not confirmed'})}}
    if(body.action==='sign-in'){counts.signIn++;if(!control.username||body.username!==control.username)return {ok:false,json:async()=>({error:'Request not confirmed'})};return {ok:true,json:async()=>({session:{access_token:'synthetic-employee-token',refresh_token:'synthetic-employee-refresh'}})}}
    if(body.action==='redeem'){counts.redeem++;if(control.username&&body.username!==control.username)return {ok:false,json:async()=>({error:'Request not confirmed'})};control.username=body.username;control.resetDone=true;return {ok:true,json:async()=>({ok:true})}}
    if(body.action==='owner-list'){counts.ownerList++;return {ok:!control.ownerDenied,json:async()=>({employees:[{username:control.username,user_id:user.id,display_name:'Sample employee',status:control.username?'active':'pending',enabled:true,setup_completed:!!control.username}]})}}
    if(body.action==='owner-issue'){counts.ownerIssue++;return {ok:!control.ownerDenied&&body.employeeId===user.id,json:async()=>({employeeId:user.id,username:control.username,setupCompleted:!!control.username,code:'DEMO-ONLY-CODE-HERE',expires_at:new Date(Date.now()+600000).toISOString()})}}
    return deny();
  };
  // No password/code is retained by the fake provider. A synthetic form submission is not an Auth test.
})();
