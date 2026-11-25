/**
 * Home (screen 1). Static: no data access, no cookies. The only client JS is the quick-start form
 * and the demo persona buttons (both work as plain links/forms first).
 */
import Link from 'next/link';
import { LoadPersonaButtons } from '@/components/demo/load-persona';
import { Hero } from '@/components/home/hero';
import { QuickStartForm } from '@/components/home/quick-start-form';
import { HowItWorksList, ShortcutCards } from '@/components/home/shortcuts';
import { Card } from '@/components/ui/card';
import { BadgeLegend } from '@/components/ui/legend';
import { countryName } from '@/lib/format';
import { SUPPORTED_COUNTRIES } from '@/lib/profile';

function countryList(): string {
  const names = SUPPORTED_COUNTRIES.map(countryName);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
}

export default function Home() {
  return (
    <div className="space-y-10">
      <Hero eyebrow="Free and open source, for students in Pakistan" subtitle="Plan your Masters abroad without a paid consultant.">
        <p className="text-ink">
          Enter your grade to see programs in {countryList()}. Every fact links to the official page. If we cannot
          verify something, we say so.
        </p>
        <QuickStartForm />
      </Hero>

      <section aria-labelledby="home-more" className="space-y-3">
        <h2 id="home-more" className="text-xl font-bold">
          More ways to plan
        </h2>
        <ShortcutCards />
      </section>

      <section aria-labelledby="home-demo" className="space-y-3">
        <h2 id="home-demo" className="text-xl font-bold">
          Try the demo
        </h2>
        <p className="text-sm text-muted">See how MastersPath works with a fictional student. No typing needed.</p>
        <LoadPersonaButtons />
      </section>

      <section aria-labelledby="home-labels" className="space-y-3">
        <h2 id="home-labels" className="text-xl font-bold">
          What the labels mean
        </h2>
        <Card>
          <BadgeLegend />
        </Card>
      </section>

      <section aria-labelledby="home-how" className="space-y-3">
        <h2 id="home-how" className="text-xl font-bold">
          How MastersPath works
        </h2>
        <HowItWorksList />
        <p>
          <Link href="/about" className="inline-flex min-h-tap items-center font-semibold">
            Read how it works<span aria-hidden="true">&nbsp;→</span>
          </Link>
        </p>
      </section>
    </div>
  );
}
