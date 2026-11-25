/**
 * Browser Supabase client (anon key + the user's session cookies). Import only from Client Components.
 * Returns null when Supabase is not configured, so callers can hide account features.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

let client: SupabaseClient<Database> | null | undefined;

export function isSupabaseConfiguredInBrowser(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Typed with the generated schema (src/types/supabase.ts). Uses ONLY the public anon key; RLS applies. */
export function getSupabaseBrowserClient(): SupabaseClient<Database> | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createBrowserClient<Database>(url, key) : null;
  return client;
}
