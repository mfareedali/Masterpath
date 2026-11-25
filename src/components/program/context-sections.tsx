/**
 * Country and institution context for a program page (server components):
 * citizenship snapshot, destination institution recognition, and "Where your research may matter".
 */
import Link from 'next/link';
import { Callout } from '@/components/ui/card';
import { FactRow } from '@/components/ui/fact';
import { countryName } from '@/lib/format';
import { countryFactLines, recognitionText } from '@/lib/program/render';
import type { CountryFact, CountryFactValue, Institution, Program, RecognitionStatus } from '@/lib/types';
import { Lines, ProgramFactRow, Section, type ConflictContext } from './fact-section';

export function CitizenshipSnapshot({
  country,
  citizenship,
  postStudyWork,
  now,
}: {
  country: string;
  citizenship: CountryFact | null;
  postStudyWork: CountryFact | null;
  now: Date;
}) {
  const render = (v: CountryFactValue) => <Lines lines={countryFactLines(v)} />;
  const asText = (v: CountryFactValue) => countryFactLines(v).join('; ');
  return (
    <Section
      id="citizenship"
      title={`Work and citizenship in ${countryName(country)}`}
      intro="A short snapshot for this country. This is not legal or immigration advice. Rules change, so check the official page."
    >
      <dl>
        <FactRow
          label="Work after study"
          fact={postStudyWork}
          now={now}
          render={render}
          formatText={asText}
          officialUrl={postStudyWork?.source_url}
        />
        <FactRow
          label="Citizenship rule"
          fact={citizenship}
          now={now}
          render={render}
          formatText={asText}
          officialUrl={citizenship?.source_url}
        />
      </dl>
      <p className="mt-2">
        <Link href="/citizenship" className="inline-flex min-h-tap items-center font-semibold">
          Compare citizenship routes<span aria-hidden="true">&nbsp;→</span>
        </Link>
      </p>
    </Section>
  );
}

export function RecognitionSection({
  institution,
  now,
  conflictContext,
}: {
  institution: Institution;
  now: Date;
  conflictContext: ConflictContext;
}) {
  return (
    <Section
      id="recognition"
      title="University recognition"
      intro="These facts are about the university, not about you. Lists change, so check them before you apply."
    >
      <dl>
        <FactRow<RecognitionStatus>
          label="Official recognition list"
          fact={institution.recognition_list_status}
          now={now}
          render={(v) => recognitionText(v)}
          formatText={(v) => recognitionText(v)}
          officialUrl={institution.recognition_list_status?.source_url}
          conflictContext={conflictContext}
        />
        {institution.country === 'DE' ? (
          <FactRow<string>
            label="anabin status (Germany)"
            fact={institution.anabin_status}
            now={now}
            officialUrl={institution.anabin_status?.source_url}
            conflictContext={conflictContext}
          />
        ) : null}
      </dl>
    </Section>
  );
}

/** Only rendered when research_considered is usable (Verified/Likely). */
export function ResearchSection({
  program,
  now,
  officialUrl,
  conflictContext,
}: {
  program: Program;
  now: Date;
  officialUrl: string | null;
  conflictContext: ConflictContext;
}) {
  return (
    <Section id="research" title="Where your research may matter">
      <dl>
        <ProgramFactRow
          program={program}
          field="research_considered"
          now={now}
          officialUrl={officialUrl}
          conflictContext={conflictContext}
        />
      </dl>
      <Callout tone="neutral" className="mt-3">
        The source above says research is considered. Your publications and research never change the fit label: it
        only compares your grade with the published minimum.
      </Callout>
    </Section>
  );
}
