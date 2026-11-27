'use client';

/**
 * One question + its streamed answer. The answer is PLAIN TEXT: no markdown, no HTML. A URL is clickable only
 * when it equals a row's source_url / official_url. Every row used is listed under "Sources used" with its badge.
 * Refusals (decided by code before any AI call) get their own neutral call-out style.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import { isUsable } from '@/lib/confidence';
import { cleanAnswerText, type AnswerState } from '@/lib/chat/client-state';
import { allowedUrlKeys, linkifySegments } from '@/lib/chat/linkify';
import type { ChatRow, RefusalReason } from '@/lib/chat/types';
import { ConfidenceBadge } from '@/components/ui/badges';
import { Button } from '@/components/ui/button';
import { Callout, Card, Skeleton } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { SourceLink } from '@/components/ui/fact';

const REFUSAL_TITLE: Record<RefusalReason, string> = {
  not_verified: "Not verified yet, so I won't guess",
  conflict: 'Official sources disagree',
  no_data: 'No data on this yet',
  prediction: 'No predictions or chances',
  legal: 'Not legal or immigration advice',
  dishonest: "I can't help with that",
  unknown_name: 'Name not found',
  getting_started: 'Let’s get you started',
};

/** Example questions on the getting-started card. Each one is answered from verified rows in the seed data. */
export const STARTER_QUESTIONS = [
  'What IELTS score does Oxford Brookes need?',
  'How long can I work in the UK after my Masters?',
  'What is the tuition at Oxford Brookes?',
] as const;

/** Same look as the UI kit chips, but long questions may wrap onto two lines (also used by ChatPanel). */
export const SUGGESTION_CLASS =
  'inline-flex min-h-tap max-w-full items-center rounded-chip border border-line bg-surface px-4 py-2 text-left text-sm font-semibold text-ink break-words hover:border-primary disabled:cursor-not-allowed disabled:opacity-60';

function refusalTitle(reason: AnswerState['reason']): string {
  return reason && reason in REFUSAL_TITLE ? REFUSAL_TITLE[reason as RefusalReason] : 'No answer';
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  );
}

function AnswerText({ text, rows }: { text: string; rows: ChatRow[] }) {
  const allowed = useMemo(() => allowedUrlKeys(rows), [rows]);
  const segments = useMemo(() => linkifySegments(cleanAnswerText(text), allowed), [text, allowed]);
  return (
    <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-ink">
      {segments.map((s, i) =>
        s.type === 'link' ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-semibold underline">
            {s.text}
            <span className="sr-only"> (opens official page in a new tab)</span>
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

function RowValue({ row }: { row: ChatRow }) {
  if (row.confidence === 'Conflict' && row.sources && row.sources.length > 0) {
    return (
      <ul className="mt-2 space-y-2">
        {row.sources.map((s, i) => (
          <li key={i} className="rounded-button border border-conflict-bg bg-surface p-2">
            <p className="break-words text-sm text-ink">
              <span className="mr-2 text-xs font-bold text-muted">Source {i + 1}</span>
              {s.value ?? 'No value'}
            </p>
            <SourceLink url={s.source_url} />
          </li>
        ))}
      </ul>
    );
  }
  if (!isUsable(row.confidence) || row.value == null) {
    return (
      <div className="mt-1">
        <p className="text-sm text-muted">Not verified yet</p>
        {row.official_url ? <SourceLink url={row.official_url} label="Check the official page" /> : null}
      </div>
    );
  }
  return (
    <div className="mt-1">
      <p className="break-words text-sm text-ink">{row.value}</p>
      <SourceLink url={row.source_url} />
    </div>
  );
}

function SourcesUsed({ rows, headingLevel }: { rows: ChatRow[]; headingLevel: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <details className="rounded-card border border-line bg-surface" open={rows.length <= 4}>
      <summary className="flex min-h-tap cursor-pointer items-center px-4 text-sm font-semibold text-primary-ink">
        <H className="text-sm font-semibold">Sources used ({rows.length})</H>
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-words text-sm font-semibold text-ink">
                {r.label}
                <span className="block font-normal text-muted">{r.entity_name}</span>
              </p>
              <ConfidenceBadge confidence={r.confidence} />
            </div>
            <RowValue row={r} />
            {r.email_draft ? (
              <CopyButton className="mt-2" text={r.email_draft} label="Copy email to admissions" copiedLabel="Email copied" />
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export interface ChatTurn {
  id: number;
  question: string;
  answer: AnswerState;
}

export function ChatAnswer({
  turn,
  sourcesHeadingLevel,
  onRetry,
  retryDisabled = false,
  onAsk,
}: {
  turn: ChatTurn;
  sourcesHeadingLevel: 2 | 3;
  onRetry?: () => void;
  retryDisabled?: boolean;
  /** Sends a new question (the "Did you mean …?" chip). Disabled together with retry while an answer streams. */
  onAsk?: (question: string) => void;
}) {
  const { answer } = turn;
  const suggestion = answer.suggestion;
  const streaming = answer.status === 'streaming';
  const waiting = streaming && answer.text === '';
  const failed = answer.status === 'error' && answer.text === '';

  let body: React.ReactNode;
  if (failed) {
    body = (
      <Callout tone="warning" title="Could not answer">
        <p>{answer.error}</p>
        {onRetry ? (
          <Button variant="secondary" className="mt-3" onClick={onRetry} disabled={retryDisabled}>
            Try again
          </Button>
        ) : null}
      </Callout>
    );
  } else if (waiting) {
    body = (
      <Card>
        <p className="mb-3 text-sm text-muted">
          {answer.mode === 'answer' && answer.rows.length > 0
            ? `Found ${answer.rows.length} ${answer.rows.length === 1 ? 'fact' : 'facts'}. Writing a short summary…`
            : 'Checking MastersPath data…'}
        </p>
        <Skeleton className="mb-2 h-4 w-11/12" />
        <Skeleton className="mb-2 h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
      </Card>
    );
  } else if (answer.mode === 'refusal' && answer.reason === 'getting_started') {
    body = (
      <Callout tone="accent" title={refusalTitle(answer.reason)}>
        <AnswerText text={answer.text} rows={answer.rows} />
        {onAsk && answer.status === 'done' ? (
          <div className="mt-3">
            <p className="mb-2 text-sm font-semibold text-muted">Or tap a question to try:</p>
            <div className="flex flex-wrap gap-2">
              {STARTER_QUESTIONS.map((q) => (
                <button key={q} type="button" className={SUGGESTION_CLASS} disabled={retryDisabled} onClick={() => onAsk(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-muted">Written by MastersPath. No AI was used for this answer.</p>
      </Callout>
    );
  } else if (answer.mode === 'refusal') {
    body = (
      <Callout
        tone="neutral"
        title={
          <span className="flex items-center gap-2">
            <StopIcon />
            {refusalTitle(answer.reason)}
          </span>
        }
      >
        <AnswerText text={answer.text} rows={answer.rows} />
        {suggestion && onAsk && answer.status === 'done' ? (
          <div className="mt-3">
            <p className="mb-2 text-sm font-semibold text-muted">Tap to ask with this name:</p>
            <button type="button" className={SUGGESTION_CLASS} disabled={retryDisabled} onClick={() => onAsk(suggestion.question)}>
              {suggestion.question}
            </button>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-muted">Decided by MastersPath rules from our data. No AI was used for this answer.</p>
      </Callout>
    );
  } else {
    body = (
      <Card>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {answer.mode === 'fallback' ? 'Facts from MastersPath (no AI summary)' : 'AI summary of the facts below'}
        </p>
        <AnswerText text={answer.text} rows={answer.rows} />
        {answer.status === 'error' ? (
          <p role="alert" className="mt-2 text-sm font-semibold text-conflict-fg">
            {answer.error}
          </p>
        ) : null}
        {answer.mode === 'answer' && answer.status === 'done' ? (
          <p className="mt-3 text-xs text-muted">Check each value against its source before you rely on it.</p>
        ) : null}
      </Card>
    );
  }

  return (
    <article className="space-y-3" aria-busy={streaming}>
      <p className="break-words text-sm text-muted">
        <span className="font-semibold text-ink">You asked: </span>
        {turn.question}
      </p>
      {body}
      {!streaming && answer.pointers.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4">
          {answer.pointers.map((p) => (
            <li key={p.href}>
              <Link href={p.href} className="inline-flex min-h-tap items-center text-sm font-semibold underline">
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {answer.rows.length > 0 ? <SourcesUsed rows={answer.rows} headingLevel={sourcesHeadingLevel} /> : null}
    </article>
  );
}
