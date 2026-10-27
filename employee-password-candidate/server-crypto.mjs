import {compactDecrypt} from './vendor/jose-6.2.13/jwe/compact/decrypt.js';
import {importPKCS8} from './vendor/jose-6.2.13/key/import.js';
import {decodeProtectedHeader} from './vendor/jose-6.2.13/util/decode_protected_header.js';
import {ALGORITHM,ENCRYPTION,TYPE,MAX_ENVELOPE_BYTES,MAX_PLAINTEXT_BYTES} from './browser-crypto.mjs';
export async function privateKeyFromPem(pem){
  try{
    const key=await importPKCS8(pem,ALGORITHM,{extractable:false});
    if(key.type!=='private'||key.algorithm.modulusLength<2048||key.algorithm.modulusLength>4096)throw Error();
    return key;
  }catch{throw Error('Private command key is unavailable.');}
}
export async function decryptCommand(envelope,key,kid){
  let plaintext;
  try{
    if(typeof envelope!=='string'||envelope.length>MAX_ENVELOPE_BYTES||!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){4}$/.test(envelope))throw Error();
    const untrusted=decodeProtectedHeader(envelope);
    if(Object.keys(untrusted).sort().join(',')!=='alg,enc,kid,typ'||untrusted.alg!==ALGORITHM||untrusted.enc!==ENCRYPTION||untrusted.kid!==kid||untrusted.typ!==TYPE)throw Error();
    // No remote-key resolution, fallback, compression or algorithm negotiation.
    const result=await compactDecrypt(envelope,key,{keyManagementAlgorithms:[ALGORITHM],contentEncryptionAlgorithms:[ENCRYPTION],maxDecompressedLength:0});
    plaintext=result.plaintext;
    const h=result.protectedHeader;
    if(Object.keys(h).sort().join(',')!=='alg,enc,kid,typ'||h.alg!==ALGORITHM||h.enc!==ENCRYPTION||h.kid!==kid||h.typ!==TYPE||plaintext.length>MAX_PLAINTEXT_BYTES)throw Error();
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext));
  }catch{throw Error('Protected command could not be verified.');}
  finally{plaintext?.fill(0);}
}
