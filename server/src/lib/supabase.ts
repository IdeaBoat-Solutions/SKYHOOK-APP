import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, supabaseMode } from '../config.js';

let adminClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

function requireUrl(): string {
  if (!config.SUPABASE_URL) {
    throw new Error('SUPABASE_URL is not configured. See docs/11-SUPABASE-SETUP.md');
  }
  return config.SUPABASE_URL.replace(/\/$/, '');
}

/** Service-role client — bypasses RLS. Never expose its key to the browser. */
export function getSupabaseAdmin(): SupabaseClient {
  if (!supabaseMode || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (!adminClient) {
    adminClient = createClient(requireUrl(), config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

/** Anon client — subject to RLS. Used for end-user password sign-in. */
export function getSupabaseAnon(): SupabaseClient {
  if (!config.SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_ANON_KEY is not configured. See docs/11-SUPABASE-SETUP.md');
  }
  if (!anonClient) {
    anonClient = createClient(requireUrl(), config.SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return anonClient;
}

/** JWKS used to verify Supabase-issued access tokens on every API request. */
export function supabaseJwksUrl(): string {
  return config.SUPABASE_JWKS_URL ?? `${requireUrl()}/auth/v1/.well-known/jwks.json`;
}

export function supabaseIssuer(): string {
  return `${requireUrl()}/auth/v1`;
}

export { supabaseMode };
