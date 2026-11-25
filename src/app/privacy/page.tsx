import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, Card, PageHeader } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { PROFILE_COOKIE, PROFILE_COOKIE_MAX_AGE } from '@/lib/profile';
import { IssuesLink } from './issues-link';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What MastersPath keeps, where it is kept, what is sent to the AI, and how to delete it. No passport or ID numbers, no selling data.',
};

/** Date this page's wording last changed (our own document, not a fact about the world). */
const UPDATED = '2026-11-24';
const COOKIE_DAYS = Math.round(PROFILE_COOKIE_MAX_AGE / 86_400);

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} id={id} className="scroll-mt-20 space-y-3">
      <h2 id={`${id}-title`} className="text-xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="break-all rounded-badge bg-surface-tint px-1.5 py-0.5 text-sm">{children}</code>;
}

const SHORT_VERSION = [
  'You can use every feature without an account. What you type stays on your phone.',
  'We never ask for passport, CNIC or other ID numbers.',
  'The AI chat gets your question and public program data only. Never your profile.',
  'We never sell your data or use it for advertising.',
  'You can delete everything, any time, from the Your data page.',
] as const;

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <PageHeader title="Privacy" subtitle={`What we keep, where, and how to delete it. Last updated ${formatDate(UPDATED)}.`} />

      <Callout title="The short version">
        <ul className="list-disc space-y-1 pl-5">
          {SHORT_VERSION.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Callout>

      <Section id="device" title="Kept on your device">
        <p>When you use MastersPath without an account, your data stays in this browser:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>A small cookie</strong> (<Code>{PROFILE_COOKIE}</Code>) with your profile: grade, grade scale, field,
            budget and target countries. Your browser sends it with each page, so our server can show your shortlist.
            The server uses it to build the page and does not save it. It ends after {COOKIE_DAYS} days, or when you
            delete it.
          </li>
          <li>
            <strong>Browser storage</strong> (localStorage) with a copy of your profile, your strengths (publications and
            research, if you added them), your saved shortlist and your checklists.
          </li>
          <li>
            <strong>Offline copies of pages</strong>, if your browser supports it, so the app can open without internet.
          </li>
        </ul>
        <p>
          Anyone who uses this phone and browser can see this data. On a shared phone, delete it when you are done.
        </p>
        <p>
          <Link href="/account" className="inline-flex min-h-tap items-center font-semibold">
            See and delete your data on this device<span aria-hidden="true">&nbsp;→</span>
          </Link>
        </p>
      </Section>

      <Section id="account" title="Optional account">
        <p>
          Some websites running MastersPath turn on accounts, so you can keep your profile if you change phones. You
          never need one.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>You sign in with your email address only. We use it to send you a sign-in link or code, nothing else.</li>
          <li>
            Your profile and strengths are saved to your account only when you tap <strong>Save my profile to my account</strong>.
          </li>
          <li>
            They are kept in a Supabase database protected by <strong>row-level security</strong>: the database itself
            only lets you read or change your own rows.
          </li>
          <li>
            <strong>Delete my account permanently</strong> is a hard delete. Your account, your saved profile and your
            strengths are removed from our database at once. It cannot be undone.
          </li>
        </ul>
      </Section>

      <Section id="chat" title="The AI chat">
        <p>
          When you ask the chat a question, we send <strong>your question</strong> and the <strong>public data rows</strong>{' '}
          it needs (for example a program&apos;s listed requirements and their official links) to Anthropic&apos;s API.
          Anthropic&apos;s model, Claude, uses them to write the answer.
        </p>
        <p>
          <strong>No profile data is attached</strong>: not your grade, budget, strengths, email or anything else you
          saved. Anything you type into the question itself is sent, so please do not type private details there.
        </p>
        <p className="text-sm text-muted">
          If the AI is switched off, answers are built by our own code from the same rows, and nothing is sent to
          Anthropic.
        </p>
      </Section>

      <Section id="limits" title="Rate limits and safety checks">
        <p>
          To stop abuse and keep the free chat running, we count requests per visitor. For this we use a{' '}
          <strong>hashed client id</strong>: a one-way code made from your network address and browser type plus a
          secret. It cannot be turned back into your address. Our code never stores raw IP addresses, and the counts
          only cover one day.
        </p>
        <p>
          Some websites also turn on a safety check from Cloudflare (Turnstile) on sign-in or chat, to tell people from
          bots. Your browser talks to Cloudflare directly for this. We do not send your IP address to Cloudflare.
        </p>
        <p className="text-sm text-muted">
          Like any website, the hosting service may keep short technical logs of requests to run the service safely.
        </p>
      </Section>

      <Section id="reports" title="Reports of wrong data">
        <p>
          When you use <strong>Report incorrect data</strong>, we keep the program, the field and your message. We do
          not ask for your name or email with it. Only the project maintainers can read reports. Please do not put
          personal details in the message.
        </p>
      </Section>

      <Section id="never" title="What we never do">
        <ul className="list-disc space-y-2 pl-5">
          <li>Ask for or store passport, CNIC, national ID or any other ID numbers.</li>
          <li>Sell your data, or use it for advertising.</li>
          <li>Send your profile to the AI.</li>
        </ul>
      </Section>

      <Section id="contact" title="Questions">
        <p>
          MastersPath is open source. For privacy questions or problems, open an issue on the{' '}
          <IssuesLink>MastersPath GitHub repository</IssuesLink>. Issues are public, so do not post personal details
          there.
        </p>
      </Section>

      <Card>
        <p className="text-sm text-muted">
          This page explains how the app handles data. It is not legal advice. See also our{' '}
          <Link href="/disclaimer">Disclaimer</Link>.
        </p>
      </Card>
    </div>
  );
}
