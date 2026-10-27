// Standard JWE only. Public-key configuration is deployment-pinned, never taken
// from an encrypted request or a remote URL. This module has no network/storage.
import {CompactEncrypt} from './vendor/jose-6.2.13/jwe/compact/encrypt.js';
import {importJWK} from './vendor/jose-6.2.13/key/import.js';
export const ALGORITHM='RSA-OAEP-256',ENCRYPTION='A256GCM',TYPE='employee-password-command+jwe';
export const MAX_ENVELOPE_BYTES=16384,MAX_PLAINTEXT_BYTES=8192;
export function validPublicConfiguration(config,now=Date.now()){
  if(!config||Object.keys(config).sort().join(',')!=='jwk,kid,not_after'
    ||!/^employee-password-[a-z0-9-]{1,48}$/.test(config.kid??'')
    ||typeof config.not_after!=='string'||!Number.isFinite(Date.parse(config.not_after))
    ||Date.parse(config.not_after)<=now||Date.parse(config.not_after)>now+31*86400000)return false;
  const key=config.jwk;
  return key&&Object.keys(key).sort().join(',')==='e,kty,n'&&key.kty==='RSA'&&key.e==='AQAB'
    &&typeof key.n==='string'&&/^[a-zA-Z0-9_-]{342,684}$/.test(key.n);
}
export async function encryptCommand(payload,config){
  let bytes;
  try{
    if(!validPublicConfiguration(config))throw Error();
    bytes=new TextEncoder().encode(JSON.stringify(payload));
    if(bytes.length>MAX_PLAINTEXT_BYTES)throw Error();
    const key=await importJWK(config.jwk,ALGORITHM,{extractable:false});
    if(key.type!=='public'||key.algorithm.modulusLength<2048||key.algorithm.modulusLength>4096)throw Error();
    const encrypted=await new CompactEncrypt(bytes).setProtectedHeader({alg:ALGORITHM,enc:ENCRYPTION,kid:config.kid,typ:TYPE}).encrypt(key);
    if(encrypted.length>MAX_ENVELOPE_BYTES)throw Error();
    return encrypted;
  }catch{throw new Error('Protected command could not be prepared.');}
  finally{bytes?.fill(0);}
}
