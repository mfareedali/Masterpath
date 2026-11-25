/**
 * Consultant Check results: summary per verdict, one card per claim, and the questions to send.
 * Server component. The only client JS here is the shared CopyButton leaf.
 */
import { buttonClass } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { VERDICT_ORDER, VERDICT_SHORT_LABEL, collectQuestions, type CheckRun } from '@/lib/consultant/compare';
import { buildQuestionsText, buildShareText, summarySentence, whatsappShareUrl } from '@/lib/consultant/share';
import { ClaimCard } from './claim-card';
import { VERDICT_GLYPH, VERDICT_TONE } from './verdict-badge';

/**
 * Counts per verdict. Short category names ("Differs"), because a count can include verdicts that rest on our summary
 * of an official page rather than its exact words. Each card carries its own full label.
 */
export function CheckSummaryTiles({ run }: { run: CheckRun }) {
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {VERDICT_ORDER.map((v) => (
        <div key={v} className={`flex items-center justify-between gap-3 rounded-card px-4 py-2 sm:block ${VERDICT_TONE[v]}`}>
          <dt className="text-sm font-semibold">
            <span aria-hidden="true">{VERDICT_GLYPH[v]} </span>
            {VERDICT_SHORT_LABEL[v]}
          </dt>
          <dd className="text-2xl font-bold sm:mt-1">{run.summary[v]}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CheckResults({ run, shareUrl }: { run: CheckRun; shareUrl: string | null }) {
  const questions = collectQuestions(run.results, 8);
  const questionsText = buildQuestionsText(questions);
  const shareText = buildShareText(run.results, { url: shareUrl });

  return (
    <div className="space-y-6">
      <section aria-labelledby="results-heading" className="space-y-3">
        <div>
          <h2 id="results-heading" className="text-xl font-bold">
            What we found
          </h2>
          <p className="mt-1 text-muted" aria-live="polite">
            {summarySentence(run.summary)}
          </p>
        </div>
        <CheckSummaryTiles run={run} />
      </section>

      <section aria-labelledby="claims-heading" className="space-y-3">
        <h2 id="claims-heading" className="sr-only">
          Each claim
        </h2>
        <ol className="space-y-3">
          {run.results.map((r, i) => (
            <li key={r.id}>
              <ClaimCard result={r} index={i} />
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="questions-heading">
        <Card className="space-y-3">
          <h2 id="questions-heading" className="text-xl font-bold">
            Questions to ask them in writing
          </h2>
          <p className="text-sm text-muted">
            A polite message with the key questions. Ask for answers in writing, with links to the official pages, before you
            pay anyone.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            {questions.map((q) => (
              <li key={q} className="break-words">
                {q}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-start gap-2">
            <CopyButton text={questionsText} label="Copy all questions" copiedLabel="Questions copied" />
            <a
              href={whatsappShareUrl(shareText)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass('accent')}
            >
              Share results on WhatsApp
              <span className="sr-only"> (opens WhatsApp in a new tab)</span>
            </a>
          </div>
          <details className="text-sm">
            <summary className="min-h-tap cursor-pointer py-2 font-semibold text-primary-ink">See the WhatsApp message</summary>
            <p className="whitespace-pre-wrap break-words rounded-button border border-line bg-surface-tint p-3">{shareText}</p>
          </details>
        </Card>
      </section>
    </div>
  );
}
