/**
 * University context card (screen 7). Async server component.
 *
 * Shows what official lists say about the student's OWN (home) university: HEC, PQR, anabin and the
 * destination recognition list, each as an evidence-first FactRow (missing -> "Not verified yet").
 * Plus a "Check before applying" list linking only to the official domain roots.
 * Never a verdict on the student, never a judgement of the university.
 */
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { FactRow, SourceLink } from '@/components/ui/fact';
import { getInstitutions } from '@/lib/data';
import { ANABIN_URL, HEC_URL, findHomeInstitution, recognitionLabel } from '@/lib/onboarding/university';
import { getNow } from '@/lib/profile-server';

export interface UniversityContextCardProps {
  universityId?: string | null;
  universityName?: string | null;
}

function CheckBeforeApplying() {
  return (
    <div className="mt-4 rounded-button bg-surface-tint p-3">
      <h3 className="text-base font-bold">Check before applying</h3>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
        <li>
          Confirm your degree&apos;s recognition and attestation on the official HEC website.{' '}
          <SourceLink url={HEC_URL} label="hec.gov.pk" />
        </li>
        <li>
          Applying to Germany? Check your university&apos;s status on the anabin database.{' '}
          <SourceLink url={ANABIN_URL} label="anabin.kmk.org" />
        </li>
      </ol>
      <p className="mt-2 text-xs text-muted">This is general guidance, not legal or immigration advice.</p>
    </div>
  );
}

export async function UniversityContextCard({ universityId, universityName }: UniversityContextCardProps) {
  const institutions = await getInstitutions();
  const now = getNow();
  const inst = findHomeInstitution(institutions, { universityId, universityName });
  const typedName = universityName?.trim() || null;

  return (
    <section>
      <Card>
        <h2 className="text-lg font-bold">Your university</h2>

        {inst ? (
          <>
            <p className="mt-1 break-words font-semibold text-ink">{inst.name}</p>
            <p className="mt-1 text-sm text-muted">
              What official lists say about your university. These are facts to check, not a judgement of you or your
              university.
            </p>
            {inst.website ? (
              <div className="mt-1">
                <SourceLink url={inst.website} label="University website" />
              </div>
            ) : null}
            <dl className="mt-2">
              <FactRow label="HEC recognition" fact={inst.hec_status} now={now} officialUrl={HEC_URL} />
              <FactRow label="PQR status" fact={inst.pqr_status} now={now} />
              <FactRow label="anabin status (Germany)" fact={inst.anabin_status} now={now} officialUrl={ANABIN_URL} />
              <FactRow
                label="Destination recognition list"
                fact={inst.recognition_list_status}
                now={now}
                render={recognitionLabel}
                formatText={recognitionLabel}
              />
            </dl>
          </>
        ) : typedName ? (
          <>
            <p className="mt-1 break-words font-semibold text-ink">{typedName}</p>
            <p className="mt-1 text-sm text-ink">
              We don&apos;t have verified data for your university yet. You can check it yourself with the steps below.
            </p>
            <p className="mt-1 text-sm text-muted">
              Have an official source for it?{' '}
              <Link href="/about#contribute" className="inline-flex min-h-tap items-center font-semibold">
                Help add it with evidence
              </Link>
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-ink">
            Add your university to see what official lists say about it.{' '}
            <Link href="/onboarding" className="inline-flex min-h-tap items-center font-semibold">
              Add your university
            </Link>
          </p>
        )}

        <CheckBeforeApplying />
      </Card>
    </section>
  );
}
