// Test-only provider shim. All reads/writes are forwarded to real disposable SQL.
// No Supabase Auth/password/JWT verification or Realtime behavior is claimed.
window.SUPERIOR_CONFIG={supabaseUrl:'http://disposable.invalid',supabaseAnonKey:'synthetic-not-a-key'};
window.supabase={createClient(){
 const users={reader:{id:'00000000-0000-4000-8000-000000000119',email:'test-hub-reader@superiorwallsnd.com'},admin:{id:'00000000-0000-4000-8000-000000000001',email:'test-admin@superiorwallsnd.com'},viewer:{id:'00000000-0000-4000-8000-000000000002',email:'test-viewer@superiorwallsnd.com'},outsider:{id:'00000000-0000-4000-8000-000000000003',email:'test-outsider@superiorwallsnd.com'}};
 let callbacks=[];
 const session=()=>users[sessionStorage.testIdentity]?{user:users[sessionStorage.testIdentity],access_token:'synthetic-not-a-jwt'}:null;
 const request=async(path,body)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Test-Identity':sessionStorage.testIdentity||''},body:JSON.stringify(body)}).then(r=>r.json());
 return {
  rpc:(name,args={})=>request('/rpc',{name,args}),
  from(table){const q={table,filters:[]};const chain={select(columns){q.columns=columns;return chain},eq(...x){q.filters.push(['eq',...x]);return chain},in(...x){q.filters.push(['in',...x]);return chain},not(...x){q.filters.push(['not',...x]);return chain},order(...x){q.order=x;return chain},limit(n){q.limit=n;return chain},single(){q.single=true;return chain},maybeSingle(){q.single=true;return chain},then(a,b){return request('/query',q).then(a,b)}};return chain},
  channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel:async()=>{},
  auth:{
   getSession:async()=>({data:{session:session()},error:null}),
   onAuthStateChange(cb){callbacks.push(cb);return {data:{subscription:{unsubscribe(){callbacks=callbacks.filter(x=>x!==cb)}}}}},
   async signInWithPassword({email,password}){const key=Object.keys(users).find(k=>users[k].email===email);if(!key||password!=='disposable-only')return {error:{message:'Synthetic test sign-in rejected'}};sessionStorage.testIdentity=key;for(const cb of callbacks)await cb('SIGNED_IN',session());return {data:{session:session()},error:null}},
   async signOut(){sessionStorage.removeItem('testIdentity');for(const cb of callbacks)await cb('SIGNED_OUT',null);return {error:null}}
  }
 };
}};
