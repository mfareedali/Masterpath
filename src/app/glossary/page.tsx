import type { Metadata } from 'next';
import { Callout, PageHeader } from '@/components/ui/card';
import { GLOSSARY_GROUPS, glossaryEntriesIn } from '@/lib/glossary';

/**
 * Plain-words glossary (audit proposal #40). Static: meanings only, no facts, so nothing here depends on data or time.
 * Every term has its own anchor (/glossary#cas) so other pages can link to it with glossaryHref().
 */
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Glossary',
  description:
    'Plain-English meanings of words you will see on MastersPath and on official pages, such as CGPA, CAS, OPT, ECTS and blocked account. Meanings only: no amounts, dates or rules.',
};

export default function GlossaryPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title="Glossary"
        subtitle="Plain-English meanings of words you will see on MastersPath and on university and visa pages."
      />

      <Callout tone="neutral" title="Meanings only">
        <p>
          These explain what a word means. They do not give amounts, dates or requirements, and they are not legal or
          immigration advice. The rules themselves are on official pages; on MastersPath each fact shows its source and
          the date we checked it.
        </p>
      </Callout>

      <nav aria-label="Glossary sections">
        <ul className="flex flex-wrap gap-2">
          {GLOSSARY_GROUPS.map((g) => (
            <li key={g.id}>
              <a
                href={`#${g.id}`}
                className="inline-flex min-h-tap items-center rounded-chip border border-line bg-surface px-4 text-sm font-semibold text-primary-ink no-underline hover:bg-surface-tint"
              >
                {g.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {GLOSSARY_GROUPS.map((g) => (
        <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} className="scroll-mt-20 space-y-3">
          <h2 id={`${g.id}-title`} className="text-xl font-bold">
            {g.title}
          </h2>
          <dl className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
            {glossaryEntriesIn(g.id).map((e) => (
              <div key={e.id} id={e.id} className="scroll-mt-20 p-4 target:bg-surface-tint">
                <dt className="font-bold text-heading">
                  {e.term}
                  {e.also ? <span className="font-normal text-muted"> ({e.also})</span> : null}
                </dt>
                <dd className="mt-1">{e.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
