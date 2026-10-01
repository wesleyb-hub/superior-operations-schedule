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
    ok: html.includes("from('app_user_roles').select('role,can_write')"),
    message: 'The client does not load server-enforced application access.',
  },
  {
    ok: html.includes('if(!currentUserCanWrite)'),
    message: 'Read-only users are not prevented from attempting schedule writes.',
  },
];

const failures = checks.filter((check) => !check.ok);

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
for (const [index, match] of inlineScripts.entries()) {
  try {
    new Function(match[1]);
  } catch (error) {
    failures.push({ message: `Inline script ${index + 1} has invalid JavaScript: ${error.message}` });
  }
}

if (failures.length) {
  failures.forEach((failure) => console.error(`FAIL: ${failure.message}`));
  process.exitCode = 1;
} else {
  console.log('PASS: public bundle contains no seeded wall jobs and remote payloads fail closed.');
}
