import {createPasswordHandler,disabledResponse} from './password-service.mjs';
import {privateKeyFromPem} from './server-crypto.mjs';
import {createNativeAdapters} from './server-adapters.mjs';
function defaultKey(raw,prefix){
  const keys=JSON.parse(raw);
  if(!keys||typeof keys!=='object'||Array.isArray(keys)||!Object.hasOwn(keys,'default')
    ||typeof keys.default!=='string'||!new RegExp('^'+prefix+'[A-Za-z0-9_-]{16,512}$').test(keys.default))throw Error('Native key configuration unavailable.');
  return keys.default;
}
export function configuredPasswordHandler(readEnv,fetchImpl){
  if(readEnv('EMPLOYEE_PASSWORD_ENABLED')!=='true')return async()=>disabledResponse();
  try{
    const config={enabled:true,mode:'production',authOrigin:readEnv('SUPABASE_URL'),hubOrigin:readEnv('EMPLOYEE_PASSWORD_HUB_ORIGIN'),audience:readEnv('EMPLOYEE_PASSWORD_AUDIENCE'),identifierDomain:readEnv('EMPLOYEE_PASSWORD_IDENTIFIER_DOMAIN'),publicKey:readEnv('EMPLOYEE_PASSWORD_INGRESS_API_KEY'),serverKey:defaultKey(readEnv('SUPABASE_SECRET_KEYS'),'sb_secret_'),keyId:readEnv('EMPLOYEE_PASSWORD_KEY_ID'),keyNotAfter:readEnv('EMPLOYEE_PASSWORD_KEY_NOT_AFTER')};
    const nativePublicKey=defaultKey(readEnv('SUPABASE_PUBLISHABLE_KEYS'),'sb_publishable_');
    const pem=readEnv('EMPLOYEE_PASSWORD_PRIVATE_KEY');
    if(!pem||Object.values(config).some(v=>v===undefined||v===null||v==='')
      ||!/^sb_publishable_[A-Za-z0-9_-]{16,512}$/.test(config.publicKey))return async()=>disabledResponse();
    let key;
    // Import lazily and catch at the request boundary; never print PEM/errors.
    // Ingress pins the public key already used by this Hub. Native owner-token
    // validation uses the runtime's named default publishable key, not that pin.
    // Modern server credentials are sent as apikey only, never as Bearer JWTs.
    const deps=createNativeAdapters({...config,publicKey:nativePublicKey},fetchImpl);
    Object.defineProperty(deps,'privateKey',{get:()=>key??=privateKeyFromPem(pem)});
    return createPasswordHandler(deps,config);
  }catch{return async()=>disabledResponse();}
}
