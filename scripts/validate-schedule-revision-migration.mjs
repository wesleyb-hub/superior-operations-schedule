// Compare against the public committed RPC; no hosted schema or data is required.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('supabase/migrations/20261001_001_structured_operations.sql', root),'utf8');
// Explicit path supports the reviewed draft until the CLI creates its timestamped migration.
const path=process.argv[2] || 'tests/integration/fixes/schedule-revision-fail-closed.sql';
const migration=readFileSync(resolve(path),'utf8');
const extract=text=>text.match(/create or replace function public\.save_schedule_snapshot\([\s\S]*?\n\$\$;/)?.[0];
const before=extract(source),after=extract(migration);
if(!before || !after || after!==before.replace('v_meta.revision<>p_expected_revision','v_meta.revision is distinct from p_expected_revision'))throw new Error('Revision fix must change only the null-safe optimistic concurrency predicate.');
const outside=migration.replace(after,'').replace(/--[^\n]*/g,'').trim();
if(outside)throw new Error('Unexpected additional statements outside the reviewed function.');
console.log('PASS: null revision rejected; existing function, gates, transaction ordering and grants unchanged. Actual behavior requires PostgreSQL regression tests.');
