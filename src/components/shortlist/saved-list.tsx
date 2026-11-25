'use client';

/** Saved programs list. Reads localStorage only, so it works offline once the page is cached. */
import Link from 'next/link';
import { Pill } from '@/components/ui/badges';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardListSkeleton } from '@/components/ui/card';
import { countryName } from '@/lib/format';
import { resolveSaved, type SavedProgramSummary } from '@/lib/shortlist/saved';
import { SaveButton, useSavedIds } from './save-button';

export function SavedList({ programs }: { programs: SavedProgramSummary[] }) {
  const ids = useSavedIds();

  if (ids === null) return <CardListSkeleton count={2} />;

  const { saved, missing } = resolveSaved(ids, programs);

  return (
    <div>
      <p role="status" aria-live="polite" className="mb-3 text-sm text-muted">
        {saved.length === 0
          ? 'Nothing saved yet.'
          : `${saved.length} saved program${saved.length === 1 ? '' : 's'}, newest first.`}
      </p>

      {saved.length === 0 ? (
        <Card>
          <h2 className="text-lg font-bold">No saved programs</h2>
          <p className="mt-1 text-sm text-muted">
            Tap <strong>Save</strong> on a program in your shortlist. It will stay here on this phone.
          </p>
          <ButtonLink href="/shortlist" className="mt-3">
            Go to your shortlist
          </ButtonLink>
        </Card>
      ) : (
        <ul className="space-y-3">
          {saved.map((p) => (
            <li key={p.id}>
              <Card>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold leading-snug break-words">
                      <Link
                        href={`/program/${encodeURIComponent(p.id)}`}
                        className="inline-flex min-h-tap items-center text-heading"
                      >
                        {p.name}
                      </Link>
                    </h2>
                    <p className="text-sm text-muted break-words">{p.institutionName}</p>
                  </div>
                  <Pill className="shrink-0">{countryName(p.country)}</Pill>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {p.status === 'ruled_out' ? (
                    <Pill>
                      <span aria-hidden="true">✕</span> Ruled out
                    </Pill>
                  ) : null}
                  <SaveButton programId={p.id} programName={p.name} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {missing > 0 ? (
        <p className="mt-3 text-sm text-muted">
          {missing} saved program{missing === 1 ? ' is' : 's are'} no longer in our list.
        </p>
      ) : null}
    </div>
  );
}
