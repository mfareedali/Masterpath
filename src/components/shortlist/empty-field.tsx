/**
 * "No programs for your field yet" card. Server component.
 * When another field has programs (Shortlist.fallbackField, decided in code), it offers that field in one tap,
 * keeping the grade, budget and countries (profileShortlistPath). Navigation only: no program is relabelled.
 */
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { profileShortlistPath, type Shortlist } from '@/lib/shortlist';
import type { Profile } from '@/lib/types';

export function EmptyFieldCard({ shortlist, profile }: { shortlist: Pick<Shortlist, 'field' | 'fallbackField'>; profile: Profile }) {
  const fallback = shortlist.fallbackField;
  return (
    <Card>
      <h2 className="text-lg font-bold">No programs for your field yet</h2>
      <p className="mt-1 text-sm text-muted">
        No programs are seeded for <strong className="text-ink">{shortlist.field.label}</strong> yet. We only show programs
        we can link to an official page. MastersPath is open source: if you know an official program page, you can help
        add it.
      </p>
      {fallback ? (
        <>
          <p className="mt-3">
            <Link
              href={profileShortlistPath(profile, { field: fallback.slug })}
              className="inline-flex min-h-tap items-center font-semibold"
              data-fallback-field={fallback.slug}
            >
              See {fallback.label} programs (the closest field we have)<span aria-hidden="true">&nbsp;→</span>
            </Link>
          </p>
          <p className="mt-1 text-sm text-muted">
            Your grade, budget and countries stay the same. Check on each official page that the course fits your degree
            before you apply.
          </p>
        </>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <ButtonLink href="/onboarding" variant="secondary">
          Change my field
        </ButtonLink>
        <ButtonLink href="/about#contribute" variant="ghost">
          How to contribute data
        </ButtonLink>
      </div>
    </Card>
  );
}
