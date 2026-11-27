/**
 * Program detail page (screen 4). Static + ISR: no cookies or searchParams are read here, so the page is
 * edge-cacheable. Personalised parts (fit, checklist ticks, report form, chat, the "Back to shortlist" link) are
 * small client islands; the fit panel and the back link read a profile from the link's query in the browser.
 * Anything relative to today ("N days left", whether the calendar button is still offered) is decided in the
 * browser by client leaves, so a cached copy of this page never shows a stale countdown.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChatPanel } from '@/components/chat/chat-panel';
import { AskUniversity } from '@/components/program/ask-university';
import { Callout } from '@/components/ui/card';
import { CitizenshipSnapshot, RecognitionSection, ResearchSection } from '@/components/program/context-sections';
import { CostSummary } from '@/components/program/cost-summary';
import { EligibilityCallout } from '@/components/program/eligibility-callout';
import { ProgramFactRow, ProgramFactSection, type ConflictContext } from '@/components/program/fact-section';
import { FitPanel } from '@/components/program/fit-panel';
import { JumpLinks, ProgramHeader } from '@/components/program/program-header';
import { ReportForm } from '@/components/program/report-form';
import { RequirementsChecklist } from '@/components/program/requirements-checklist';
import { computeConfidence, isUsable, usableValue } from '@/lib/confidence';
import { programTotalCost } from '@/lib/cost';
import { getConversionRules, getCountryFact, getFxRates, getInstitution, getProgram, getPrograms } from '@/lib/data';
import { safeHref } from '@/lib/format';
import { missingFactQuestions, usableAdmissionsEmail } from '@/lib/program/ask-university';
import { buildChecklist } from '@/lib/program/checklist';
import { programForFitPanel } from '@/lib/program/fit-view';
import {
  applicableFactKeys,
  computeCoverage,
  FACT_SECTIONS,
  isPathwayProgram,
  reportFieldOptions,
} from '@/lib/program/fields';
import { getNow } from '@/lib/profile-server';

export const revalidate = 3600;

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const programs = await getPrograms();
  return programs.map((p) => ({ id: p.id }));
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const program = await getProgram(id);
  if (!program) return { title: 'Program not found' };
  const institution = await getInstitution(program.institution_id);
  const where = institution ? ` at ${institution.name}` : '';
  return {
    title: institution ? `${program.name} — ${institution.name}` : program.name,
    description: `Facts about ${program.name}${where}. Every value shows its official source and how sure we are. No admission percentages.`,
  };
}

const CHAT_SUGGESTIONS = [
  'What is the application deadline?',
  'Which documents do I need?',
  'What English test score do I need?',
  'What is the minimum CGPA?',
];

export default async function ProgramPage({ params }: Props) {
  const { id } = await params;
  const program = await getProgram(id);
  if (!program) notFound();

  const [institution, rules, fxRates, citizenship, postStudyWork] = await Promise.all([
    getInstitution(program.institution_id),
    getConversionRules(),
    getFxRates(),
    getCountryFact(program.country, 'citizenship_rule'),
    getCountryFact(program.country, 'post_study_work'),
  ]);

  const now = getNow();
  const pinnedNow = process.env.MASTERSPATH_NOW ? now.toISOString() : null;
  // "Not verified yet" links go to the program page, or the university homepage until a program page is verified.
  const officialUrl = safeHref(program.official_url) ?? safeHref(institution?.website) ?? null;
  const conflictContext: ConflictContext = {
    programName: program.name,
    institutionName: institution?.name ?? 'the university',
    admissionsEmail: usableValue(program.admissions_email, now),
  };

  const coverage = computeCoverage(program, now);
  const cost = programTotalCost(program, fxRates, now);
  const checklist = buildChecklist(program, now);
  const showPathway = isPathwayProgram(program);
  const showResearch = isUsable(computeConfidence(program.research_considered, now));
  // Active programs show the status note only when one exists (it is counted in coverage then, too).
  const showStatusNote = applicableFactKeys(program).includes('status_note');

  const jumpLinks = [
    { id: 'fit', label: 'Your fit' },
    { id: FACT_SECTIONS.keyFacts.id, label: 'Key facts' },
    { id: 'cost', label: 'Cost' },
    { id: FACT_SECTIONS.entry.id, label: 'Requirements' },
    { id: FACT_SECTIONS.documents.id, label: 'Documents' },
    { id: 'checklist', label: 'Checklist' },
    ...(showPathway ? [{ id: FACT_SECTIONS.pathway.id, label: 'Pathway' }] : []),
    ...(showResearch ? [{ id: 'research', label: 'Research' }] : []),
    { id: 'citizenship', label: 'Citizenship' },
    { id: 'ask', label: 'Ask' },
    { id: 'report', label: 'Report a mistake' },
  ];

  const sectionProps = { program, now, officialUrl, conflictContext };
  // Fact sections also get the pinned clock for the client-side "N days left" (never baked into this static page).
  const factSectionProps = { ...sectionProps, pinnedNow };
  const askQuestions = missingFactQuestions(program, now);

  return (
    <div className="has-scroll-spy mx-auto max-w-3xl">
      <ProgramHeader program={program} institution={institution} coverage={coverage} />

      {program.status === 'ruled_out' ? (
        <Callout tone="warning" title="This program is marked as ruled out" className="mb-4">
          <p>We keep it here so you can see why. Check the official page before you decide.</p>
          <dl className="mt-2 rounded-button bg-surface px-3">
            <ProgramFactRow field="status_note" label="Why" {...sectionProps} />
          </dl>
        </Callout>
      ) : showStatusNote ? (
        <Callout tone="neutral" title="Note about this program" className="mb-4">
          <dl className="rounded-button bg-surface px-3">
            <ProgramFactRow field="status_note" label="Status note" {...sectionProps} />
          </dl>
        </Callout>
      ) : null}

      {/* "Who this course is for": a warning only when usable. It never changes the fit label. */}
      <EligibilityCallout fact={program.eligibility_note} now={now} />

      <JumpLinks links={jumpLinks} />

      <div className="space-y-4">
        <FitPanel program={programForFitPanel(program)} rules={rules} pinnedNow={pinnedNow} officialUrl={officialUrl} />

        <ProgramFactSection section={FACT_SECTIONS.keyFacts} {...factSectionProps} />

        <CostSummary cost={cost} officialUrl={officialUrl} />

        <ProgramFactSection section={FACT_SECTIONS.entry} {...factSectionProps} />

        <ProgramFactSection section={FACT_SECTIONS.documents} {...factSectionProps} />

        <RequirementsChecklist programId={program.id} items={checklist} />

        {showPathway ? (
          <ProgramFactSection
            section={FACT_SECTIONS.pathway}
            intro="For this route you first join a preparation stage. Check what you need to move on to the Master's."
            {...factSectionProps}
          />
        ) : null}

        {showResearch ? <ResearchSection {...sectionProps} /> : null}

        <AskUniversity
          programName={program.name}
          institutionName={institution?.name ?? 'your university'}
          questions={askQuestions}
          admissionsEmail={usableAdmissionsEmail(program, now)}
        />

        <ProgramFactSection section={FACT_SECTIONS.contact} {...factSectionProps} />

        <CitizenshipSnapshot country={program.country} citizenship={citizenship} postStudyWork={postStudyWork} now={now} />

        {institution ? <RecognitionSection institution={institution} now={now} conflictContext={conflictContext} /> : null}

        <div id="ask" className="scroll-mt-20">
          <ChatPanel programId={program.id} title="Ask about this program" suggestions={CHAT_SUGGESTIONS} />
        </div>

        <ReportForm programId={program.id} fields={reportFieldOptions(program)} />
      </div>
    </div>
  );
}
