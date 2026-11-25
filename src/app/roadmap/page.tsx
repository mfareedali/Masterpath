import type { Metadata } from 'next';
import { Callout, Card, PageHeader } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Roadmap',
  description: 'What MastersPath builds next, starting with an evidence-first CV Tailor.',
};

const CV_STEPS = [
  {
    title: 'Paste or upload your CV',
    body: 'Text or PDF. Nothing is stored unless you say so.',
  },
  {
    title: 'Code checks first',
    body: 'Page count, missing sections, and each program’s own limits (from verified program rows) are checked by plain code, not AI.',
  },
  {
    title: 'AI suggests program-specific changes',
    body: 'Claude suggests how to present what is already in your CV for one program. It never invents experience, grades or publications.',
  },
  {
    title: 'You stay in control',
    body: 'Explicit consent before anything is sent. Your CV is deleted when the session ends. We never collect or scrape other people’s CVs.',
  },
];

const NEXT = [
  'More programs and fields, each with verified evidence from official pages.',
  'Verified PKR exchange rates so total-cost ranking works across countries.',
  'Scholarship tracker with official deadlines.',
  'Urdu interface.',
];

export default function RoadmapPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Roadmap" subtitle="What we are building next. Not available yet." />

      <section aria-labelledby="cv-tailor" className="space-y-3">
        <h2 id="cv-tailor" className="text-xl font-bold">
          CV Tailor <span className="align-middle text-sm font-semibold text-muted">(planned)</span>
        </h2>
        <Callout title="Design principle">
          Same rule as the rest of MastersPath: code checks the facts, the AI only explains and suggests. No invented experience.
        </Callout>
        <ol className="space-y-3">
          {CV_STEPS.map((s, i) => (
            <li key={s.title}>
              <Card className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-chip bg-surface-tint font-bold text-heading"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-bold">{s.title}</h3>
                  <p className="text-sm text-muted">{s.body}</p>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="also-next" className="space-y-2">
        <h2 id="also-next" className="text-xl font-bold">Also next</h2>
        <ul className="list-disc space-y-1 pl-5 text-ink">
          {NEXT.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
