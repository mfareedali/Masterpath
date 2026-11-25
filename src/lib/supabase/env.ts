/**
 * Which optional services are switched on for this deployment. Everything degrades gracefully when a value is
 * missing: no Supabase = seed JSON data and no accounts; no Turnstile = no challenge widget.
 *
 * NEXT_PUBLIC_* values are read with literal `process.env.NAME` expressions so Next inlines them in client bundles.
 */

export function supabaseUrl(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null;
}

export function supabaseAnonKey(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;
}

/** Public URL + anon key are set (enough to read public data and to talk to Supabase Auth). */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

/** Server only: the service-role key is set (needed for hard delete and the seed script). */
export function isSupabaseAdminConfigured(): boolean {
  return isSupabaseConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

/**
 * Accounts are offered only when every account can also be hard-deleted (service-role key present).
 * Server only (reads a server secret's presence, never its value).
 */
export function accountsEnabled(): boolean {
  return isSupabaseAdminConfigured();
}

export function turnstileSiteKey(): string | null {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
}

/** Server only. */
export function turnstileSecretKey(): string | null {
  return process.env.TURNSTILE_SECRET_KEY?.trim() || null;
}
