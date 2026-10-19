import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const file=path.join(root,'supabase','migrations','20261019150439_harden_schedule_security_definer_execute_grants.sql');
const sql=fs.readFileSync(file,'utf8');
const checks=[
  ['schedule RPCs revoke PUBLIC/anon and retain authenticated execution',/revoke execute on function public\.can_access_schedule\(\) from public, anon;[\s\S]*revoke execute on function public\.can_edit_schedule\(\) from public, anon;[\s\S]*grant execute on function public\.can_access_schedule\(\) to authenticated;[\s\S]*grant execute on function public\.can_edit_schedule\(\) to authenticated;/.test(sql)&&/grant execute on function public\.get_schedule_snapshot\(\) to authenticated;[\s\S]*grant execute on function public\.save_schedule_snapshot\(bigint,jsonb,text\) to authenticated;[\s\S]*grant execute on function public\.list_schedule_backups\(\) to authenticated;[\s\S]*grant execute on function public\.restore_schedule_revision\(bigint,bigint\) to authenticated;/.test(sql)],
  ['trigger-only helpers revoke all client execution',['flag_walls_production_schedule_change','inventory_prepare_alert','validate_walls_production_assignment'].every(name=>new RegExp(`revoke all on function public\\.${name}\\(\\) from public, anon, authenticated`).test(sql))],
  ['internal wall-LF helper is not an exposed client RPC',/revoke all on function public\.walls_job_total_lf\(text\) from public, anon, authenticated/.test(sql)],
  ['inventory alert claim RPC is service-role only',/revoke all on function public\.claim_inventory_alerts\(bigint,integer\) from public, anon, authenticated;[\s\S]*grant execute on function public\.claim_inventory_alerts\(bigint,integer\) to service_role/.test(sql)],
  ['migration changes grants only, not business data or function bodies',!/create or replace function|\binsert into\b|\bupdate public\.|\bdelete from\b/i.test(sql)],
];
for(const [label,ok] of checks)console.log(`${ok?'PASS':'FAIL'}: ${label}`);
if(checks.some(([,ok])=>!ok))process.exitCode=1;

