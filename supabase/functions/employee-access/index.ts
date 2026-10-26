// Disabled-by-default deployment candidate; no live invocation is part of source tests.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createEmployeeAccessHandler, PasswordRejected } from './handler.mjs';

const env = (key: string) => Deno.env.get(key) ?? '';
const config = {
  enabled: env('EMPLOYEE_ACCESS_ENABLED') === 'true',
  hmacSecret: env('EMPLOYEE_ACCESS_HMAC_SECRET'),
  origins: env('EMPLOYEE_ACCESS_ALLOWED_ORIGINS').split(',').map(v => v.trim()).filter(Boolean),
  rateLimitMode: env('EMPLOYEE_ACCESS_RATE_LIMIT_MODE') || 'trusted-ip',
  ipHeader: env('EMPLOYEE_ACCESS_TRUSTED_IP_HEADER').toLowerCase(),
  ipTrustVerified: env('EMPLOYEE_ACCESS_IP_TRUST_VERIFIED') === 'true',
};

// Timeout rejects an ambiguous Auth update; no transport-level automatic POST retries.
const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12_000) });
function services() {
  const url = env('SUPABASE_URL'), serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const publishableKey = env('EMPLOYEE_ACCESS_PUBLISHABLE_KEY') || env('SUPABASE_ANON_KEY');
  if (!url.startsWith('https://') || !serviceKey || !publishableKey) throw new Error('configuration');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: boundedFetch } };
  const admin = createClient(url, serviceKey, options);
  const auth = createClient(url, publishableKey, options);
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      const { data, error } = await admin.rpc(name, args); if (error) throw new Error('database'); return data;
    },
    async getUser(token: string) {
      const { data, error } = await admin.auth.getUser(token); return error ? null : data.user;
    },
    async getUserById(uid: string) {
      const { data, error } = await admin.auth.admin.getUserById(uid); return error ? null : data.user;
    },
    async signIn(credentials: { email: string; password: string }) {
      const { data, error } = await auth.auth.signInWithPassword(credentials); return error ? null : data.session;
    },
    async updatePassword(uid: string, patch: { password: string; email_confirm?: boolean }) {
      const { data, error } = await admin.auth.admin.updateUserById(uid, patch);
      if (error?.code === 'weak_password' && error.status === 422) throw new PasswordRejected();
      if (error) throw new Error('auth'); return data.user;
    },
    async revokeSession(jwt: string) {
      const { error } = await admin.auth.admin.signOut(jwt, 'local'); if (error) throw new Error('auth');
    },
  };
}

Deno.serve(createEmployeeAccessHandler({ config, services }));
