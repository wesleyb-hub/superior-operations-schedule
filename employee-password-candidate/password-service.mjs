import {decryptCommand} from './server-crypto.mjs';
import {MAX_ENVELOPE_BYTES} from './browser-crypto.mjs';
import {isRestrictedPilot,matchesExistingEmailIdentity} from './identity.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECORD=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const BASE_FIELDS=['v','kind','aud','owner_uid','owner_token','record_id','target_uid','expected_version','action','request_id','iat','exp','confirm_email'];
const exact=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).sort().join(',')===[...keys].sort().join(',');
const empty=value=>value===undefined||value===null||value==='';
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
function response(code,status,operation){
  const value={status};if(UUID.test(operation??''))value.operation_id=operation;
  return new Response(JSON.stringify(value),{status:code,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
}
export const disabledResponse=()=>response(503,'not_configured');
async function readEnvelope(request){
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_ENVELOPE_BYTES))throw Error();
  if(!request.body)throw Error();
  const reader=request.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_ENVELOPE_BYTES){await reader.cancel();throw Error();}parts.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
function validCommand(value,policy,now){
  const applying=value?.kind==='apply';
  return exact(value,applying?[...BASE_FIELDS,'challenge_id','password']:BASE_FIELDS)
    &&value.v===1&&['prepare','apply'].includes(value.kind)&&value.aud===policy.audience
    &&UUID.test(value.owner_uid??'')&&UUID.test(value.target_uid??'')&&UUID.test(value.request_id??'')
    &&RECORD.test(value.record_id??'')&&Number.isSafeInteger(value.expected_version)&&value.expected_version>0
    &&typeof value.owner_token==='string'&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.owner_token)&&value.owner_token.length<=6144
    &&['initialize','reset'].includes(value.action)&&value.confirm_email===(value.action==='initialize')
    &&Number.isSafeInteger(value.iat)&&Number.isSafeInteger(value.exp)&&value.iat<=now+5
    &&value.iat>=now-65&&value.exp>now&&value.exp<=value.iat+60&&value.exp>value.iat
    &&(!applying||UUID.test(value.challenge_id??'')&&typeof value.password==='string'
      &&value.password.length>=8&&value.password.length<=128&&!/[\u0000]/.test(value.password));
}
function recordMatches(record,command,policy){
  return record?.record_id===command.record_id&&record.auth_uid===command.target_uid&&record.version===command.expected_version
    &&/^[a-z][a-z0-9._-]{2,31}$/.test(record.username??'')&&record.auth_email===`${record.username}@${policy.identifierDomain}`
    &&record.setup_completed===(command.action==='reset')&&isRestrictedPilot(record.effective_scope);
}
export function allowedNativeState(user,action){
  if(!user||!empty(user.deleted_at)||!empty(user.banned_until)||!empty(user.new_email)||!empty(user.email_change)
    ||!(user.factors===undefined||user.factors===null||Array.isArray(user.factors)&&user.factors.length===0))return false;
  return action==='initialize'?empty(user.email_confirmed_at)&&empty(user.last_sign_in_at)&&empty(user.recovery_sent_at):timestamp(user.email_confirmed_at);
}
export function createPasswordHandler(deps,policy){
  try{
    const auth=new URL(policy.authOrigin),hub=new URL(policy.hubOrigin);
    if(policy.enabled!==true||hub.origin!==policy.hubOrigin||hub.protocol!=='https:'
      ||!/^employee-password-[a-z0-9-]{1,48}$/.test(policy.keyId??'')||!Number.isFinite(Date.parse(policy.keyNotAfter))
      ||policy.audience!==auth.origin+'/functions/v1/employee-password'||policy.authOrigin!==auth.origin
      ||!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(policy.identifierDomain??'')
      ||!(policy.mode==='production'&&/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(policy.authOrigin)
        ||policy.mode==='synthetic-local'&&policy.authOrigin==='https://auth.example.invalid'&&policy.hubOrigin==='https://hub.example.invalid'&&policy.identifierDomain==='company.example.invalid'))return async()=>disabledResponse();
  }catch{return async()=>disabledResponse();}
  const now=()=>deps.now?.()??Date.now();
  return async request=>{
    let command,actor,operation,record,nativeBefore;
    const uncertain=async()=>{if(operation){try{await deps.operations.finish(actor,operation,'needs_review');}catch{}}return response(409,'needs_review',operation);};
    try{
      if(request.method!=='POST')return response(405,'method_not_allowed');
      if(request.headers.get('origin')!==policy.hubOrigin)return response(403,'blocked');
      // Never accept a native owner token in a gateway-visible outer header.
      if(request.headers.has('authorization')||request.headers.get('apikey')!==policy.publicKey)return response(403,'blocked');
      if(!/^application\/jose(?:\s*;|$)/i.test(request.headers.get('content-type')??''))return response(400,'invalid_request');
      if(Date.parse(policy.keyNotAfter)<=now()||Date.parse(policy.keyNotAfter)>now()+31*86400000)return disabledResponse();
      if(await deps.preflight()!==true)return response(429,'blocked');
      let envelope;try{envelope=await readEnvelope(request);}catch{return response(400,'invalid_request');}
      try{command=await decryptCommand(envelope,await deps.privateKey,policy.keyId);}catch{return response(400,'invalid_request');}
      envelope='';
      if(!validCommand(command,policy,Math.floor(now()/1000)))return response(400,'invalid_request');
      let owner;try{owner=await deps.authenticate(command.owner_token);}catch{return response(401,'not_authorized');}
      if(owner?.id!==command.owner_uid||owner.is_anonymous!==false||await deps.isOwner(owner.id)!==true)return response(403,'blocked');
      actor=owner.id;
      const ready=await deps.readiness();
      if(ready?.enabled!==true||ready.current_key_id!==policy.keyId||ready.audience!==policy.audience||ready.identifier_domain!==policy.identifierDomain)return disabledResponse();
      if(command.exp<=Math.floor(now()/1000)||Date.parse(policy.keyNotAfter)<=now())return response(409,'blocked');
      if(command.kind==='prepare'){
        const prepared=await deps.operations.prepare(actor,command);
        if(prepared?.kind!=='prepared'&&prepared?.kind!=='replay'||!UUID.test(prepared?.challenge_id??'')
          ||prepared.phase!=='prepared'||prepared.audience!==policy.audience||prepared.key_id!==policy.keyId
          ||!timestamp(prepared.expires_at)||Date.parse(prepared.expires_at)<=now()||Date.parse(prepared.expires_at)>now()+121000
          ||!recordMatches(prepared.record,command,policy))return response(409,'blocked');
        const user=await deps.authAdmin.getUserById(command.target_uid);
        if(!matchesExistingEmailIdentity(user,prepared.record)||!allowedNativeState(user,command.action))return response(409,'blocked');
        if(command.exp<=Math.floor(now()/1000)||Date.parse(policy.keyNotAfter)<=now())return response(409,'blocked');
        return new Response(JSON.stringify({status:'prepared',challenge_id:prepared.challenge_id,expires_at:prepared.expires_at}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
      }
      // Native check precedes the final atomic DB claim. The DB independently
      // checks current owner, exact target/version/grants/challenge in consume.
      nativeBefore=await deps.authAdmin.getUserById(command.target_uid);
      if(!allowedNativeState(nativeBefore,command.action))return response(409,'blocked');
      if(command.exp<=Math.floor(now()/1000)||Date.parse(policy.keyNotAfter)<=now())return response(409,'blocked');
      const consumed=await deps.operations.consume(actor,command,policy.keyId);
      if(consumed?.kind!=='applying'||!UUID.test(consumed.operation_id??''))return response(409,'blocked');
      operation=consumed.operation_id;record=structuredClone(consumed.record);
      if(!recordMatches(record,command,policy)||!matchesExistingEmailIdentity(nativeBefore,record))return uncertain();
      if(command.exp<=Math.floor(now()/1000)||Date.parse(policy.keyNotAfter)<=now())return uncertain();
      // One exact-UID native write; no retry, lookup-by-email, role or grant write.
      const outcome=await deps.authAdmin.updatePassword(record.auth_uid,command.password,command.action==='initialize');
      command.password='';command.owner_token='';
      if(outcome?.kind==='weak_password'){
        if(await deps.operations.finish(actor,operation,'rejected')!==true)return uncertain();
        return response(422,'invalid_password',operation);
      }
      const user=outcome?.user;
      if(outcome?.kind!=='updated'||!matchesExistingEmailIdentity(user,record)||!timestamp(user.email_confirmed_at)
        ||command.action==='reset'&&user.email_confirmed_at!==nativeBefore.email_confirmed_at)return uncertain();
      if(await deps.operations.finish(actor,operation,'applied')!==true)return uncertain();
      return response(200,'applied',operation);
    }catch{return operation?uncertain():response(409,'blocked');}
    finally{if(command){command.password='';command.owner_token='';}command=null;nativeBefore=null;record=null;}
  };
}
