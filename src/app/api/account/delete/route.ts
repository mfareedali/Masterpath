/**
 * POST /api/account/delete — hard delete of the signed-in user's account.
 *
 * 1. Same-origin check (CSRF) and body { "confirm": "DELETE" }.
 * 2. The session is verified server-side with Supabase Auth (getUser), never trusted from the client.
 * 3. auth.admin.deleteUser(user.id) with the service-role key. This is a hard delete: the auth.users row is
 *    removed and profiles / profile_strengths go with it (on delete cascade). The rows are also deleted first,
 *    explicitly, as a second line of defence.
 * 4. Session cookies are cleared. Returns 200 { ok: true }.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { isSameOrigin } from '@/lib/supabase/auth';
import { accountsEnabled } from '@/lib/supabase/env';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** The only accepted body is {"confirm":"DELETE"}; anything bigger is refused before parsing. */
const MAX_BODY_BYTES = 1024;

type ErrorCode = 'not_enabled' | 'bad_origin' | 'bad_request' | 'not_signed_in' | 'delete_failed';

function json(body: { ok: true } | { ok: false; error: ErrorCode }, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest) {
  if (!accountsEnabled()) return json({ ok: false, error: 'not_enabled' }, 503);
  if (!isSameOrigin((name) => request.headers.get(name))) return json({ ok: false, error: 'bad_origin' }, 403);

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ ok: false, error: 'bad_request' }, 413);

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: 'bad_request' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  if (typeof body !== 'object' || body === null || (body as { confirm?: unknown }).confirm !== 'DELETE') {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error: userError } = await supabase.auth.getUser();
    const user = data?.user;
    if (userError || !user) return json({ ok: false, error: 'not_signed_in' }, 401);

    const admin = createSupabaseAdminClient();
    // Belt and braces: the cascade removes these too.
    await admin.from('profile_strengths').delete().eq('user_id', user.id);
    await admin.from('profiles').delete().eq('user_id', user.id);

    // shouldSoftDelete = false: a hard delete (the auth.users row is removed; profiles cascade).
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id, false);
    if (deleteError) {
      console.error('[account/delete] deleteUser failed:', deleteError.message);
      return json({ ok: false, error: 'delete_failed' }, 500);
    }

    // The user no longer exists; drop the local session and any leftover auth cookies.
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      /* already gone */
    }
    const store = await cookies();
    for (const c of store.getAll()) {
      if (c.name.startsWith('sb-')) store.delete(c.name);
    }
  } catch (err) {
    console.error('[account/delete] failed:', err instanceof Error ? err.message : 'unknown error');
    return json({ ok: false, error: 'delete_failed' }, 500);
  }
  return json({ ok: true }, 200);
}
