// Fixed native Auth/PostgREST adapter. No provider, credential dumps, retries,
// sessions, direct auth.users writes or password persistence.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES=131072;
const failure=()=>new Error('Native operation could not be verified.');
async function boundedJson(response){
  if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw failure();
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BYTES)||!response.body)throw failure();
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw failure();}parts.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function identity(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw failure();
  const allowed=['id','email','is_anonymous','is_sso_user','app_metadata','identities','email_confirmed_at','last_sign_in_at','recovery_sent_at','new_email','email_change','factors','banned_until','deleted_at'];
  return Object.fromEntries(allowed.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
}
export function createNativeAdapters(config,fetchImpl){
  if(!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.authOrigin)
    ||!/^[-_a-zA-Z0-9]+\.[-_a-zA-Z0-9]+\.[-_a-zA-Z0-9]+$/.test(config.serverKey??'')||typeof fetchImpl!=='function')throw failure();
  return make(config,fetchImpl);
}
export function createSyntheticAdapters(config,fetchImpl){
  if(config.authOrigin!=='https://auth.example.invalid'||config.serverKey!=='synthetic-server-key'||config.publicKey!=='synthetic-public-key')throw failure();
  return make(config,fetchImpl);
}
function make(config,fetchImpl){
  async function request(path,{body,method=body===undefined?'GET':'POST',caller}={}){
    let response;
    try{
      const key=caller?config.publicKey:config.serverKey;
      response=await fetchImpl(config.authOrigin+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:key,authorization:'Bearer '+(caller??key),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:response.status,data:await boundedJson(response)};
    }catch{try{await response?.body?.cancel();}catch{}throw failure();}
  }
  async function success(path,options){const r=await request(path,options);if(r.status<200||r.status>=300)throw failure();return r.data;}
  const rpc=(name,body={})=>success('/rest/v1/rpc/employee_password_'+name,{body});
  return {
    preflight:()=>rpc('preflight'),readiness:()=>rpc('readiness'),
    authenticate:async token=>identity(await success('/auth/v1/user',{caller:token})),
    isOwner:owner=>rpc('is_owner',{p_owner_id:owner}),
    operations:{
      prepare:(owner,c)=>rpc('prepare',{p_owner_id:owner,p_record_id:c.record_id,p_expected_version:c.expected_version,p_request_id:c.request_id,p_action:c.action}),
      consume:(owner,c,kid)=>rpc('consume',{p_owner_id:owner,p_challenge_id:c.challenge_id,p_record_id:c.record_id,p_expected_version:c.expected_version,p_action:c.action,p_audience:c.aud,p_key_id:kid}),
      finish:(owner,op,phase)=>rpc('finish',{p_owner_id:owner,p_operation_id:op,p_phase:phase}),
    },
    authAdmin:{
      getUserById:async uid=>{if(!UUID.test(uid))throw failure();return identity(await success('/auth/v1/admin/users/'+uid));},
      updatePassword:async(uid,password,initialize)=>{
        if(!UUID.test(uid)||typeof password!=='string'||typeof initialize!=='boolean')throw failure();
        // Only this documented pre-mutation validation rejection permits a new
        // owner attempt. Other status/body combinations remain unknown/locked.
        const r=await request('/auth/v1/admin/users/'+uid,{method:'PUT',body:initialize?{password,email_confirm:true}:{password}});
        if(r.status===422&&r.data?.code==='weak_password')return {kind:'weak_password'};
        if(r.status<200||r.status>=300)throw failure();
        return {kind:'updated',user:identity(r.data)};
      },
    },
  };
}
