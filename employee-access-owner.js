// Owner credential handoff only. No passwords, code persistence, role grants or account creation.
(()=>{
  'use strict';
  const config=window.SUPERIOR_CONFIG||{},node=id=>document.getElementById(id);
  const enabled=config.employeeUsernameLoginEnabled===true;
  const client=enabled&&window.supabase&&config.supabaseUrl&&config.supabaseAnonKey?window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey):null;
  let generation=0,ownerUid='',pendingOwnerUid='',observedAuthUid,employees=[],busy=false,codeTimer=null,controller=null;
  const message=(text,error=false)=>{node('ownerMessage').textContent=text;node('ownerMessage').style.color=error?'#b94141':'#536678'};
  function hideCode(){clearTimeout(codeTimer);node('ownerIssuedCode').textContent='';node('ownerIssuedUsername').textContent='';node('ownerExpires').textContent='';node('ownerCodePanel').hidden=true}
  function lock(text){generation++;controller?.abort();controller=null;ownerUid='';pendingOwnerUid='';employees=[];node('ownerEmployee').replaceChildren();node('ownerEmployeeStatus').textContent='';hideCode();node('ownerIssueForm').hidden=true;node('ownerReload').hidden=true;message(text,true)}
  async function credentials(){
    const session=await client.auth.getSession(),verified=await client.auth.getUser();
    if(session.error||verified.error||!session.data?.session?.access_token||!verified.data?.user?.id||session.data.session.user?.id!==verified.data.user.id)throw Error('Owner session unavailable');
    return {token:session.data.session.access_token,uid:verified.data.user.id};
  }
  async function request(body,token,signal){
    const response=await fetch(config.supabaseUrl.replace(/\/$/,'')+'/functions/v1/employee-access',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.supabaseAnonKey,Authorization:'Bearer '+token},body:JSON.stringify(body),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal});
    if(!response.ok)throw Error('Owner action not confirmed');
    return response.json();
  }
  function updateSelection(){const employee=employees.find(x=>x.username===node('ownerEmployee').value);node('ownerEmployeeStatus').textContent=employee?'Status: '+employee.status+'. This is the same existing employee account.':'';node('ownerConfirmEmail').checked=false;hideCode()}
  async function refresh(){
    if(!client){lock('Employee username sign-in is not enabled. Continue using the existing Hub sign-in.');return}
    if(busy)return;busy=true;const turn=++generation;controller=new AbortController();node('ownerIssueForm').hidden=true;hideCode();message('Checking owner access…');
    try{
      const auth=await credentials();if(turn!==generation)return;if(observedAuthUid!==undefined&&observedAuthUid!==auth.uid)throw Error('Owner session changed');pendingOwnerUid=auth.uid;
      const data=await request({action:'owner-list'},auth.token,controller.signal);if(turn!==generation)return;
      if(!Array.isArray(data.employees))throw Error('Owner access unavailable');
      ownerUid=auth.uid;pendingOwnerUid='';employees=data.employees.filter(x=>typeof x.username==='string'&&typeof x.status==='string');
      node('ownerEmployee').replaceChildren(...employees.map(x=>{const option=document.createElement('option');option.value=x.username;option.textContent=x.username;return option}));
      node('ownerIssueForm').hidden=!employees.length;node('ownerReload').hidden=false;updateSelection();message(employees.length?'Owner access confirmed. Choose an existing employee.':'No managed employee usernames are configured. Account mapping requires a separately approved setup.');
    }catch(error){if(turn===generation)lock('Owner access could not be confirmed. Sign in to the Hub with the authorized owner account, then reopen this page.')}
    finally{busy=false;node('ownerIssueBtn').disabled=false}
  }
  node('ownerIssueForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!ownerUid)return;
    const username=node('ownerEmployee').value;if(!employees.some(x=>x.username===username))return;
    busy=true;hideCode();node('ownerIssueBtn').disabled=true;node('ownerEmployee').disabled=true;node('ownerConfirmEmail').disabled=true;node('ownerReload').disabled=true;
    const turn=++generation;controller=new AbortController();message('Creating the one-use code…');
    try{
      const auth=await credentials();if(turn!==generation)return;if(auth.uid!==ownerUid)throw Error('Owner session changed');
      const data=await request({action:'owner-issue',username,confirmEmail:node('ownerConfirmEmail').checked},auth.token,controller.signal);if(turn!==generation)return;
      const expires=Date.parse(data.expires_at);if(data.username!==username||typeof data.code!=='string'||!data.code||!Number.isFinite(expires)||expires<=Date.now())throw Error('Code response not confirmed');
      node('ownerIssuedUsername').textContent=username;node('ownerIssuedCode').textContent=data.code;node('ownerExpires').textContent='One use only · expires '+new Date(expires).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+'.';node('ownerCodePanel').hidden=false;node('ownerConfirmEmail').checked=false;
      codeTimer=setTimeout(()=>{hideCode();message('The displayed code has expired. Refresh employee status before issuing another.')},Math.min(expires-Date.now(),600000));
      message('Code created. Share it privately; the employee chooses their own password.');
    }catch(error){if(turn===generation)message('Code creation was not confirmed. Do not assume a code was unused or retry immediately. Refresh employee status before asking for another code.',true)}
    finally{busy=false;node('ownerIssueBtn').disabled=false;node('ownerEmployee').disabled=false;node('ownerConfirmEmail').disabled=false;node('ownerReload').disabled=false}
  });
  node('ownerEmployee').addEventListener('change',updateSelection);node('ownerHideCode').onclick=hideCode;node('ownerReload').onclick=refresh;
  window.addEventListener('pagehide',()=>{generation++;controller?.abort();hideCode()});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){generation++;controller?.abort();hideCode();if(busy)message('The action may have completed while this page was hidden. Refresh employee status before another action.',true)}});
  if(client)client.auth.onAuthStateChange((event,session)=>{observedAuthUid=session?.user?.id||'';if(event==='SIGNED_OUT'||(ownerUid&&observedAuthUid!==ownerUid)||(pendingOwnerUid&&observedAuthUid!==pendingOwnerUid))lock('Owner session ended or changed. Sign in to the Hub again.')});
  void refresh();
})();
