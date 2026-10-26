import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const config = await readFile(new URL('config.js', root), 'utf8');
const employee = html.slice(html.indexOf('async function handleEmployeeNativeAuthSubmit()'), html.indexOf('function setAuthMode('));

assert.ok(employee.length > 0, 'Dedicated employee native sign-in is present');
assert.ok(html.includes('employeeUsernameLoginEnabled===true'), 'Username UI requires explicit boolean opt-in');
assert.ok(/employeeUsernameLoginEnabled\s*:\s*true\b/.test(config), 'Approved release configuration explicitly enables employee usernames');
assert.ok(employee.includes("username+'@'+ALLOWED_EMAIL_DOMAIN"), 'Username derives only the existing company identifier');
assert.ok(employee.includes('client.auth.signInWithPassword({email,password})'), 'Password goes directly to native Auth');
assert.ok(employee.includes('client.auth.getUser()'), 'Returned identity is verified through native Auth');
assert.ok(!/\bfetch\s*\(|\.functions\.|\.rpc\(|\.from\(|\.admin\.|\.signUp\(/.test(employee), 'Employee sign-in has no proxy, lookup, provisioning or grant path');
assert.ok(!/\.signUp\(|\.admin\.|employee-access|employee_login_/.test(html), 'No registration or credential-proxy architecture is introduced');
assert.ok(html.includes("function authAllowed(email=''){return email.toLowerCase().endsWith('@'+ALLOWED_EMAIL_DOMAIN)}"), 'Existing exact-domain gate stays intact');
assert.ok(html.includes("sb.rpc('get_app_access')"), 'Server-enforced access remains authoritative');
assert.ok(html.includes('sb.auth.resetPasswordForEmail(email,{redirectTo})'), 'Existing email recovery remains native');
assert.ok(html.includes('isolatedClient.auth.updateUser({password})') && !html.includes('sb.auth.updateUser({password})'), 'Private password choice is native and never targets shared SDK identity');
assert.ok(html.includes('persistSession:false,autoRefreshToken:false,detectSessionInUrl:false'), 'Recovery client has no shared persistence or URL processing');
assert.ok(html.includes('captureRecoveryIdentity(session)') && html.includes('installedUser?.id!==binding.uid'), 'Recovery mutation is bound to its captured identity');
assert.ok(html.includes('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0'), 'Browser SDK matches the pinned native test dependency');
assert.ok(html.includes('recoverInterruptedEmployeeNativeSession'), 'Interrupted native login is fenced at bootstrap');
assert.ok(html.includes("Ask your owner for help resetting your password."), 'Employee recovery is owner-assisted, not public registration');
for (const script of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) new Function(script[1]);
console.log('PASS: approved direct-native username opt-in; unchanged domain/access/native recovery boundaries.');
