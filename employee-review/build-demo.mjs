// Rebuild this isolated review artifact from the exact reviewed UI, never the live root bundle.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {fixtures} from './fixtures.mjs';
export const sourceProvenance=Object.freeze({
  commit:'ea406133b89b3109d65b28c0cda8d33eccc006bf',
  tree:'22abcd0362df23faa8e2fdf376ab785c220e64c2',
  retrievalReference:{pullRequest:'https://github.com/wesleyb-hub/superior-operations-schedule/pull/102',commit:'e1295a8f08c3d5aa39cc77761ee57b7791196f28',note:'Remote candidate reference supplied by the release worker; the builder independently requires the exact index hash below.'},
  indexSha256:'5709097ffa22b977e4348b95e12e44f8bf68cd2fb00ce13d78cf6f407b9e9dac'
});
const sha=value=>createHash('sha256').update(value).digest('hex');
const escapeAttribute=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export async function generateDemo(source){
  if(sha(source)!==sourceProvenance.indexSha256)throw Error('Reviewed source hash mismatch; do not build from an unreviewed or live root index.');
  const runtime=await readFile(new URL('./demo-runtime.js',import.meta.url),'utf8');
  const mobilePresentation=await readFile(new URL('./mobile-presentation.js',import.meta.url),'utf8');
  const mobileStyles=await readFile(new URL('./mobile-presentation.css',import.meta.url),'utf8');
  const fixtureSource=await readFile(new URL('./fixtures.mjs',import.meta.url),'utf8');
  let child=source.replaceAll('\r\n','\n');
  function between(start,end,replacement){const at=child.indexOf(start),to=child.indexOf(end,at+start.length);if(at<0||to<0||child.indexOf(start,at+start.length)>=0)throw Error('Missing/non-unique transform boundary: '+start);child=child.slice(0,at)+replacement+child.slice(to)}
  function once(find,replacement){if(!child.includes(find)||child.indexOf(find)!==child.lastIndexOf(find))throw Error('Missing/non-unique transform: '+find);child=child.replace(find,replacement)}
  child=child.replace(/<script src="[^"]+"><\/script>\n/g,'');
  between('<div class="auth-gate"','<div class="app">','');
  between("const STORAGE_KEY=",'let currentUser=',`const DEMO_FIXTURES=${JSON.stringify(fixtures).replaceAll('<','\\u003c')};\nconst sb=createDemoClient();\n`);
  between('function loadUiPrefs(){','function uiPrefsFromState(s){','function loadUiPrefs(){return {}}\n');
  between('function saveUiPrefs(){','function sharedDataFromState(s){','function saveUiPrefs(){}\n');
  between("let authMode='login';",'// Invalidate local work','function showAuthGate(){}\n');
  between('async function signOut(){','function updateAccessStatus(){','async function signOut(){return false}\n');
  between('async function loadCurrentAccess(user){','async function applyRemoteRow(row,notice){','async function loadCurrentAccess(){return false}\n');
  between('async function startSession(user){','let state=','async function startSession(){return false}\n');
  between('async function askOperationsAgent(question){','function openAssistant(){','async function askOperationsAgent(){return demoNoSave()}\n');
  // No generated document/download/pop-up code or URL-bearing link templates are needed for review.
  child=child.replace(/^function plannerPrint\(pack\).*$/m,'function plannerPrint(){return demoNoSave()}');
  child=child.replace(/^function productionDocumentLink\(job\).*$/m,"function productionDocumentLink(){return ''}");
  child=child.replace(/^document\.getElementById\('exportBtn'\)\.onclick=.*$/m,"document.getElementById('exportBtn').onclick=()=>false;");
  child=child.replace(/^document\.getElementById\('(authForm|forgotPasswordBtn|backToLoginBtn|retrySignOutBtn)'\).*\n/gm,'');
  if(runtime.split('\ndemoReset();').length!==2)throw Error('Missing demo presentation insertion point');
  between('async function bootstrap(){','</script>',runtime.replace('\ndemoReset();','\n'+mobilePresentation+'\ndemoReset();')+'\n');
  child=child.replace(/\bWes Borgen\b/g,'the review team').replace(/\bLance Thompson\b/g,'Sample recipient').replace(/\bLance\b/g,'the scheduler').replace(/\bScout\b/g,'the sample demo');
  child=child.replace(/\bVerity Homes\b/g,'Sample customer').replace(/\bVerity\b/g,'Sample source');
  child=child.replaceAll('Prepared by the sample demo for the review team','DEMO — Sample data only');
  child=child.replaceAll('Shared Superior Operations data · ','').replaceAll('Shared Superior Operations planning data · ','');
  once('<title>Superior Operations | Master Operations Hub</title>','<title>Employee review DEMO — sample data only</title>');
  once('<head>',`<head>\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'">`);
  once('</style>\n</head>',`\n#employeeDemoBanner{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-top:9px;padding:8px 10px;border:1px solid #c88b2d;border-radius:7px;background:#fff6e7;color:#664816;font-size:12px;line-height:1.35}#employeeDemoBanner strong{color:#513600}#employeeDemoReset{min-height:42px;flex-shrink:0}button:disabled{cursor:not-allowed;opacity:.6}\n#assistantLaunch,#refreshLiveBtn,#signOutBtn{display:none!important}\n${mobileStyles}\n</style>\n</head>`);
  once('</div></header>',`<details id="employeeDemoBanner" open><summary id="employeeDemoBannerSummary" aria-controls="employeeDemoBannerDetails"><strong>DEMO · SAMPLE DATA</strong><span class="employee-demo-hint">Details</span><span class="employee-demo-short">No live connections · No saves</span></summary><div id="employeeDemoBannerDetails"><div><strong>DEMO — SAMPLE DATA ONLY</strong><br>No live connections · No saves · No account changes<br><small>Sample clock: Oct 26, 2026 · Week: Oct 26–30. Crew is an optional example, not an access grant.</small></div><button type="button" class="mini" id="employeeDemoReset">Reset demo</button></div></details></div></header>`);
  once('<span class="live-dot"></span><strong>LIVE TEAM HUB:</strong> changes save to the shared Superior Operations database.','<strong>DEMO:</strong> read-only sample employee screens.');
  child=child.replaceAll('Live team hub','Sample demo').replaceAll('Shared operational data','No live connections');
  child=child.replaceAll('LIVE SHARED INVENTORY','DEMO SAMPLE INVENTORY').replaceAll('Confirmed count changes refresh automatically.','Saving and count adjustments are disabled in this demo.');
  child=child.replaceAll('This updates only the physical count.','This form previews the physical-count workflow. Saving is disabled in this demo.');
  once("const {divisions,shortcuts,shared}=todayWorkAreas(),date=new Date().toLocaleDateString","const {divisions,shortcuts,shared}=todayWorkAreas(),date=new Date(DEMO_FIXTURES.day+'T12:00:00').toLocaleDateString");
  // All URL attributes, including dormant generated-link templates, are inert in this self-contained artifact.
  child=child.replace(/\s(?:href|src|srcset|action|formaction)="[^"]*"/gi,'');
  if(/<script\b[^>]*\bsrc=|SUPABASE_URL|SUPABASE_ANON_KEY|SUPERIOR_CONFIG|INVENTORY_SEED|INVENTORY_REVIEW_MODE|localStorage|sessionStorage|indexedDB|document\.cookie|\.auth\.|postMessage|window\.(?:parent|top)|review@|superiorwallsnd\.com|Wes Borgen|Lance Thompson|\bbootstrap\(/i.test(child))throw Error('Forbidden live/auth/storage/private content remains in generated child');
  for(const match of child.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
  const outerCsp="default-src 'none'; connect-src 'none'; frame-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; object-src 'none'";
  const index=`<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${outerCsp}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Employee review DEMO — sample data only</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%;height:100dvh}</style></head><body><iframe id="employeeReviewFrame" title="Read-only employee demo — invented sample data; no live connections or saves" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapeAttribute(child)}"></iframe></body></html>\n`;
  const manifest={schemaVersion:1,purpose:'Isolated synthetic employee UI review; not live access or release authorization',source:sourceProvenance,presentationPatch:{id:'employee-demo-mobile-polish-20261025-v1',scope:'Demo-only employee presentation at widths <=1000px; original desktop/admin layout retained. Not an unchanged reviewed-source build.',script:'mobile-presentation.js',scriptSha256:sha(mobilePresentation),style:'mobile-presentation.css',styleSha256:sha(mobileStyles),selectors:{bannerSummary:'#employeeDemoBannerSummary',productionTotals:'#employeeProductionTotals',productionWork:'#employeeProductionWork',inventoryTotals:'#employeeInventoryTotals',crewDetails:'#employeeCrewDetails'}},childSha256:sha(child),indexSha256:sha(index),runtimeSha256:sha(runtime),fixturesSha256:sha(fixtureSource),builderSha256:sha(await readFile(new URL('./build-demo.mjs',import.meta.url))),fixtureRevision:'employee-demo-20261025-v1',frameSelector:'#employeeReviewFrame',bannerSelector:'#employeeDemoBanner',resetSelector:'#employeeDemoReset',sandbox:'allow-scripts',readOnlyRpcs:['get_walls_production_snapshot','get_walls_production_weekly_forecast','get_inventory_scopes','get_inventory_snapshot','get_employee_approved_crew_packs'],sampleWeek:fixtures.week};
  return {index,child,manifest:JSON.stringify(manifest,null,2)+'\n'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),check=args.includes('--check'),sourcePath=args.find(x=>x!=='--check');
  if(!sourcePath)throw Error('Usage: node employee-review/build-demo.mjs [--check] /path/to/exact-reviewed/index.html');
  const generated=await generateDemo(await readFile(resolve(sourcePath),'utf8'));
  for(const [file,value] of [['index.html',generated.index],['manifest.json',generated.manifest]]){
    const path=new URL('./'+file,import.meta.url);
    if(check){if(await readFile(path,'utf8')!==value)throw Error('Generated demo is stale: '+file)}else await writeFile(path,value);
  }
  console.log(check?'Demo artifact is reproducible.':'Built isolated synthetic employee demo.');
}
