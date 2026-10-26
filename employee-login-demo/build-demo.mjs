// Build a self-contained, synthetic copy of the current candidate UI. Never updates the accepted employee-review artifact.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {fixtures} from '../employee-review/fixtures.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const hash=x=>createHash('sha256').update(x).digest('hex');
const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; object-src 'none'">`;
export async function generateLoginDemo(){
  const source=await readFile(resolve(root,'index.html'),'utf8');
  const runtime=await readFile(new URL('./runtime.js',import.meta.url),'utf8');
  let html=source.replaceAll('\r\n','\n');
  html=html.replace(/const INVENTORY_SEED=\[[\s\S]*?\n\];/, 'const INVENTORY_SEED=[];');
  html=html.replace(/<script src="[^"]+"><\/script>\n/g,'');
  const shim=`<script>window.EMPLOYEE_LOGIN_DEMO_FIXTURES=${JSON.stringify(fixtures).replaceAll('<','\\u003c')};\n${runtime}\n<\/script>`;
  html=html.replace('<head>','<head>'+csp).replace('<script>',''+shim+'\n<script>');
  html=html.replace(/function loadUiPrefs\(\)\{[\s\S]*?(?=function uiPrefsFromState\(s\)\{)/,'function loadUiPrefs(){return {view:"today"}}\n');
  html=html.replace(/function saveUiPrefs\(\)\{[\s\S]*?(?=function sharedDataFromState\(s\)\{)/,'function saveUiPrefs(){}\n');
  html=html.replace("function employeeNativeInstallPending(){try{return sessionStorage.getItem(EMPLOYEE_NATIVE_PENDING_KEY)==='pending'}catch{return false}}","let demoNativeInstallPending=false;function employeeNativeInstallPending(){return demoNativeInstallPending}");
  html=html.replace("function setEmployeeNativeInstallPending(pending){if(pending)sessionStorage.setItem(EMPLOYEE_NATIVE_PENDING_KEY,'pending');else sessionStorage.removeItem(EMPLOYEE_NATIVE_PENDING_KEY)}","function setEmployeeNativeInstallPending(pending){demoNativeInstallPending=pending}");
  html=html.replace('async function bootstrap(){',`todayISO=()=>EMPLOYEE_LOGIN_DEMO_FIXTURES.day;\ncurrentWeekISO=()=>EMPLOYEE_LOGIN_DEMO_FIXTURES.week;\nasync function bootstrap(){`);
  html=html.replace('<body>','<body><div style="position:fixed;left:0;right:0;bottom:0;z-index:999;background:#fff6e7;color:#513600;border-top:1px solid #c88b2d;padding:7px 12px;font:12px Arial;text-align:center" id="employeeLoginDemoBanner"><b>LOCAL DEMO · SAMPLE ONLY</b> · Any sample username/password · No live connections, accounts or saves</div>');
  html=html.replace('min-height:20px;margin-top:10px','min-height:20px;margin-top:10px').replace('<title>Superior Operations | Master Operations Hub</title>','<title>LOCAL DEMO · Employee username sign-in</title>');
  // Disable the simulated count-write and print/assistant paths; the demo certifies UI only.
  html=html.replace('bootstrap();',`inventoryRpc=wallsProductionRpc=wallsInstallationRpc=async()=>{showInventoryToast('LOCAL DEMO — no saves');return false};\nbootstrap();`);
  let owner=await readFile(resolve(root,'employee-access.html'),'utf8');
  const ownerScript=await readFile(resolve(root,'employee-access-owner.js'),'utf8');
  owner=owner.replace('<head>','<head>'+csp).replace(/<script src="[^"]+"><\/script>/g,'').replace('</body>',`<script>window.EMPLOYEE_OWNER_DEMO=true;window.EMPLOYEE_LOGIN_DEMO_FIXTURES=${JSON.stringify(fixtures)};${runtime}\n<\/script><script>${ownerScript}<\/script></body>`).replace('<div class="eyebrow">','<div style="background:#fff6e7;padding:10px;margin-bottom:18px">LOCAL DEMO · Synthetic owner and employee only · No live changes</div><div class="eyebrow">');
  const sanitize=value=>value.replaceAll('superiorwallsnd.com','example.invalid').replaceAll('Wes Borgen','the review team').replaceAll('Lance Thompson','Sample recipient').replaceAll('Prepared by Scout','Sample demo').replaceAll('Verity Homes','Sample customer');
  html=sanitize(html);owner=sanitize(owner);
  return {html,owner,manifest:{purpose:'Local-only synthetic UI review, not live Auth or permission evidence',sourceSha256:hash(source),runtimeSha256:hash(runtime),outputSha256:hash(html),ownerSha256:hash(owner),externalNetwork:'none',passwordPersistence:'none'}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const output=resolve(process.argv[2]||'artifacts/employee-login-demo');await mkdir(output,{recursive:true});const built=await generateLoginDemo();
  await Promise.all([writeFile(resolve(output,'index.html'),built.html),writeFile(resolve(output,'owner.html'),built.owner),writeFile(resolve(output,'manifest.json'),JSON.stringify(built.manifest,null,2)+'\n')]);
  console.log('Built synthetic-only local UI demo: '+output);
}
