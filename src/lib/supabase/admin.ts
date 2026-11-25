/**
 * Service-role Supabase client. SERVER ONLY: it bypasses row level security.
 * Used for hard-deleting accounts (auth.admin.deleteUser) and service-only tables (chat_usage, reports triage).
 * Never import this from a Client Component, and never send the key to the browser.
 */
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl } from './env';

export { isSupabaseAdminConfigured } from './env';

export function createSupabaseAdminClient(): SupabaseClient {
  const url = supabaseUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    throw new Error('Supabase admin is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
