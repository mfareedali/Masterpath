/**
 * Building blocks for the program page (server components).
 * Values are plain strings rendered as React text: never HTML.
 */
import { Card } from '@/components/ui/card';
import { DaysLeft } from '@/components/ui/days-left';
import { FactRow } from '@/components/ui/fact';
import { deadlineEvent } from '@/lib/calendar';
import { computeConfidence, isUsable } from '@/lib/confidence';
import { FACT_LABEL, type FactSectionDef, type ProgramFactKey, type ProgramFactValue } from '@/lib/program/fields';
import { factLines, factText } from '@/lib/program/render';
import type { Fact, Program } from '@/lib/types';
import { AddToCalendar } from './add-to-calendar';

/** Renders one or more plain-text lines. */
export function Lines({ lines }: { lines: readonly string[] }) {
  if (lines.length === 1) return <span className="break-words">{lines[0]}</span>;
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} className={`block break-words ${i > 0 ? 'mt-1' : ''}`}>
          {line}
        </span>
      ))}
    </>
  );
}

export interface ConflictContext {
  programName: string;
  institutionName: string;
  admissionsEmail?: string | null;
}

/** A titled card section. Use `asList` when the children are FactRows (they render dt/dd). */
export function Section({
  id,
  title,
  intro,
  asList = false,
  children,
}: {
  id: string;
  title: string;
  intro?: React.ReactNode;
  asList?: boolean;
  children: React.ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={titleId} className="scroll-mt-20">
      <Card>
        <h2 id={titleId} className="text-xl font-bold">
          {title}
        </h2>
        {intro ? <div className="mt-1 text-sm text-muted">{intro}</div> : null}
        {asList ? <dl className="mt-2">{children}</dl> : <div className="mt-3">{children}</div>}
      </Card>
    </section>
  );
}

/**
 * The deadline value: the date from the server, then (only for a usable date) the countdown and the calendar button
 * from client leaves. The page is static, so "N days left" is never baked into its HTML.
 */
function DeadlineValue({
  program,
  iso,
  now,
  pinnedNow,
  institutionName,
}: {
  program: Program;
  iso: string;
  now: Date;
  pinnedNow: string | null;
  institutionName: string;
}) {
  const usable = isUsable(computeConfidence(program.deadline, now));
  const event = usable && program.deadline.value === iso ? deadlineEvent(program, institutionName, now) : null;
  return (
    <>
      <Lines lines={factLines('deadline', iso)} />
      {usable ? <DaysLeft iso={iso} pinnedNow={pinnedNow} /> : null}
      {event ? <AddToCalendar event={event} pinnedNow={pinnedNow} /> : null}
    </>
  );
}

/** FactRow for one program fact field, with the right plain-text renderer and the conflict email context. */
export function ProgramFactRow<K extends ProgramFactKey>({
  program,
  field,
  now,
  officialUrl,
  conflictContext,
  label,
  pinnedNow = null,
}: {
  program: Program;
  field: K;
  now: Date;
  officialUrl: string | null;
  conflictContext: ConflictContext;
  label?: string;
  /** The pinned demo clock (MASTERSPATH_NOW) for client countdowns; null = the viewer's clock. */
  pinnedNow?: string | null;
}) {
  const fact = program[field] as unknown as Fact<ProgramFactValue<K>> | null | undefined;
  const render =
    field === 'deadline'
      ? (v: ProgramFactValue<K>) => (
          <DeadlineValue
            program={program}
            iso={v as ProgramFactValue<'deadline'>}
            now={now}
            pinnedNow={pinnedNow}
            institutionName={conflictContext.institutionName}
          />
        )
      : (v: ProgramFactValue<K>) => <Lines lines={factLines(field, v)} />;
  return (
    <FactRow<ProgramFactValue<K>>
      label={label ?? FACT_LABEL[field]}
      fact={fact}
      now={now}
      render={render}
      formatText={(v) => factText(field, v)}
      officialUrl={officialUrl}
      conflictContext={conflictContext}
    />
  );
}

/** A section of program FactRows. */
export function ProgramFactSection({
  section,
  intro,
  program,
  now,
  officialUrl,
  conflictContext,
  pinnedNow = null,
}: {
  section: FactSectionDef;
  intro?: React.ReactNode;
  program: Program;
  now: Date;
  officialUrl: string | null;
  conflictContext: ConflictContext;
  pinnedNow?: string | null;
}) {
  return (
    <Section id={section.id} title={section.title} intro={intro} asList>
      {section.keys.map((field) => (
        <ProgramFactRow
          key={field}
          program={program}
          field={field}
          now={now}
          officialUrl={officialUrl}
          conflictContext={conflictContext}
          pinnedNow={pinnedNow}
        />
      ))}
    </Section>
  );
}
