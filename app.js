const SUPABASE_URL=(window.SUPERIOR_CONFIG&&window.SUPERIOR_CONFIG.supabaseUrl)||'';
const SUPABASE_ANON_KEY=(window.SUPERIOR_CONFIG&&window.SUPERIOR_CONFIG.supabaseAnonKey)||'';
const ALLOWED_EMAIL_DOMAIN=((window.SUPERIOR_CONFIG&&window.SUPERIOR_CONFIG.allowedEmailDomain)||'superiorwallsnd.com').toLowerCase();
const sb=(SUPABASE_URL&&SUPABASE_ANON_KEY&&window.supabase)?window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY):null;

let weeks=[];
let jobs=[];
let editingId=null;
let currentUser=null;
let lastRevision=0;
let stateChannel=null;
let saveBusy=false;

function pad2(n){return String(n).padStart(2,'0')}
function todayISO(){const d=new Date();return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`}
function currentMonthISO(){const d=new Date();return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`}
function mondayISO(){const d=new Date(),u=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=(u.getUTCDay()+6)%7;u.setUTCDate(u.getUTCDate()-day);return u.toISOString().slice(0,10)}
const currentWeek=mondayISO();

function normalizeJob(j){
  const source=j.source||'Verity';
  return {
    id:j.id||('j'+Date.now()+Math.random().toString(36).slice(2)),
    source,
    customer:j.customer||(source==='Verity'?'Verity Homes':''),
    projectName:j.projectName||(source==='Verity'?((j.dev||'')+(j.model?' - '+j.model:'')):''),
    job:j.job||'',
    week:j.week||'',
    productionDate:j.productionDate||'',
    installDate:j.installDate||'',
    completedDate:j.completedDate||'',
    dev:j.dev||'',
    address:j.address||'',
    model:j.model||'',
    count:Number(j.count||0),
    status:j.status||(source==='Verity'?'Inventory':'Other'),
    notes:j.notes||''
  };
}

function authAllowed(email=''){return email.toLowerCase().endsWith('@'+ALLOWED_EMAIL_DOMAIN)}
function setAuthMessage(msg,isError=false){const el=document.getElementById('authMessage');if(!el)return;el.textContent=msg||'';el.style.color=isError?'#b94141':'#52616d'}
function showAuthGate(show){const el=document.getElementById('authGate');if(el)el.style.display=show?'flex':'none';const app=document.querySelector('.app');if(app){app.style.filter=show?'blur(2px)':'none';app.style.pointerEvents=show?'none':'auto'}}

async function sendMagicLink(){
  if(!sb){setAuthMessage('Supabase is not connected yet. Add the project URL and public key to config.js.',true);return}
  const email=(document.getElementById('authEmail').value||'').trim().toLowerCase();
  if(!authAllowed(email)){setAuthMessage('Use your @'+ALLOWED_EMAIL_DOMAIN+' work email.',true);return}
  const btn=document.getElementById('authBtn');
  btn.disabled=true;
  setAuthMessage('Sending sign-in link...');
  const redirect=window.location.origin+window.location.pathname;
  const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:redirect}});
  btn.disabled=false;
  if(error)setAuthMessage(error.message,true);else setAuthMessage('Check your email and click the sign-in link.');
}

async function signOut(){if(sb)await sb.auth.signOut();currentUser=null;showAuthGate(true);setAuthMessage('Signed out.')}

function activeViewName(){return document.querySelector('.tab.active')?.dataset.view||'current'}

function applyRemoteRow(row,notice){
  if(!row||!row.payload)return;
  const active=activeViewName();
  const p=row.payload;
  weeks=Array.isArray(p.weeks)?structuredClone(p.weeks):[];
  jobs=Array.isArray(p.jobs)?structuredClone(p.jobs).map(normalizeJob):[];
  lastRevision=Number(row.revision||0);
  render();
  showView(active);
  const s=document.getElementById('saveStatus');
  if(s)s.textContent=notice||('Live - rev '+lastRevision);
}

async function loadRemoteState(manual=false){
  if(!sb||!currentUser)return false;
  const s=document.getElementById('saveStatus');
  if(s)s.textContent='Loading shared schedule...';
  const {data,error}=await sb.from('schedule_state').select('id,payload,revision,updated_at,updated_by').eq('id',1).single();
  if(error){if(s)s.textContent='Could not load shared schedule';alert('Could not load the shared schedule: '+error.message);return false}
  applyRemoteRow(data,manual?'Refreshed live schedule':'Live shared schedule');
  return true;
}

async function saveJobs(reason='Saved'){
  if(!sb||!currentUser){alert('You are not signed in to the live schedule.');return false}
  if(saveBusy)return false;
  saveBusy=true;
  const s=document.getElementById('saveStatus');
  if(s)s.textContent='Saving...';
  const next=lastRevision+1;
  const payload={schemaVersion:1,weeks:structuredClone(weeks),jobs:structuredClone(jobs)};
  const {data,error}=await sb.from('schedule_state').update({payload,revision:next,updated_at:new Date().toISOString(),updated_by:currentUser.email}).eq('id',1).eq('revision',lastRevision).select('revision,updated_at,updated_by').maybeSingle();
  saveBusy=false;
  if(error){if(s)s.textContent='Save failed';alert('Schedule save failed: '+error.message);await loadRemoteState(true);return false}
  if(!data){if(s)s.textContent='Another update happened first';alert('Someone else changed the schedule at the same time. I reloaded the newest version so nobody gets overwritten. Please make your change again.');await loadRemoteState(true);return false}
  lastRevision=Number(data.revision||next);
  if(s)s.textContent=(reason||'Saved')+' - '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  return true;
}

function subscribeLive(){
  if(!sb)return;
  if(stateChannel)sb.removeChannel(stateChannel);
  stateChannel=sb.channel('superior-operations-live').on('postgres_changes',{event:'UPDATE',schema:'public',table:'schedule_state',filter:'id=eq.1'},evt=>{
    const row=evt.new;
    if(Number(row.revision||0)>lastRevision&&!saveBusy)applyRemoteRow(row,'Updated live by '+(row.updated_by||'team member'));
  }).subscribe();
}

async function startSession(user){
  if(!user)return;
  const email=(user.email||'').toLowerCase();
  if(!authAllowed(email)){setAuthMessage('This schedule is limited to @'+ALLOWED_EMAIL_DOMAIN+' accounts.',true);await sb.auth.signOut();showAuthGate(true);return}
  currentUser=user;
  showAuthGate(false);
  const sign=document.getElementById('signOutBtn');
  if(sign){sign.style.display='inline-block';sign.textContent='Sign Out - '+email.split('@')[0]}
  await loadRemoteState();
  subscribeLive();
}

function parseDate(s){if(!s)return null;const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);if(!m)return null;return new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])))}
function isoDate(d){return d.toISOString().slice(0,10)}
function weekStart(s){const d=parseDate(s);if(!d)return'';const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return isoDate(d)}
function fmtDate(s,withYear=true){const d=parseDate(s);if(!d)return'Not scheduled';return d.toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric',...(withYear?{year:'numeric'}:{})})}
function monthLabel(m){if(!/^\d{4}-\d{2}$/.test(m||''))return m||'';const d=parseDate(m+'-01');return d?d.toLocaleDateString('en-US',{timeZone:'UTC',month:'long',year:'numeric'}):m}
function phaseClass(p=''){p=p.toLowerCase();if(p.includes('already'))return'done';if(p.includes('ramp'))return'ramp';if(p.includes('peak'))return'peak';if(p.includes('fall'))return'fall';if(p.includes('winter'))return'winter';return'scheduled'}
function statusClass(s=''){return s.toLowerCase().replaceAll(' ','-')}
function escapeHtml(s=''){return String(s).replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]))}

function displayWeeks(){
  const map=new Map(weeks.map(w=>[w.date,{...w}]));
  for(const j of jobs){
    for(const d of [j.week,weekStart(j.productionDate),weekStart(j.installDate)])if(d&&!map.has(d))map.set(d,{date:d,phase:'Scheduled Work',target:''});
  }
  return[...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

function filteredJobs(){
  const q=document.getElementById('searchInput').value.trim().toLowerCase();
  const src=document.getElementById('sourceFilter').value;
  const pf=document.getElementById('phaseFilter').value;
  const df=document.getElementById('devFilter').value;
  const sf=document.getElementById('statusFilter').value;
  const mf=document.getElementById('modelFilter').value;
  return jobs.filter(j=>{
    const w=displayWeeks().find(x=>x.date===j.week);
    const hay=[j.job,j.source,j.customer,j.projectName,j.dev,j.address,j.model,j.status,j.notes,j.productionDate,j.installDate,j.completedDate].join(' ').toLowerCase();
    const area=j.source==='Other'?(j.customer||j.dev):j.dev;
    return(!q||hay.includes(q))&&(!src||j.source===src)&&(!pf||w?.phase===pf)&&(!df||area===df)&&(!sf||j.status===sf)&&(!mf||j.model===mf);
  });
}

function fillFilters(){
  const pairs=[
    ['phaseFilter',[...new Set(displayWeeks().map(w=>w.phase))]],
    ['devFilter',[...new Set(jobs.map(j=>j.source==='Other'?(j.customer||j.dev):j.dev).filter(Boolean))].sort()],
    ['statusFilter',[...new Set(jobs.map(j=>j.status).filter(Boolean))].sort()],
    ['modelFilter',[...new Set(jobs.map(j=>j.model).filter(Boolean))].sort()]
  ];
  for(const[id,vals]of pairs){
    const el=document.getElementById(id),cur=el.value,first=el.options[0].outerHTML;
    el.innerHTML=first+vals.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    el.value=cur;
  }
}

function selectedCompletedMonth(){return document.getElementById('completedMonth')?.value||currentMonthISO()}

function renderStats(){
  const visible=filteredJobs();
  const currDig=visible.filter(j=>j.week===currentWeek);
  const currProd=visible.filter(j=>weekStart(j.productionDate)===currentWeek);
  const currInstall=visible.filter(j=>weekStart(j.installDate)===currentWeek);
  const other=visible.filter(j=>j.source==='Other');
  const missing=visible.filter(j=>!j.productionDate||!j.installDate);
  const completedMonth=visible.filter(j=>(j.completedDate||'').startsWith(currentMonthISO()));
  const cards=[
    ['Visible Jobs',visible.length,'all filtered work'],
    ['This Week Digs',currDig.length,currDig.reduce((a,j)=>a+Number(j.count||0),0)+' units / shells'],
    ['This Week Production',currProd.length,currProd.reduce((a,j)=>a+Number(j.count||0),0)+' units / shells'],
    ['This Week Installs',currInstall.length,currInstall.reduce((a,j)=>a+Number(j.count||0),0)+' units / shells'],
    ['Completed This Month',completedMonth.length,completedMonth.reduce((a,j)=>a+Number(j.count||0),0)+' units / shells'],
    ['Other Projects',other.length,'outside Verity'],
    ['Missing Dates',missing.length,'need prod or install date']
  ];
  document.getElementById('stats').innerHTML=cards.map(c=>`<div class="stat"><div class="stat-label">${c[0]}</div><div class="stat-value">${c[1]}</div><div class="stat-foot">${c[2]}</div></div>`).join('');
}

function titleFor(j){return j.source==='Other'?(j.projectName||j.job||'Other Project'):(j.model||j.projectName||j.job)}
function subFor(j){return j.source==='Other'?(j.customer||j.dev||'Other customer'):(j.dev||'Verity Homes')}

function jobCard(j,stage='dig'){
  const stageDate=stage==='dig'?(j.week||''):stage==='prod'?j.productionDate:j.installDate;
  const label=stage==='dig'?'Dig Week':stage==='prod'?'Production':'Install';
  const completeBadge=j.completedDate?`<span class="complete-badge">Complete ${fmtDate(j.completedDate,false)}</span>`:'';
  const completeAction=!j.completedDate?`<button class="icon-btn complete-action" onclick="event.stopPropagation();markCompleteToday('${j.id}')">Complete</button>`:'';
  return `<article class="job ${j.completedDate?'job-complete':''}" draggable="true" data-id="${j.id}" data-stage="${stage}" onclick="openEdit('${j.id}')"><div class="job-top"><div class="job-num">${escapeHtml(j.job||j.projectName||'No job #')}</div><div class="badges"><span class="source-badge ${j.source.toLowerCase()}">${escapeHtml(j.source)}</span><span class="status ${statusClass(j.status)}">${escapeHtml(j.status)}</span>${completeBadge}</div></div><div class="job-model">${escapeHtml(titleFor(j))}</div><div class="job-dev">${escapeHtml(subFor(j))}</div>${j.address?`<div class="job-address">${escapeHtml(j.address)}</div>`:''}<div class="milestone-date ${stage}">${label}: ${fmtDate(stageDate,false)}</div><div class="job-footer"><span>${j.count||0} ${Number(j.count)===1?'unit / shell':'units / shells'}</span><span class="job-actions">${completeAction}<button class="icon-btn" onclick="event.stopPropagation();openEdit('${j.id}')">Edit</button><button class="icon-btn danger" onclick="event.stopPropagation();quickDelete('${j.id}')">Delete</button></span></div></article>`;
}

function laneHtml(name,cls,items,stage){return `<div class="lane ${cls}"><div class="lane-title"><span>${name}</span><span class="lane-count">${items.length} job${items.length===1?'':'s'}</span></div><div class="lane-list">${items.length?items.map(j=>jobCard(j,stage)).join(''):'<div class="lane-empty">Nothing scheduled</div>'}</div></div>`}

function renderCurrentWeek(){
  const fj=filteredJobs();
  const w=displayWeeks().find(x=>x.date===currentWeek)||{date:currentWeek,phase:'Scheduled Work',target:''};
  const digs=fj.filter(j=>j.week===currentWeek);
  const prods=fj.filter(j=>weekStart(j.productionDate)===currentWeek);
  const installs=fj.filter(j=>weekStart(j.installDate)===currentWeek);
  const month=currentMonthISO();
  const completed=fj.filter(j=>(j.completedDate||'').startsWith(month)).sort((a,b)=>b.completedDate.localeCompare(a.completedDate));
  const meta=[w.target?escapeHtml(w.target):'',`${digs.length} digs`,`${prods.length} production`,`${installs.length} installs`].filter(Boolean).join(' - ');
  const previewRows=completed.slice(0,5).map(j=>`<div class="monthly-row" onclick="openEdit('${j.id}')"><div><strong>${escapeHtml(j.job||j.projectName||'No job #')}</strong><span>${escapeHtml(titleFor(j))}</span></div><div>${fmtDate(j.completedDate,false)}</div><div>${j.count||0} ${Number(j.count)===1?'unit':'units'}</div></div>`).join('');
  document.getElementById('currentView').innerHTML=`<section class="week-card current" data-week="${currentWeek}"><div class="week-head"><div class="week-top"><div><div class="week-date">Week of ${fmtDate(currentWeek)}</div><div class="week-meta">${meta}</div></div><span class="phase ${phaseClass(w.phase)}">${escapeHtml(w.phase)}</span></div></div><div class="lanes">${laneHtml('Digs','dig',digs,'dig')}${laneHtml('Production','prod',prods,'prod')}${laneHtml('Installs','install',installs,'install')}</div></section><section class="monthly-preview"><div class="monthly-preview-head"><div><div class="section-eyebrow">MONTHLY REPORTING</div><h3>Completed in ${monthLabel(month)}</h3><p>${completed.length} jobs - ${completed.reduce((a,j)=>a+Number(j.count||0),0)} units / shells</p></div><button class="report-btn" onclick="showView('completed')">View Completed Jobs</button></div>${previewRows?`<div class="monthly-list">${previewRows}</div>`:'<div class="empty">No jobs have been marked complete this month yet.</div>'}</section>`;
}

function renderOps(){
  const fj=filteredJobs();
  const cards=displayWeeks().map(w=>{
    const digs=fj.filter(j=>j.week===w.date),prods=fj.filter(j=>weekStart(j.productionDate)===w.date),installs=fj.filter(j=>weekStart(j.installDate)===w.date);
    const isDynamic=w.phase==='Scheduled Work';
    if(isDynamic&&!digs.length&&!prods.length&&!installs.length)return'';
    const meta=[w.target?escapeHtml(w.target):'',`${digs.length} digs`,`${prods.length} production`,`${installs.length} installs`].filter(Boolean).join(' - ');
    return `<section class="week-card ${w.date===currentWeek?'current':''}" data-week="${w.date}"><div class="week-head"><div class="week-top"><div><div class="week-date">Week of ${fmtDate(w.date)}</div><div class="week-meta">${meta}</div></div><span class="phase ${phaseClass(w.phase)}">${escapeHtml(w.phase)}</span></div></div><div class="lanes">${laneHtml('Digs','dig',digs,'dig')}${laneHtml('Production','prod',prods,'prod')}${laneHtml('Installs','install',installs,'install')}</div></section>`;
  }).join('');
  document.getElementById('opsView').innerHTML=cards;
}

function renderCompleted(){
  const month=selectedCompletedMonth();
  const js=filteredJobs().filter(j=>(j.completedDate||'').startsWith(month)).sort((a,b)=>b.completedDate.localeCompare(a.completedDate));
  const units=js.reduce((a,j)=>a+Number(j.count||0),0);
  const verity=js.filter(j=>j.source==='Verity').length;
  const other=js.filter(j=>j.source==='Other').length;
  document.getElementById('completedTitle').textContent='Completed Jobs - '+monthLabel(month);
  document.getElementById('completedSummary').innerHTML=[['Jobs Completed',js.length],['Units / Shells',units],['Verity',verity],['Other Projects',other]].map(([k,v])=>`<div class="report-stat"><span>${k}</span><strong>${v}</strong></div>`).join('');
  document.getElementById('completedBody').innerHTML=js.length?js.map(j=>`<tr onclick="openEdit('${j.id}')"><td class="nowrap"><strong>${fmtDate(j.completedDate,false)}</strong></td><td><span class="source-badge ${j.source.toLowerCase()}">${escapeHtml(j.source)}</span></td><td class="nowrap"><strong>${escapeHtml(j.job||'--')}</strong></td><td>${escapeHtml(titleFor(j))}<br><span class="table-sub">${escapeHtml(subFor(j))}</span></td><td class="nowrap">${j.productionDate?fmtDate(j.productionDate,false):'--'}</td><td class="nowrap">${j.installDate?fmtDate(j.installDate,false):'--'}</td><td>${j.count||0}</td><td>${escapeHtml(j.status)}</td></tr>`).join(''):'<tr><td colspan="8"><div class="empty">No jobs marked complete for this month.</div></td></tr>';
}

function renderDig(){
  const fj=filteredJobs().filter(j=>j.source==='Verity');
  document.getElementById('digView').innerHTML=displayWeeks().filter(w=>weeks.some(x=>x.date===w.date)).map(w=>{
    const js=fj.filter(j=>j.week===w.date);
    return `<section class="week-card ${w.date===currentWeek?'current':''}" data-week="${w.date}"><div class="week-head"><div class="week-top"><div><div class="week-date">Week of ${fmtDate(w.date)}</div><div class="week-meta">${escapeHtml(w.target)} - ${js.reduce((a,j)=>a+Number(j.count||0),0)} visible units</div></div><span class="phase ${phaseClass(w.phase)}">${escapeHtml(w.phase)}</span></div></div><div class="job-list">${js.length?js.map(j=>jobCard(j,'dig')).join(''):'<div class="empty">No matching Verity jobs</div>'}</div></section>`;
  }).join('');
}

function renderOther(){
  const js=filteredJobs().filter(j=>j.source==='Other').sort((a,b)=>(a.productionDate||a.installDate||'9999').localeCompare(b.productionDate||b.installDate||'9999'));
  document.getElementById('otherGrid').innerHTML=js.length?js.map(j=>`<article class="other-card ${j.completedDate?'job-complete':''}" onclick="openEdit('${j.id}')"><div class="job-top"><div><div class="other-title">${escapeHtml(j.projectName||j.job||'Other Project')}</div><div class="other-customer">${escapeHtml(j.customer||'Other customer')}${j.job?' - '+escapeHtml(j.job):''}</div></div><div class="badges"><span class="source-badge other">Other</span>${j.completedDate?`<span class="complete-badge">Complete</span>`:''}</div></div>${j.address?`<div class="job-address">${escapeHtml(j.address)}</div>`:''}${j.model?`<div class="job-model">${escapeHtml(j.model)}</div>`:''}<div class="other-milestones"><div class="mini-milestone"><label>Production</label><strong>${fmtDate(j.productionDate,false)}</strong></div><div class="mini-milestone"><label>Install</label><strong>${fmtDate(j.installDate,false)}</strong></div></div>${j.completedDate?`<div class="completed-line">Completed ${fmtDate(j.completedDate)}</div>`:''}${j.notes?`<div class="other-notes">${escapeHtml(j.notes)}</div>`:''}</article>`).join(''):'<div class="empty">No other projects yet. Use "+ Other Project" to add one.</div>';
}

function renderList(){
  const fj=filteredJobs().sort((a,b)=>(a.week||a.productionDate||a.installDate||'9999').localeCompare(b.week||b.productionDate||b.installDate||'9999'));
  document.getElementById('listBody').innerHTML=fj.map(j=>`<tr onclick="openEdit('${j.id}')"><td><span class="source-badge ${j.source.toLowerCase()}">${escapeHtml(j.source)}</span></td><td class="nowrap">${j.week?fmtDate(j.week,false):'--'}</td><td class="nowrap">${j.productionDate?fmtDate(j.productionDate,false):'--'}</td><td class="nowrap">${j.installDate?fmtDate(j.installDate,false):'--'}</td><td class="nowrap">${j.completedDate?fmtDate(j.completedDate,false):'--'}</td><td class="nowrap"><strong>${escapeHtml(j.job||'--')}</strong></td><td>${escapeHtml(j.source==='Other'?(j.projectName||j.customer):(j.dev||j.projectName))}</td><td>${escapeHtml(j.address)}</td><td>${escapeHtml(j.model)}</td><td>${j.count||0}</td><td class="table-status">${escapeHtml(j.status)}</td></tr>`).join('');
}

function renderTimeline(){
  const dw=displayWeeks(),startIndex=Math.max(0,dw.findIndex(w=>w.date===currentWeek)),range=dw.slice(startIndex,startIndex+16),fj=filteredJobs();
  const cols=`200px repeat(${range.length},minmax(90px,1fr))`;
  let html=`<div class="timeline" style="grid-template-columns:${cols}"><div class="tcell thead tlabel">Job / Project</div>`+range.map(w=>`<div class="tcell thead">${fmtDate(w.date,false)}</div>`).join('');
  for(const j of fj.filter(j=>range.some(w=>[j.week,weekStart(j.productionDate),weekStart(j.installDate)].includes(w.date)))){
    html+=`<div class="tcell tlabel" onclick="openEdit('${j.id}')">${escapeHtml(j.job||j.projectName)}${j.completedDate?' <span class="tiny-complete">DONE</span>':''}<br><span style="font-weight:500;color:#7a8790">${escapeHtml(titleFor(j))}</span></div>`;
    for(const w of range){
      const marks=[];
      if(j.week===w.date)marks.push('<span class="tmark d">D</span>');
      if(weekStart(j.productionDate)===w.date)marks.push('<span class="tmark p">P</span>');
      if(weekStart(j.installDate)===w.date)marks.push('<span class="tmark i">I</span>');
      html+=`<div class="tcell"><div class="tmarks">${marks.join('')}</div></div>`;
    }
  }
  html+='</div>';
  document.getElementById('timeline').innerHTML=html;
}

function render(){
  fillFilters();
  renderStats();
  renderCurrentWeek();
  renderOps();
  renderCompleted();
  renderDig();
  renderOther();
  renderList();
  renderTimeline();
  enableDrag();
}

function shiftDateToWeek(date,targetWeek){let offset=0;if(date){const d=parseDate(date);if(d)offset=(d.getUTCDay()+6)%7}const t=parseDate(targetWeek);if(!t)return date||'';t.setUTCDate(t.getUTCDate()+offset);return isoDate(t)}

function enableDrag(){
  let dragId=null,dragStage=null;
  document.querySelectorAll('.job[draggable="true"]').forEach(el=>{
    el.addEventListener('dragstart',e=>{dragId=el.dataset.id;dragStage=el.dataset.stage;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId);e.stopPropagation()});
    el.addEventListener('dragend',()=>document.querySelectorAll('.week-card').forEach(c=>c.classList.remove('drag-over')));
  });
  document.querySelectorAll('.week-card').forEach(c=>{
    c.addEventListener('dragover',e=>{e.preventDefault();c.classList.add('drag-over')});
    c.addEventListener('dragleave',()=>c.classList.remove('drag-over'));
    c.addEventListener('drop',e=>{
      e.preventDefault();c.classList.remove('drag-over');
      if(!dragId||!dragStage)return;
      const j=jobs.find(x=>x.id===dragId);if(!j)return;
      const target=c.dataset.week;
      if(dragStage==='dig')j.week=target;
      else if(dragStage==='prod')j.productionDate=shiftDateToWeek(j.productionDate,target);
      else if(dragStage==='install')j.installDate=shiftDateToWeek(j.installDate,target);
      saveJobs('Moved '+(dragStage==='dig'?'dig':dragStage==='prod'?'production':'install'));
      render();
      dragId=null;dragStage=null;
    });
  });
}

async function markCompleteToday(id){
  const j=jobs.find(x=>x.id===id);if(!j)return;
  if(!confirm(`Mark ${j.job||j.projectName||'this job'} complete today?`))return;
  j.completedDate=todayISO();
  await saveJobs('Marked complete');
  render();
}

function buildWeekOptions(selected=''){
  const opts=['<option value="">No dig week / N/A</option>',...displayWeeks().map(w=>`<option value="${w.date}">${fmtDate(w.date)} - ${escapeHtml(w.phase)}</option>`)];
  const el=document.getElementById('fWeek');el.innerHTML=opts.join('');el.value=selected||'';
}

function syncSourceFields(){
  const src=document.getElementById('fSource').value;
  const status=document.getElementById('fStatus');
  if(src==='Other'&&['Pre-sold','Inventory','BTR','Mixed'].includes(status.value))status.value='Other';
  if(src==='Verity'&&status.value==='Other')status.value='Inventory';
  document.getElementById('fCustomer').placeholder=src==='Verity'?'Verity Homes':'Outside customer / GC';
  document.getElementById('fProjectName').placeholder=src==='Verity'?'Optional project label':'Project name required';
}

function updateCompleteButton(){
  const input=document.getElementById('fCompletedDate');
  const btn=document.getElementById('markCompleteBtn');
  if(!btn||!input)return;
  btn.textContent=input.value?'Clear Completed Date':'Mark Complete Today';
}

function openEdit(id,sourceHint){
  editingId=id;
  const j=jobs.find(x=>x.id===id);
  const src=j?.source||sourceHint||'Verity';
  document.getElementById('modalTitle').textContent=j?'Edit Job':(src==='Other'?'Add Other Project':'Add Verity Job');
  document.getElementById('deleteBtn').style.visibility=j?'visible':'hidden';
  document.getElementById('markCompleteBtn').style.visibility=j?'visible':'hidden';
  buildWeekOptions(j?.week||(src==='Verity'?currentWeek:''));
  const values={
    fSource:src,
    fJob:j?.job||'',
    fCustomer:j?.customer||(src==='Verity'?'Verity Homes':''),
    fProjectName:j?.projectName||'',
    fProductionDate:j?.productionDate||'',
    fInstallDate:j?.installDate||'',
    fCompletedDate:j?.completedDate||'',
    fDev:j?.dev||'',
    fModel:j?.model||'',
    fCount:j?.count||1,
    fStatus:j?.status||(src==='Verity'?'Inventory':'Other'),
    fAddress:j?.address||'',
    fNotes:j?.notes||''
  };
  for(const[k,v]of Object.entries(values))document.getElementById(k).value=v;
  document.getElementById('fWeek').value=j?.week||(src==='Verity'?currentWeek:'');
  syncSourceFields();
  updateCompleteButton();
  document.getElementById('modalBackdrop').style.display='flex';
}

function closeModal(){document.getElementById('modalBackdrop').style.display='none';editingId=null}

function saveModal(){
  const source=document.getElementById('fSource').value;
  const obj=normalizeJob({
    id:editingId||('j'+Date.now()),
    source,
    job:document.getElementById('fJob').value.trim(),
    customer:document.getElementById('fCustomer').value.trim(),
    projectName:document.getElementById('fProjectName').value.trim(),
    week:document.getElementById('fWeek').value,
    productionDate:document.getElementById('fProductionDate').value,
    installDate:document.getElementById('fInstallDate').value,
    completedDate:document.getElementById('fCompletedDate').value,
    dev:document.getElementById('fDev').value.trim(),
    model:document.getElementById('fModel').value.trim(),
    count:Number(document.getElementById('fCount').value||0),
    status:document.getElementById('fStatus').value,
    address:document.getElementById('fAddress').value.trim(),
    notes:document.getElementById('fNotes').value.trim()
  });
  if(source==='Verity'&&!obj.job){alert('Job number is required for a Verity job.');return}
  if(source==='Verity'&&!obj.week){alert('Dig week is required for a Verity job.');return}
  if(source==='Other'&&!obj.projectName){alert('Project name is required for an Other Project.');return}
  if(editingId){Object.assign(jobs.find(x=>x.id===editingId),obj)}else jobs.push(obj);
  saveJobs();
  closeModal();
  render();
}

function quickDelete(id){const j=jobs.find(x=>x.id===id);if(confirm(`Delete ${j?.job||j?.projectName||'this project'} from the schedule?`)){jobs=jobs.filter(x=>x.id!==id);saveJobs();render()}}

function exportText(name,text,type){const blob=new Blob([text],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},0)}

function csvText(rows){return rows.map(r=>r.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\n')}

function exportCsv(){
  const rows=[['Source','Customer','Project Name','Job #','Dig Week','Production Date','Install Date','Completed Date','Development / Area','Address / Location','Model / Project Type','Count','Status','Notes'],...jobs.slice().sort((a,b)=>(a.week||a.productionDate||'9999').localeCompare(b.week||b.productionDate||'9999')).map(j=>[j.source,j.customer,j.projectName,j.job,j.week,j.productionDate,j.installDate,j.completedDate,j.dev,j.address,j.model,j.count,j.status,j.notes])];
  exportText('superior-operations-schedule.csv',csvText(rows),'text/csv');
}

function exportCompletedCsv(){
  const month=selectedCompletedMonth();
  const js=jobs.filter(j=>(j.completedDate||'').startsWith(month)).sort((a,b)=>a.completedDate.localeCompare(b.completedDate));
  const rows=[['Completed Date','Source','Customer','Project Name','Job #','Dig Week','Production Date','Install Date','Development / Area','Address / Location','Model / Project Type','Count','Sale Type','Notes'],...js.map(j=>[j.completedDate,j.source,j.customer,j.projectName,j.job,j.week,j.productionDate,j.installDate,j.dev,j.address,j.model,j.count,j.status,j.notes])];
  exportText(`superior-completed-jobs-${month}.csv`,csvText(rows),'text/csv');
}

async function resetAll(){if(confirm('Reload the newest shared schedule and discard any unsaved screen changes?'))await loadRemoteState(true)}

function showView(view){
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  document.getElementById('currentView').style.display=view==='current'?'flex':'none';
  document.getElementById('opsView').style.display=view==='ops'?'flex':'none';
  document.getElementById('completedView').style.display=view==='completed'?'block':'none';
  document.getElementById('digView').style.display=view==='dig'?'flex':'none';
  document.getElementById('otherView').style.display=view==='other'?'block':'none';
  document.getElementById('listView').style.display=view==='list'?'block':'none';
  document.getElementById('timelineView').style.display=view==='timeline'?'block':'none';
}

function wireUI(){
  document.getElementById('completedMonth').value=currentMonthISO();
  document.getElementById('addVerityBtn').onclick=()=>openEdit(null,'Verity');
  document.getElementById('addOtherBtn').onclick=()=>openEdit(null,'Other');
  document.getElementById('refreshLiveBtn').onclick=()=>loadRemoteState(true);
  document.getElementById('printBtn').onclick=()=>window.print();
  document.getElementById('todayBtn').onclick=()=>showView('current');
  document.getElementById('moreBtn').onclick=e=>{e.stopPropagation();const m=document.getElementById('moreMenu');m.style.display=m.style.display==='block'?'none':'block'};
  document.addEventListener('click',()=>document.getElementById('moreMenu').style.display='none');
  document.getElementById('refreshLiveMenuBtn').onclick=()=>loadRemoteState(true);
  document.getElementById('exportCsvBtn').onclick=exportCsv;
  document.getElementById('exportJsonBtn').onclick=()=>exportText('superior-operations-schedule-backup.json',JSON.stringify({weeks,jobs},null,2),'application/json');
  document.getElementById('importBtn').onclick=()=>document.getElementById('importFile').click();
  document.getElementById('importFile').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);if(!Array.isArray(d.jobs))throw 0;jobs=d.jobs.map(normalizeJob);if(Array.isArray(d.weeks))weeks=d.weeks;saveJobs('Imported backup');render()}catch{alert('That JSON file is not a valid schedule backup.')}};r.readAsText(f)};
  document.getElementById('resetBtn').onclick=resetAll;
  document.getElementById('completedMonth').onchange=renderCompleted;
  document.getElementById('exportCompletedBtn').onclick=exportCompletedCsv;
  ['searchInput','sourceFilter','phaseFilter','devFilter','statusFilter','modelFilter'].forEach(id=>document.getElementById(id).addEventListener(id==='searchInput'?'input':'change',render));
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>showView(b.dataset.view));
  document.getElementById('fSource').onchange=syncSourceFields;
  document.getElementById('fCompletedDate').onchange=updateCompleteButton;
  document.getElementById('markCompleteBtn').onclick=()=>{const input=document.getElementById('fCompletedDate');input.value=input.value?'':todayISO();updateCompleteButton()};
  document.getElementById('closeModal').onclick=closeModal;
  document.getElementById('cancelBtn').onclick=closeModal;
  document.getElementById('saveBtn').onclick=saveModal;
  document.getElementById('deleteBtn').onclick=()=>{if(editingId){quickDelete(editingId);closeModal()}};
  document.getElementById('modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal()};
  document.getElementById('authBtn').onclick=sendMagicLink;
  document.getElementById('authEmail').addEventListener('keydown',e=>{if(e.key==='Enter')sendMagicLink()});
  document.getElementById('signOutBtn').onclick=signOut;
}

async function bootstrap(){
  wireUI();
  showView('current');
  if(!sb){showAuthGate(true);setAuthMessage('One setup step remains: connect this site to Supabase in config.js.',true);return}
  const {data}=await sb.auth.getSession();
  if(data.session)await startSession(data.session.user);else showAuthGate(true);
  sb.auth.onAuthStateChange(async(event,session)=>{
    if(session&&session.user&&!currentUser)await startSession(session.user);
    if(!session&&event==='SIGNED_OUT'){currentUser=null;showAuthGate(true)}
  });
}

bootstrap();
