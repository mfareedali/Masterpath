/**
 * Notes beside the numbers on shortlist cards and table rows. Server components.
 *  - "Note": a usable status_note of an ACTIVE program (e.g. extra measures for Pakistan applicants).
 *  - "Who it's for": the eligibility_note, as the official page states it. A warning only.
 *  - "Official route below the minimum": a usable conditional_admission, as the page states it. Read-only.
 * Which facts are shown is decided in code (programNotes). Notes never change fit, filters or ranking.
 * Values are plain text (React escapes them); a fact's internal review_note is never read here.
 */
import { ConfidenceBadge } from '@/components/ui/badges';
import { SourceLink } from '@/components/ui/fact';
import { allSources, computeConfidence } from '@/lib/confidence';
import { conditionalRoute, programNotes } from '@/lib/shortlist';
import type { ConditionalAdmission, Fact, FitResult, Program } from '@/lib/types';

/** Value + computed badge + source link (+ the fact's student-facing note). Conflict: both values, both links. */
export function NoteValue({ fact, now }: { fact: Fact<string>; now: Date }) {
  const conf = computeConfidence(fact, now);
  if (conf === 'Conflict') {
    return (
      <div className="space-y-2">
        <p className="inline-flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-conflict-fg">Official sources disagree. Both are shown.</span>
          <ConfidenceBadge confidence={conf} />
        </p>
        <ul className="space-y-2">
          {allSources(fact).map((s, i) => (
            <li key={i} className="rounded-button border border-conflict-bg bg-surface px-2 py-1">
              <span className="mr-2 text-xs font-bold text-muted">Source {i + 1}</span>
              <span className="text-ink">{String(s.value)}</span>
              <span className="block">
                <SourceLink url={s.source_url} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div>
      <p className="text-ink">
        {String(fact.value)} <ConfidenceBadge confidence={conf} />
      </p>
      <SourceLink url={fact.source_url} />
      {fact.note ? <p className="mt-0.5 text-xs text-muted">Note: {fact.note}</p> : null}
    </div>
  );
}

/** Card row (inside the card's <dl>): "Note" above the full text. */
export function StatusNoteItem({ program, now }: { program: Program; now: Date }) {
  const fact = programNotes(program, now).status;
  if (!fact) return null;
  return (
    <div className="py-2">
      <dt className="font-semibold text-muted">Note</dt>
      <dd className="mt-0.5 min-w-0 break-words">
        <NoteValue fact={fact} now={now} />
      </dd>
    </div>
  );
}

export const CONDITIONAL_ROUTE_TITLE = 'Official route below the minimum';
const CONDITIONAL_ROUTE_FOOTNOTE = 'As the official page states it. It does not change the fit result.';

/** The route's own words + computed badge + source. Plain text only. */
function ConditionalRouteBody({ fact, now }: { fact: Fact<ConditionalAdmission>; now: Date }) {
  return (
    <>
      <p className="text-ink">
        {fact.value?.text} <ConfidenceBadge confidence={computeConfidence(fact, now)} />
      </p>
      <SourceLink url={fact.source_url} />
      {fact.note ? <p className="mt-0.5 text-xs text-muted">Note: {fact.note}</p> : null}
      <p className="mt-0.5 text-xs text-muted">{CONDITIONAL_ROUTE_FOOTNOTE}</p>
    </>
  );
}

/**
 * Card row (inside the card's <dl>): "Official route below the minimum" with the page's text. Which fact shows is
 * decided in code (conditionalRoute: usable only, not when the regular minimum is met). Never changes the fit label.
 */
export function ConditionalRouteItem({ program, fit, now }: { program: Program; fit: FitResult; now: Date }) {
  const fact = conditionalRoute(program, fit, now);
  if (!fact) return null;
  return (
    <div className="py-2" data-conditional-route="">
      <dt className="font-semibold text-muted">{CONDITIONAL_ROUTE_TITLE}</dt>
      <dd className="mt-0.5 min-w-0 break-words">
        <ConditionalRouteBody fact={fact} now={now} />
      </dd>
    </div>
  );
}

/** Desktop table: the same route as a compact marker under the fit badge (opens without JS). */
export function ConditionalRouteMarker({ program, fit, now }: { program: Program; fit: FitResult; now: Date }) {
  const fact = conditionalRoute(program, fit, now);
  if (!fact) return null;
  return (
    <details className="mt-2 max-w-64 rounded-button border border-line bg-surface-tint px-3 py-1 text-xs" data-conditional-route="">
      <summary className="cursor-pointer font-semibold text-heading">{CONDITIONAL_ROUTE_TITLE}</summary>
      <div className="mt-1 break-words">
        <ConditionalRouteBody fact={fact} now={now} />
      </div>
    </details>
  );
}

/** Warning tone (Callout-like left bar in Conflict colours). Padding and size are set per use. */
const WARNING_TONE = 'rounded-button border-l-4 border-conflict-fg bg-conflict-bg text-ink';

function WarningHeading({ colon = true }: { colon?: boolean }) {
  return (
    <span className="font-bold text-conflict-fg">
      <span aria-hidden="true">!&nbsp;</span>
      Who it&apos;s for{colon ? ':' : ''}
    </span>
  );
}

/** Card warning: "! Who it's for: <official wording>" with its badge and source. Not by colour alone. */
export function EligibilityWarning({ program, now }: { program: Program; now: Date }) {
  const fact = programNotes(program, now).eligibility;
  if (!fact) return null;
  const conf = computeConfidence(fact, now);
  return (
    <div role="note" aria-label="Who it's for" className={`mt-3 break-words px-3 py-2 text-sm ${WARNING_TONE}`}>
      {conf === 'Conflict' ? (
        <>
          <WarningHeading />
          <div className="mt-1">
            <NoteValue fact={fact} now={now} />
          </div>
        </>
      ) : (
        <>
          <p>
            <WarningHeading /> {String(fact.value)} <ConfidenceBadge confidence={conf} />
          </p>
          <SourceLink url={fact.source_url} />
          {fact.note ? <p className="mt-0.5 text-xs text-muted">Note: {fact.note}</p> : null}
        </>
      )}
      <p className="mt-1 text-xs">Check that your degree fits this before you apply. It does not change the fit result.</p>
    </div>
  );
}

/** Desktop table: compact markers under the program name. Each opens to the full text (works without JS). */
export function NoteMarkers({ program, now }: { program: Program; now: Date }) {
  const { status, eligibility } = programNotes(program, now);
  if (!status && !eligibility) return null;
  return (
    <div className="mt-2 space-y-1 text-xs">
      {eligibility ? (
        <details className={`max-w-72 px-3 py-1 ${WARNING_TONE}`}>
          <summary className="cursor-pointer">
            <WarningHeading colon={false} />
          </summary>
          <div className="mt-1 break-words">
            <NoteValue fact={eligibility} now={now} />
          </div>
        </details>
      ) : null}
      {status ? (
        <details className="max-w-72 rounded-button border border-line bg-surface-tint px-3 py-1">
          <summary className="cursor-pointer font-semibold text-heading">
            <span aria-hidden="true">i&nbsp;</span>Note
          </summary>
          <div className="mt-1 break-words">
            <NoteValue fact={status} now={now} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
