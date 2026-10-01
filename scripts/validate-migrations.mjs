import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const dir=path.join(root,'supabase','migrations');
const files=fs.readdirSync(dir).filter(x=>x.endsWith('.sql')).sort();
if(!files.length)throw new Error('No Supabase migrations found.');
const required=['schedule_meta','schedule_records','schedule_milestones','schedule_change_log','schedule_revision_backups','save_schedule_snapshot','restore_schedule_revision','operations_exception_queue','can_edit_schedule'];
const sql=files.map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n');
for(const token of required){if(!sql.includes(token))throw new Error(`Migration control missing: ${token}`)}
if(!/begin;[\s\S]*commit;/i.test(sql))throw new Error('Migration must be transactional.');
console.log(`PASS: ${files.length} migration file(s) include structured data, gates, backups, restore, and exception controls.`);
