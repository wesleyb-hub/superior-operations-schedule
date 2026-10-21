// Ensure this narrow fix cannot silently replace unrelated RPC behavior.
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('supabase/migrations/20261014_006_walls_production_execution.sql',root),'utf8');
const migration = readFileSync(new URL('supabase/migrations/20261021201500_production_release_fail_closed.sql',root),'utf8');
const extract = text => text.match(/create or replace function public\.advance_walls_production_stage\([\s\S]*?\n\$\$;/)?.[0];
const before=extract(source), after=extract(migration);
if (!before || !after || after!==before.replace("v_release<>'Complete'","v_release is distinct from 'Complete'")) {
  throw new Error('Release fix must preserve the existing function except for its null-safe predicate.');
}
console.log('PASS: migration changes only the missing-release predicate; SQL behavior requires PostgreSQL tests.');
