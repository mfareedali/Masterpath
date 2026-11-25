/**
 * Supabase client for Server Components, Server Functions and Route Handlers, bound to the request's cookies.
 * Create a NEW client per request. Throws if Supabase is not configured: check isSupabaseConfigured() first.
 *
 * Server Components cannot write cookies; session refresh is handled by src/proxy.ts for the account routes.
 */
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { supabaseAnonKey, supabaseUrl } from './env';

export { isSupabaseConfigured, isSupabaseAdminConfigured, accountsEnabled } from './env';

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) throw new Error('Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).');
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. src/proxy.ts refreshes the session.
        }
      },
    },
  });
}
