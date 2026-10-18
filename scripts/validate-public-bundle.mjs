// Prepared by Scout
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(resolve(root, 'index.html'), 'utf8');

const checks = [
  {
    ok: /const seed=\{[\s\S]*?\n\s*walls:\[\],/.test(html),
    message: 'The seed must contain an empty walls array.',
  },
  {
    ok: !/\"wall-import-\d+\"/.test(html),
    message: 'Seeded wall-job records remain in the public bundle.',
  },
  {
    ok: !html.includes('cleanFreshStart20260930'),
    message: 'The legacy automatic reset flag remains in the client.',
  },
  {
    ok: !/return \{data:sharedDataFromState\(seed\),migrated:true\}/.test(html),
    message: 'Unknown remote payloads still fall back to seed data.',
  },
  {
    ok: html.includes("throw new Error('Unsupported shared schedule format')"),
    message: 'Unsupported payloads do not fail closed.',
  },
  {
    ok: html.includes("sb.rpc('get_app_access')"),
    message: 'The client does not load server-enforced application access.',
  },
  {
    ok: html.includes('if(!currentUserCanWrite)'),
    message: 'Read-only users are not prevented from attempting schedule writes.',
  },
  {
    ok: html.includes('id="forgotPasswordBtn"') && html.includes('id="authNewPasswordGroup"'),
    message: 'The sign-in screen is missing self-service password recovery/setup controls.',
  },
  {
    ok: html.includes('sb.auth.resetPasswordForEmail(email,{redirectTo})'),
    message: 'Password recovery does not use Supabase Auth with an explicit safe redirect.',
  },
  {
    ok: html.includes("event==='PASSWORD_RECOVERY'") && html.includes("['invite','signup'].includes(authCallbackType())"),
    message: 'Password recovery and invitation/setup links are not handled by the public app.',
  },
  {
    ok: html.includes('sb.auth.updateUser({password})') && html.includes('password.length<12'),
    message: 'Password setup does not enforce the minimum length and update the authenticated user.',
  },
  {
    ok: html.includes('window.location.origin+window.location.pathname'),
    message: 'Password recovery does not return to the current approved Hub URL.',
  },
  {
    ok: html.includes('Reorder sender active; recipient delivery unverified') && !html.includes('Reorder alerts route to Lance after activation'),
    message: 'Inventory email status must distinguish an active sender from verified recipient delivery.',
  },
  {
    ok: html.includes('id="hub-shared-design-standard"') && html.includes('--hub-page-title:22px') && html.includes('.production-heading h2') && html.includes('.inventory-heading h2') && html.includes('.planner-heading h2'),
    message: 'Major dashboard headers do not share the common title design tokens.',
  },
  {
    ok: html.includes('data-install-update-job') && html.includes('install-job-progress') && /#view \.inventory-stats,#view \.stats\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(html),
    message: 'Job-first Installation progress and compact mobile metric layouts are missing.',
  },
];

const failures = checks.filter((check) => !check.ok);

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
for (const [index, match] of inlineScripts.entries()) {
  try {
    new Function(match[1]);
  } catch (error) {
    failures.push({ message: 'Inline script ' + (index + 1) + ' has invalid JavaScript: ' + error.message });
  }
}

if (failures.length) {
  failures.forEach((failure) => console.error('FAIL: ' + failure.message));
  process.exitCode = 1;
} else {
  console.log('PASS: public bundle remains fail-closed; includes guarded auth, honest delivery status, and shared design rules.');
}
