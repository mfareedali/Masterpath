/**
 * Session refresh for the optional Supabase account, and nothing else.
 *
 * Why this exists: Server Components cannot write cookies. Without this step an expired access token would be
 * refreshed during render, the new tokens could not be saved, and the next request would reuse a spent refresh
 * token (Supabase then signs the user out). Here the refreshed cookies are written to the response.
 *
 * The matcher is limited to the account routes so the rest of the site never runs this code (keeps pages fast
 * and cacheable). Visitors without a Supabase session cookie skip the network entirely.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/env';

export async function proxy(request: NextRequest) {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return NextResponse.next();
  if (!request.cookies.getAll().some((c) => c.name.startsWith('sb-'))) return NextResponse.next();

  let response = NextResponse.next({ request });
  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
        },
      },
    });
    // Must run before the response is produced: validates the JWT and refreshes it if it has expired.
    await supabase.auth.getClaims();
  } catch (err) {
    console.error('[proxy] Supabase session refresh failed:', err instanceof Error ? err.message : err);
  }
  return response;
}

export const config = {
  matcher: ['/account/:path*', '/auth/:path*', '/api/account/:path*'],
};
