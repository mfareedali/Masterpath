import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, Card, PageHeader } from '@/components/ui/card';
import { parseAuthStatus } from '@/lib/supabase/auth';
import { accountsEnabled, turnstileSiteKey } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AccountActions } from './account-actions';
import { signOutAction } from './actions';
import { DeleteAccount } from './delete-account';
import { LocalDataPanel } from './local-data-panel';
import { SignInForm } from './sign-in-form';
import { AUTH_STATUS_MESSAGES } from './status';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Your data',
  description: 'What MastersPath keeps, where it is kept, and how to delete it.',
  robots: { index: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface AccountState {
  user: { email: string | null } | null;
  savedAt: string | null;
  unavailable: boolean;
}

async function readAccount(): Promise<AccountState> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return { user: null, savedAt: null, unavailable: false };
    const { data: row } = await supabase.from('profiles').select('updated_at').eq('user_id', user.id).maybeSingle();
    return {
      user: { email: user.email ?? null },
      savedAt: typeof row?.updated_at === 'string' ? row.updated_at : null,
      unavailable: false,
    };
  } catch (err) {
    console.error('[account] could not read the session:', err instanceof Error ? err.message : err);
    return { user: null, savedAt: null, unavailable: true };
  }
}

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const status = parseAuthStatus(sp.auth);
  const message = status ? AUTH_STATUS_MESSAGES[status] : null;
  const enabled = accountsEnabled();
  const account = enabled ? await readAccount() : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Your data" subtitle="What MastersPath keeps, where it is kept, and how to delete it." />

      {message ? (
        <div role="status" aria-live="polite">
          <Callout tone={message.tone} title={message.title}>
            {message.text}
          </Callout>
        </div>
      ) : null}

      <Card>
        <section aria-labelledby="device-data">
          <h2 id="device-data" className="text-xl font-bold">
            Your data on this device
          </h2>
          <p className="mt-2 text-ink">
            MastersPath works without an account. What you type stays in this browser, on this phone:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
            <li>
              <strong>Your profile</strong>: grade, grade scale, field, budget and target countries. It is kept in a small
              cookie, so pages can show your shortlist, and in browser storage.
            </li>
            <li>
              <strong>Your strengths</strong>: publications and research, if you added them.
            </li>
            <li>
              <strong>Your saved shortlist and checklists.</strong>
            </li>
            <li>
              <strong>Offline copies of pages</strong>, so the app can open without internet.
            </li>
          </ul>
          <p className="mt-2 text-sm text-muted">We never ask for passport or ID numbers.</p>
          <LocalDataPanel />
        </section>
      </Card>

      <Card>
        <section aria-labelledby="account-heading">
          <h2 id="account-heading" className="text-xl font-bold">
            Account (optional)
          </h2>

          {!enabled ? (
            <div className="mt-3 space-y-2 text-ink">
              <p>Accounts are optional. They are not turned on for this website, and you can use every feature without one.</p>
              <p className="text-sm text-muted">
                Your profile, shortlist and checklists stay in this browser only.
              </p>
            </div>
          ) : account?.unavailable ? (
            <div className="mt-3">
              <Callout tone="warning" title="Accounts are not reachable right now.">
                Please try again later. Your data on this device is safe and still works.
              </Callout>
            </div>
          ) : account?.user ? (
            <div className="mt-3 space-y-6">
              <p className="break-words text-ink">
                Signed in as <strong>{account.user.email ?? 'your email address'}</strong>.
              </p>
              <AccountActions savedAt={account.savedAt} />
              <form action={signOutAction}>
                <Button type="submit" variant="secondary">
                  Sign out on this device
                </Button>
              </form>

              <section aria-labelledby="delete-heading" className="rounded-card border border-conflict-fg p-4">
                <h3 id="delete-heading" className="text-lg font-bold">
                  Delete my account permanently
                </h3>
                <p className="mt-1 mb-3 text-sm text-ink">
                  This deletes your account and the profile saved in it, right away and for good. It cannot be undone.
                  Data on this device is not touched. Use the button above to delete that too.
                </p>
                <DeleteAccount />
              </section>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-ink">
                An account lets you keep your profile if you change phones. You only need an email address. Your saved
                profile is private: only you can read it.
              </p>
              <SignInForm turnstileSiteKey={turnstileSiteKey()} />
            </div>
          )}
        </section>
      </Card>

      <p className="text-sm text-muted">
        Read more in our <Link href="/privacy">Privacy</Link> page and our <Link href="/disclaimer">Disclaimer</Link>.
      </p>
    </div>
  );
}
