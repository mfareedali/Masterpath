import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, Card, PageHeader } from '@/components/ui/card';
import { BadgeLegend } from '@/components/ui/legend';
import { VERIFIED_MAX_AGE_DAYS } from '@/lib/confidence';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'What MastersPath is, how it uses evidence from official pages, what each badge means, and why it never shows admission percentages.',
};

const STEPS = [
  {
    title: 'Evidence',
    text: 'Each fact is saved with the official page it came from, the exact sentence from that page, and the date we checked it.',
  },
  {
    title: 'Code decides',
    text: 'Confidence, fit, ranking, filters, deadlines and cost are worked out by plain, tested code over those rows. The same input always gives the same result.',
  },
  {
    title: 'The AI explains, it never decides',
    text: 'The AI chat explains the facts we hold, with their sources. When we hold no verified fact, it answers from general knowledge and marks that answer clearly, so you know to check the official page.',
  },
] as const;

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

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <PageHeader
        title="How MastersPath works"
        subtitle="A free, open-source guide for students in Pakistan applying to Masters programs abroad, without a paid consultant."
      />

      <Section id="what" title="What MastersPath is">
        <p>
          MastersPath helps you find Masters programs, compare costs and routes, and check what you have been told,
          using information from official university and government pages. It does not apply on your behalf, and it
          does not replace the official pages.
        </p>
        <p>
          When we do not have evidence for a value, you will see <strong>Not verified yet</strong> and a link to the
          official page, so you can check it yourself.
        </p>
      </Section>

      <Section id="how" title="How it works">
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3 rounded-card border border-line bg-surface p-4">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip bg-surface-tint font-bold text-primary-ink"
              >
                {i + 1}
              </span>
              <span>
                <span className="block font-bold text-heading">{s.title}</span>
                <span className="mt-0.5 block text-sm text-muted">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted">
          In short: evidence first, code decides, the model explains, and no data means no answer.
        </p>
      </Section>

      <Section id="badges" title="What each badge means">
        <p className="text-sm text-muted">
          Every value has a badge. It is calculated from the evidence each time, never typed in by hand. A value is
          Verified only if it was copied word for word from the official page in the last {VERIFIED_MAX_AGE_DAYS} days.
        </p>
        <Card>
          <BadgeLegend />
        </Card>
      </Section>

      <Section id="no-percentages" title="Why there are no percentages">
        <p>
          Admission decisions depend on things no public page shows: who else applied, how many places there are, and
          how a committee reads your file. Any &ldquo;chance of admission&rdquo; number would be made up.
        </p>
        <p>
          So we only compare your grade with the minimum the university publishes, and show one of three labels:{' '}
          <strong>Meets minimum</strong>, <strong>Below minimum</strong> or <strong>Competitive range unknown</strong>.
          Your publications and other strengths never change this label. They can still matter for research-led routes
          and your statement of purpose.
        </p>
      </Section>

      <Section id="your-data" title="Your data">
        <p>
          If you do not sign in, your profile is saved only on this device (a cookie and your browser&apos;s storage). We never ask for passport,
          CNIC or other ID numbers. You can delete everything at any time.
        </p>
        <p>
          <Link href="/account" className="inline-flex min-h-tap items-center font-semibold">
            Delete my data on this device<span aria-hidden="true">&nbsp;→</span>
          </Link>
        </p>
        <p className="text-sm text-muted">The demo personas on the home page are fictional.</p>
      </Section>

      <Section id="contribute" title="Open source: help add data">
        <p>
          MastersPath is open source under the MIT licence. The most useful help is <strong>data with evidence</strong>:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Use the official page only: the university&apos;s own site or a government site. Not agents, blogs or forums.</li>
          <li>Copy the sentence that contains the value word for word, and note the date you checked it.</li>
          <li>If two official pages disagree, keep both. The app shows both with a Conflict badge.</li>
          <li>Never add a value from memory, a consultant, a forwarded message or an AI chat.</li>
        </ul>
        <p>
          The step-by-step guide is in <code className="rounded-badge bg-surface-tint px-1.5 py-0.5 text-sm">CONTRIBUTING.md</code>{' '}
          in the MastersPath repository. Found a wrong value? Use <strong>Report incorrect data</strong> on the program
          page.
        </p>
      </Section>

      <Callout tone="neutral" title="Not legal or immigration advice">
        MastersPath compares information with official pages. Rules and fees change, so always check the official
        website before you apply or pay anyone.
      </Callout>
    </div>
  );
}
