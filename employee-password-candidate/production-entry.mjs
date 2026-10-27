import {createPasswordHandler,disabledResponse} from './password-service.mjs';
import {privateKeyFromPem} from './server-crypto.mjs';
import {createNativeAdapters} from './server-adapters.mjs';
export function configuredPasswordHandler(readEnv,fetchImpl){
  if(readEnv('EMPLOYEE_PASSWORD_ENABLED')!=='true')return async()=>disabledResponse();
  try{
    const config={enabled:true,mode:'production',authOrigin:readEnv('SUPABASE_URL'),hubOrigin:readEnv('EMPLOYEE_PASSWORD_HUB_ORIGIN'),audience:readEnv('EMPLOYEE_PASSWORD_AUDIENCE'),identifierDomain:readEnv('EMPLOYEE_PASSWORD_IDENTIFIER_DOMAIN'),publicKey:readEnv('EMPLOYEE_PASSWORD_INGRESS_API_KEY'),serverKey:readEnv('SUPABASE_SERVICE_ROLE_KEY'),keyId:readEnv('EMPLOYEE_PASSWORD_KEY_ID'),keyNotAfter:readEnv('EMPLOYEE_PASSWORD_KEY_NOT_AFTER')};
    const nativeAnonKey=readEnv('SUPABASE_ANON_KEY');
    const pem=readEnv('EMPLOYEE_PASSWORD_PRIVATE_KEY');
    if(!pem||Object.values(config).some(v=>v===undefined||v===null||v==='')
      ||!/^sb_publishable_[A-Za-z0-9_-]{16,512}$/.test(config.publicKey)
      ||!/^[-_a-zA-Z0-9]+\.[-_a-zA-Z0-9]+\.[-_a-zA-Z0-9]+$/.test(nativeAnonKey??''))return async()=>disabledResponse();
    let key;
    // Import lazily and catch at the request boundary; never print PEM/errors.
    // Ingress pins the public key already used by this Hub. Native owner-token
    // validation separately uses the server's legacy anon key, not that pin.
    const deps=createNativeAdapters({...config,publicKey:nativeAnonKey},fetchImpl);
    Object.defineProperty(deps,'privateKey',{get:()=>key??=privateKeyFromPem(pem)});
    return createPasswordHandler(deps,config);
  }catch{return async()=>disabledResponse();}
}
