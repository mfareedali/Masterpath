import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, Card, PageHeader } from '@/components/ui/card';
import { BadgeLegend } from '@/components/ui/legend';
import { VERIFIED_MAX_AGE_DAYS } from '@/lib/confidence';
import { IssuesLink } from '../privacy/issues-link';

export const metadata: Metadata = {
  title: 'Disclaimer',
  description:
    'MastersPath is not legal or immigration advice. Information can be out of date: always check the official site. No admission predictions.',
};

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

export default function DisclaimerPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <PageHeader title="Disclaimer" subtitle="Please read this before you rely on anything in MastersPath." />

      <Callout title="Not legal or immigration advice">
        MastersPath is an information tool. It is not a lawyer, an immigration adviser or an admissions office. For
        decisions about visas, residence or citizenship, read the official government page, and ask a licensed adviser
        if your case is not simple.
      </Callout>

      <Section id="outdated" title="Information can be out of date">
        <p>
          Universities and governments change rules, fees and deadlines, sometimes without notice. A value that was right
          when we checked it can be wrong today. Every value shows the official page it came from and when it was
          checked.
        </p>
        <p>
          <strong>Always check the official site before you apply or pay anyone.</strong> If the official page and
          MastersPath disagree, the official page wins.
        </p>
        <p>
          When we have no evidence for a value, you will see <strong>Not verified yet</strong> and a link to the official
          page, instead of a guess.
        </p>
      </Section>

      <Section id="labels" title="What the labels mean">
        <p className="text-sm text-muted">
          Labels are worked out by code from the evidence each time you open a page, never typed in by hand. A value is
          Verified only if it was copied word for word from the official page in the last {VERIFIED_MAX_AGE_DAYS} days.
        </p>
        <Card>
          <BadgeLegend />
        </Card>
      </Section>

      <Section id="no-predictions" title="No admission predictions">
        <p>
          We do not predict admission and never show percentages. Fit labels only compare your grade with the minimum
          the university publishes. <strong>Meets minimum</strong> means you meet the published minimum. It does not mean
          you will get an offer. Your publications and other strengths never change the fit label.
        </p>
        <p>
          We do not promise any result: not an offer, a scholarship, a visa, a work permit, residence or citizenship.
          Those decisions are made by universities and governments, case by case.
        </p>
      </Section>

      <Section id="claims" title="We compare claims, not people">
        <p>
          When something you were told does not match an official page, MastersPath shows both side by side. This is a
          comparison of claims, not a judgement about any person, agent or university. Rules change and mistakes
          happen. Ask the university in writing when sources disagree.
        </p>
      </Section>

      <Section id="links" title="Links and examples">
        <p>
          Links go to official websites that we do not control. The demo students on the home page are fictional.
        </p>
      </Section>

      <Section id="license" title="Open source, no warranty">
        <p>
          MastersPath is free and open source under the MIT licence. As that licence says, the software is provided
          &ldquo;as is&rdquo;, without warranty of any kind, and the authors are not liable for any loss from using it.
          The full text is in the <code className="rounded-badge bg-surface-tint px-1.5 py-0.5 text-sm">LICENSE</code>{' '}
          file in the repository.
        </p>
        <p>
          Found a mistake? Use <strong>Report incorrect data</strong> on the program page, or open an issue on the{' '}
          <IssuesLink>MastersPath GitHub repository</IssuesLink>.
        </p>
      </Section>

      <p className="text-sm text-muted">
        How we handle your data: <Link href="/privacy">Privacy</Link>.
      </p>
    </div>
  );
}
