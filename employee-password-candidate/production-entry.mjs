import {createPasswordHandler,disabledResponse} from './password-service.mjs';
import {privateKeyFromPem} from './server-crypto.mjs';
import {createNativeAdapters} from './server-adapters.mjs';
export function configuredPasswordHandler(readEnv,fetchImpl){
  if(readEnv('EMPLOYEE_PASSWORD_ENABLED')!=='true')return async()=>disabledResponse();
  try{
    const config={enabled:true,mode:'production',authOrigin:readEnv('SUPABASE_URL'),hubOrigin:readEnv('EMPLOYEE_PASSWORD_HUB_ORIGIN'),audience:readEnv('EMPLOYEE_PASSWORD_AUDIENCE'),identifierDomain:readEnv('EMPLOYEE_PASSWORD_IDENTIFIER_DOMAIN'),publicKey:readEnv('SUPABASE_ANON_KEY'),serverKey:readEnv('SUPABASE_SERVICE_ROLE_KEY'),keyId:readEnv('EMPLOYEE_PASSWORD_KEY_ID'),keyNotAfter:readEnv('EMPLOYEE_PASSWORD_KEY_NOT_AFTER')};
    const pem=readEnv('EMPLOYEE_PASSWORD_PRIVATE_KEY');
    if(!pem||Object.values(config).some(v=>v===undefined||v===null||v===''))return async()=>disabledResponse();
    let key;
    // Import lazily and catch at the request boundary; never print PEM/errors.
    const deps=createNativeAdapters(config,fetchImpl);
    Object.defineProperty(deps,'privateKey',{get:()=>key??=privateKeyFromPem(pem)});
    return createPasswordHandler(deps,config);
  }catch{return async()=>disabledResponse();}
}
