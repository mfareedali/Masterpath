/**
 * Home (screen 1). Static, no cookies; refreshed hourly. Its data reads are which fields have programs (so the
 * field picker can say "(no programs yet)") and the hero numbers (homeStats over the dataset). The only client JS
 * is the quick-start form, the demo persona buttons and the decorative bento spotlight (all work without it).
 */
import Link from 'next/link';
import { getDataset, getFieldsWithPrograms } from '@/lib/data';
import { LoadPersonaButtons } from '@/components/demo/load-persona';
import { FaqList } from '@/components/home/faq';
import { Hero, UniversityMarquee } from '@/components/home/hero';
import { QuickStartForm } from '@/components/home/quick-start-form';
import { HowItWorksList, ShortcutCards } from '@/components/home/shortcuts';
import { ButtonLink } from '@/components/ui/button';
import { Card, SectionHeading } from '@/components/ui/card';
import { BadgeLegend } from '@/components/ui/legend';
import { countryName } from '@/lib/format';
import { homeStats } from '@/lib/home/stats';
import { SUPPORTED_COUNTRIES } from '@/lib/profile';
import { getNow } from '@/lib/profile-server';

function countryList(): string {
  const names = SUPPORTED_COUNTRIES.map(countryName);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
}

// Which fields have programs, and the hero numbers, come from the dataset; refresh hourly (same as /onboarding).
export const revalidate = 3600;

const moreLink = 'inline-flex min-h-tap items-center text-sm font-semibold';

export default async function Home() {
  const [fieldsWithPrograms, data] = await Promise.all([getFieldsWithPrograms(), getDataset()]);
  const stats = homeStats(data.programs, getNow());
  // Universities with at least one active program, from the dataset (alphabetical).
  const activeInstitutions = new Set(data.programs.filter((p) => p.status === 'active').map((p) => p.institution_id));
  const universityNames = data.institutions
    .filter((i) => activeInstitutions.has(i.id))
    .map((i) => i.name)
    .sort((a, b) => a.localeCompare(b));
  return (
    <div className="space-y-8 md:space-y-20">
      <Hero stats={stats} />

      <section id="start" aria-labelledby="home-start" className="scroll-mt-20">
        <div className="mx-auto max-w-2xl rounded-panel border border-line bg-surface p-5 shadow-lift md:p-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-ink">Start here · about 30 seconds</p>
          <h2 id="home-start" className="mt-1 text-2xl font-bold">
            See your programs
          </h2>
          <p className="mt-1 text-ink">
            Enter your grade to see programs in {countryList()}. No sign-up, no passport or ID number.
          </p>
          <QuickStartForm fieldsWithPrograms={fieldsWithPrograms} />
        </div>
      </section>

      <UniversityMarquee names={universityNames} />

      <section aria-labelledby="home-more" className="space-y-5">
        <SectionHeading
          id="home-more"
          eyebrow="Tools"
          title="More ways to plan"
          intro="Each tool works from the same sourced data, so the answers agree with each other."
        />
        <ShortcutCards />
      </section>

      <section aria-labelledby="home-how" className="space-y-5">
        <SectionHeading
          id="home-how"
          eyebrow="Principles"
          title="How MastersPath works"
          action={
            <Link href="/about" className={moreLink}>
              Read how it works<span aria-hidden="true">&nbsp;→</span>
            </Link>
          }
        />
        <HowItWorksList />
      </section>

      <div className="grid gap-10 md:grid-cols-2 md:gap-6">
        <section aria-labelledby="home-demo" className="space-y-4">
          <SectionHeading
            id="home-demo"
            eyebrow="No typing needed"
            title="Try the demo"
            intro="See how MastersPath works with a fictional student."
          />
          <LoadPersonaButtons />
        </section>

        <section aria-labelledby="home-labels" className="space-y-4">
          <SectionHeading id="home-labels" eyebrow="Read the badges" title="What the labels mean" />
          <Card>
            <BadgeLegend />
          </Card>
        </section>
      </div>

      <section aria-labelledby="home-faq" className="space-y-5">
        <SectionHeading
          id="home-faq"
          eyebrow="FAQ"
          title="Questions students ask"
          action={
            <Link href="/glossary" className={moreLink}>
              Glossary of terms<span aria-hidden="true">&nbsp;→</span>
            </Link>
          }
        />
        <FaqList />
      </section>

      <section
        aria-labelledby="home-cta"
        className="on-chrome rounded-panel bg-chrome px-5 py-8 text-on-chrome shadow-card md:flex md:items-center md:justify-between md:gap-6 md:px-8"
      >
        <div>
          <h2 id="home-cta" className="text-2xl font-bold text-on-chrome">
            Got a consultant’s promise?
          </h2>
          <p className="mt-1 max-w-lg text-on-chrome-muted">
            Check it against the official pages before you pay anyone.
          </p>
        </div>
        <ButtonLink href="/check" variant="accent" className="mt-5 shrink-0 md:mt-0">
          Open Consultant Check<span aria-hidden="true">&nbsp;→</span>
        </ButtonLink>
      </section>
    </div>
  );
}
