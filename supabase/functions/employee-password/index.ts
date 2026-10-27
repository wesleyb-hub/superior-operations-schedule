// Dedicated encrypted owner command. Both server flag and private DB readiness
// default OFF. Owner JWT is inside JWE, never a gateway-visible bearer header.
import {configuredPasswordHandler} from '../../../employee-password-candidate/production-entry.mjs';
const origin=Deno.env.get('EMPLOYEE_PASSWORD_HUB_ORIGIN')??'';
const handle=configuredPasswordHandler((name:string)=>Deno.env.get(name),fetch);
Deno.serve(async(request:Request)=>{
  const allowed=origin.startsWith('https://')&&request.headers.get('origin')===origin;
  if(request.method==='OPTIONS')return new Response(null,{status:allowed?204:403,headers:allowed?{
    'access-control-allow-origin':origin,'access-control-allow-methods':'POST',
    'access-control-allow-headers':'content-type, apikey','access-control-max-age':'300','vary':'Origin',
  }:{}});
  const response=await handle(request);if(allowed)response.headers.set('access-control-allow-origin',origin);
  response.headers.set('vary','Origin');return response;
});
